/**
 * Everything /transparency shows, read live: the market's state from Elysium
 * and Hyperliquid's own candles to check the latest rounds against.
 * The public RPC is shared with the keeper and rate-limits hard, so this reads
 * slowly, keeps settled rounds forever, and serves the last good copy on error.
 */
import { erc20Abi, parseAbi } from "viem";
import { publicClient, MARKET, COLLATERAL, ASSET } from "./chain";
import { ropeAbi } from "./ropeAbi";
import { candles, toE8 } from "./hyperliquid";
import { REGISTRY } from "./elysium";

const extra = parseAbi([
  "function owner() view returns (address)",
  "function hook() view returns (address)",
  "function buyLockSecs() view returns (uint64)",
  "function maxStaleSecs() view returns (uint64)",
  "function sampleWindowSecs() view returns (uint64)",
  "function roundCapBps() view returns (uint256)",
  "function HOOK_GAS() view returns (uint256)",
]);

/** Round 47 is the first struck at Hyperliquid's candle open; earlier ones used the book mid. */
export const CANDLE_RULE_FROM = 47;
const N = 30;
const TTL_MS = 60_000;
/** A live minute costs about this much keeper gas (measured on testnet). */
const HYPE_PER_LIVE_MINUTE = 0.00003;

export interface RoundRow {
  id: number;
  opensAt: number;
  status: "open" | "settled" | "voided";
  winner: "UP" | "DOWN" | null;
  strike: number;
  strikeHL: number | null;
  strikeOk: boolean | null;
  close: number | null;
  closeHL: number | null;
  closeOk: boolean | null;
  midEra: boolean;
}

export interface Transparency {
  at: number;
  asset: string;
  market: string;
  collateral: string;
  registry: string;
  owner: string;
  operator: string;
  hook: string;
  roundCount: number;
  vault: number;
  liability: number;
  free: number;
  keeperGas: number;
  keeperRunwayHours: number;
  params: { halfSpreadPct: number; lateSecs: number; buyLockSecs: number; maxStaleSecs: number; sampleWindowSecs: number; roundCapPct: number; sigmaPerMinPct: number; hookGas: number };
  rows: RoundRow[];
  checked: number;
  exact: number;
}

let cache: { at: number; data: Transparency } | null = null;

type RawRound = readonly [bigint, bigint, number, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
/** Settled and voided rounds never change, so each is read once. */
const done = new Map<number, RawRound>();
let inflight: Promise<Transparency> | null = null;

/** Elysium has no multicall3, so reads go one after another with a breath between. */
async function slowly<T>(jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  for (const j of jobs) {
    out.push(await j());
    await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}

/** Serves the last copy at once and refreshes behind it; only the very first visit waits. */
export async function getTransparency(): Promise<Transparency> {
  const stale = !cache || Date.now() - cache.at >= TTL_MS;
  if (stale) inflight ??= load().finally(() => (inflight = null));
  if (cache) {
    inflight?.catch(() => {});
    return cache.data;
  }
  return inflight!;
}

async function load(): Promise<Transparency> {
  const read = (functionName: string, abi: readonly unknown[] = ropeAbi, args?: unknown[]) =>
    publicClient.readContract({ address: MARKET, abi, functionName, args } as never) as Promise<unknown>;
  const head = (await slowly<unknown>([
    () => read("roundCount"), () => read("liability"), () => read("freeBalance"), () => read("halfSpread"), () => read("lateSecs"), () => read("sigmaWad"), () => read("operator"),
    () => read("owner", extra), () => read("hook", extra), () => read("buyLockSecs", extra), () => read("maxStaleSecs", extra), () => read("sampleWindowSecs", extra), () => read("roundCapBps", extra), () => read("HOOK_GAS", extra),
    () => publicClient.readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "balanceOf", args: [MARKET] }),
  ])) as unknown as [bigint, bigint, bigint, bigint, bigint, bigint, string, string, string, bigint, bigint, bigint, bigint, bigint, bigint];
  const [roundCount, liability, free, halfSpread, lateSecs, sigma, operator, owner, hook, buyLock, maxStale, sampleWin, capBps, hookGas, vaultBal] = head;
  const gas = await publicClient.getBalance({ address: operator as `0x${string}` });

  const last = Number(roundCount);
  const ids = Array.from({ length: Math.min(N, last) }, (_, i) => BigInt(last - i));
  const fresh = (await slowly(ids.filter((id) => !done.has(Number(id))).map((id) => async () => [Number(id), (await read("rounds", ropeAbi, [id])) as RawRound] as const)));
  for (const [id, r] of fresh) if (r[2] === 2 || r[2] === 3) done.set(id, r);
  for (const id of done.keys()) if (id <= last - N) done.delete(id);
  const freshBy = new Map(fresh);
  const rounds = ids.map((id) => done.get(Number(id)) ?? freshBy.get(Number(id))!);

  const opens = rounds.map((r) => Number(r[0]) * 1000);
  const book = new Map<number, string>();
  if (opens.length) {
    try {
      for (const k of await candles(ASSET, Math.min(...opens) - 60_000, Math.max(...opens) + 180_000)) book.set(k.t, k.o);
    } catch {
      /* Hyperliquid unreachable: rows show "?" rather than a wrong verdict */
    }
  }

  let checked = 0, exact = 0;
  const rows: RoundRow[] = rounds.map((r, i) => {
    const id = Number(ids[i]);
    const opensAt = Number(r[0]), expiresAt = Number(r[1]), st = r[2];
    const status = st === 2 ? "settled" : st === 3 ? "voided" : "open";
    const midEra = id < CANDLE_RULE_FROM;
    const sO = book.get(opensAt * 1000), cO = book.get(expiresAt * 1000);
    const strikeOk = sO ? toE8(sO) === r[4] : null;
    const closeOk = status === "settled" && cO ? toE8(cO) === r[5] : null;
    if (!midEra) {
      if (strikeOk !== null) { checked++; if (strikeOk) exact++; }
      if (closeOk !== null) { checked++; if (closeOk) exact++; }
    }
    return {
      id, opensAt, status, midEra,
      winner: status === "settled" ? (r[3] === 0 ? "UP" : "DOWN") : null,
      strike: Number(r[4]) / 1e8, strikeHL: sO ? Number(sO) : null, strikeOk,
      close: status !== "open" && r[5] ? Number(r[5]) / 1e8 : null, closeHL: cO ? Number(cO) : null, closeOk,
    };
  });

  const keeperGas = Number(gas) / 1e18;
  const data: Transparency = {
    at: Date.now(), asset: ASSET, market: MARKET, collateral: COLLATERAL, registry: REGISTRY,
    owner, operator, hook, roundCount: last,
    vault: Number(vaultBal) / 1e6, liability: Number(liability) / 1e6, free: Number(free) / 1e6,
    keeperGas, keeperRunwayHours: keeperGas / HYPE_PER_LIVE_MINUTE / 60,
    params: {
      halfSpreadPct: Number(halfSpread) / 1e4, lateSecs: Number(lateSecs), buyLockSecs: Number(buyLock), maxStaleSecs: Number(maxStale),
      sampleWindowSecs: Number(sampleWin), roundCapPct: Number(capBps) / 100,
      sigmaPerMinPct: (Number(sigma) / 1e18) * Math.sqrt(60) * 100, hookGas: Number(hookGas),
    },
    rows, checked, exact,
  };
  cache = { at: Date.now(), data };
  return data;
}
