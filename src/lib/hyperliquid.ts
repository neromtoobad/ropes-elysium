/**
 * The Hyperliquid side: the live mark the rope is tied to, and the volatility
 * the market prices with.
 *
 * Until Elysium's HyperCore read precompile ships (Kinetiq: ~4 weeks after
 * mainnet), the only way to get a Hyperliquid price into an Elysium contract
 * is to carry it there. This module reads Hyperliquid's public info API; the
 * executor pushes what it reads on-chain with every trade, open and settle,
 * stamped with the moment it was read. Every one of those pushes is a
 * `MarkPushed` event, so the relay can be audited against Hyperliquid's own
 * candles after the fact (scripts/doctor.ts does exactly that).
 */
const INFO = process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz/info";

/** HIP-3 markets live on their own dex: "xyz:SP500" is the "xyz" dex. */
function dexOf(asset: string): string | undefined {
  const i = asset.indexOf(":");
  return i > 0 ? asset.slice(0, i) : undefined;
}

async function info<T>(body: unknown, timeoutMs = 2500): Promise<T> {
  const res = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}`);
  return (await res.json()) as T;
}

export interface Mark {
  /** Mid price as Hyperliquid quotes it, e.g. 95.1425 */
  price: number;
  /** Scaled 1e8 for the contract */
  raw: bigint;
  /** When we read it, ms since epoch. The contract's notion of "when". */
  sourceMs: bigint;
}

/** 1e8 fixed point, from Hyperliquid's decimal string — no float rounding. */
export function toE8(s: string): bigint {
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole) * 10n ** 8n + BigInt((frac + "00000000").slice(0, 8));
}

/** The live mid for `asset`. Throws if Hyperliquid does not list it. */
export async function readMark(asset: string): Promise<Mark> {
  const dex = dexOf(asset);
  const mids = await info<Record<string, string>>(dex ? { type: "allMids", dex } : { type: "allMids" });
  const s = mids[asset];
  if (!s) throw new Error(`hyperliquid lists no mid for ${asset}`);
  return { price: Number(s), raw: toE8(s), sourceMs: BigInt(Date.now()) };
}

type Candle = { t: number; T: number; o: string; c: string; h: string; l: string };

/** One-minute candles over [startMs, endMs]. */
export async function candles(asset: string, startMs: number, endMs: number): Promise<Candle[]> {
  return info<Candle[]>({
    type: "candleSnapshot",
    req: { coin: asset, interval: "1m", startTime: startMs, endTime: endMs },
  }, 5000);
}

/**
 * Volatility of ln(price) per √second, as a wad (1e18), from the last hour of
 * one-minute closes. This is σ in fair(UP) = Φ(ln(S/K) / (σ·√τ)).
 *
 * Floored, because a dead-quiet hour would otherwise price the next minute as
 * a certainty and hand the first mover a free option.
 */
export async function sigmaWad(asset: string): Promise<bigint> {
  const now = Date.now();
  const cs = await candles(asset, now - 65 * 60_000, now);
  const closes = cs.map((c) => Number(c.c)).filter((x) => x > 0);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  if (rets.length < 20) throw new Error(`only ${rets.length} candles for ${asset}`);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varMin = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const perMinute = Math.max(Math.sqrt(varMin), 0.0004); // floor: 0.04% a minute
  const perRootSecond = perMinute / Math.sqrt(60);
  return BigInt(Math.round(perRootSecond * 1e18));
}
