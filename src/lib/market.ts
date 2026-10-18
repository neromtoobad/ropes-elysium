/**
 * The current round's market — which, on Elysium, is ours.
 *
 * On Somnia the game rode someone else's venue and had to FIND a live window,
 * cope with empty books at the open and fall back to slower cadences when the
 * venue stopped publishing. Here RopeMarket quotes every block from the
 * Hyperliquid mark, so the executor simply opens a round at the top of every
 * minute, struck at the mark it reads at that moment, and settles it at the
 * mark it reads at the bell.
 *
 * Keys: a round's `marketId` is its on-chain round id as bytes32, and its
 * "pool" is the RopeMarket address — the same (pool, nonce) shape the
 * scoreboard and the ledger already key by.
 */
import { pad, toHex, decodeErrorResult, BaseError, ContractFunctionRevertedError } from "viem";
import { publicClient, wallet, MARKET, ASSET, INTERVAL_SEC, ONE } from "./chain";
import { ropeAbi, TRADING, SETTLED, VOIDED } from "./ropeAbi";
import { readMark, sigmaWad } from "./hyperliquid";

export interface Onchain {
  roundId: bigint;
  /** = roundId; the scoreboard keys rounds by (market, nonce). */
  nonce: bigint;
  status: number;
}

export interface LiveMarket {
  marketId: `0x${string}`;
  pool: `0x${string}`;
  onchain: Onchain;
  expiresAt: Date;
  opensAt: Date;
  secondsLeft: number;
  intervalSec: number;
  /** The quote, in YES (= UP) terms, raw ONE-scaled. Always present: the market makes it. */
  yesAsk?: bigint;
  yesBid?: bigint;
  /** One deep level each side: the market's own quote. */
  yesBidLevels: { price: bigint; quantity: bigint }[];
  yesAskLevels: { price: bigint; quantity: bigint }[];
  tick: bigint;
  lot: bigint;
  /** The line to beat: the Hyperliquid mark at the open. */
  strike: number;
  /** Repurposed: the round id, which the page links to its on-chain record. */
  oracleQuestionId: string | null;
}

const DEEP = 2n ** 64n;

export const marketIdOf = (id: bigint) => pad(toHex(id), { size: 32 }) as `0x${string}`;
export const roundIdOf = (marketId: string) => BigInt(marketId);

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** The latest round's on-chain row. */
export async function readRound(id: bigint) {
  const r = await publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "rounds", args: [id] });
  const [opensAt, expiresAt, status, winner, strike, close, upShares, downShares, cap, reserved, costIn] = r;
  return { opensAt, expiresAt, status, winner, strike, close, upShares, downShares, cap, reserved, costIn };
}

/**
 * RopeMarket's sample window (`sampleWindowSecs`, set to 8 at deploy): a
 * strike must be read within this many seconds of the open, a close within
 * this many after the bell. We open with a margin to spare.
 */
const SAMPLE_WINDOW_S = 8;
const OPEN_GRACE_S = SAMPLE_WINDOW_S - 2;

let current: { windowStart: number; id: bigint; strike: number } | null = null;

/**
 * ONE Hyperliquid read per minute boundary, shared by the round that ends and
 * the round that begins: the bell price of minute N is the strike of minute
 * N+1, which is both what the game means and what keeps either from being
 * sampled late. Taken the first time anything asks after the boundary.
 */
let boundary: { at: number; mark: Awaited<ReturnType<typeof readMark>> } | null = null;

async function boundaryMark(at: number) {
  if (boundary?.at === at) return boundary.mark;
  const mark = await readMark(ASSET);
  boundary = { at, mark };
  return mark;
}
let missedLoggedFor = 0;

/**
 * The open round for THIS minute, opening it if the minute has just begun.
 * Null between a missed open and the next minute, or too close to the bell.
 */
export async function currentMarket(minSecondsLeft = 5): Promise<LiveMarket | null> {
  const nowS = Date.now() / 1000;
  const windowStart = Math.floor(nowS / INTERVAL_SEC) * INTERVAL_SEC;
  const expires = windowStart + INTERVAL_SEC;

  if (!current || current.windowStart !== windowStart) {
    // After a restart the round for this minute may already exist on-chain.
    const count = await publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "roundCount" });
    if (count > 0n) {
      const last = await readRound(count);
      if (Number(last.opensAt) === windowStart && last.status === TRADING) {
        current = { windowStart, id: count, strike: Number(last.strike) / 1e8 };
      }
    }
  }

  if (!current || current.windowStart !== windowStart) {
    if (nowS - windowStart > OPEN_GRACE_S) {
      // Too late to strike this minute honestly; the contract would refuse a
      // strike sampled this long after the open anyway. Wait for the next.
      if (missedLoggedFor !== windowStart) {
        missedLoggedFor = windowStart;
        log(`missed the open of ${new Date(windowStart * 1000).toISOString().slice(11, 19)} — next minute`);
      }
      return null;
    }
    const m = await boundaryMark(windowStart);
    const hash = await wallet().writeContract({
      address: MARKET,
      abi: ropeAbi,
      functionName: "openRound",
      args: [BigInt(windowStart), BigInt(expires), m.raw, m.sourceMs],
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`openRound reverted ${hash}`);
    const id = await publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "roundCount" });
    current = { windowStart, id, strike: m.price };
    log(`opened round #${id} on-chain  ${ASSET} struck at ${m.price}  tx ${hash.slice(0, 10)}…`);
  }

  const secondsLeft = expires - Date.now() / 1000;
  if (secondsLeft < minSecondsLeft) return null;

  const q = await liveQuote(current.strike, expires);
  return {
    marketId: marketIdOf(current.id),
    pool: MARKET,
    onchain: { roundId: current.id, nonce: current.id, status: TRADING },
    expiresAt: new Date(expires * 1000),
    opensAt: new Date(windowStart * 1000),
    secondsLeft,
    intervalSec: INTERVAL_SEC,
    yesBid: q?.yesBid,
    yesAsk: q?.yesAsk,
    // The market quotes any size up to the round's risk cap at one price, so
    // "the book" is a single deep level on each side. Auto-bail's depth walk
    // then marks at exactly what the contract would pay.
    yesBidLevels: q ? [{ price: q.yesBid, quantity: DEEP }] : [],
    yesAskLevels: q ? [{ price: q.yesAsk, quantity: DEEP }] : [],
    tick: 1n,
    lot: 1n,
    strike: current.strike,
    oracleQuestionId: current.id.toString(),
  };
}

/**
 * What the market WOULD quote right now, at the mark Hyperliquid shows right
 * now — computed by the contract's own pricing function (a free eth_call), so
 * the number on screen is exactly the number a trade gets. No transaction:
 * marks go on-chain with the trades themselves.
 */
export async function liveQuote(strike: number, expiresS: number) {
  try {
    const [m, sigma, hs, late] = await Promise.all([
      readMark(ASSET),
      publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "sigmaWad" }),
      publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "halfSpread" }),
      publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "lateSecs" }),
    ]);
    const tau = BigInt(Math.max(0, Math.floor(expiresS - Date.now() / 1000)));
    const k = BigInt(Math.round(strike * 1e8));
    const fair = await publicClient.readContract({
      address: MARKET, abi: ropeAbi, functionName: "fairUpAt", args: [m.raw, k, tau, sigma],
    });
    const half = tau <= late ? hs * 2n : hs;
    const yesAsk = fair + half > ONE ? ONE : fair + half;
    const yesBid = fair > half ? fair - half : 0n;
    return { yesBid, yesAsk, fair, mark: m.price };
  } catch {
    return null;
  }
}

/**
 * Settle the round if the bell has rung, then report its state.
 *
 * The close is the mark read at the bell. The contract will only take a close
 * sampled within its window after expiry; if this executor was down for the
 * bell, it passes no price and the round is VOIDED — every share pays half —
 * because a price read late is not the bell's price.
 */
export async function settlement(marketId: `0x${string}`) {
  const id = roundIdOf(marketId);
  let r = await readRound(id);
  if (r.status === TRADING && Date.now() / 1000 >= Number(r.expiresAt)) {
    const bellMs = Number(r.expiresAt) * 1000;
    let mark = 0n;
    let sourceMs = 0n;
    try {
      const m = await boundaryMark(Number(r.expiresAt));
      if (Number(m.sourceMs) >= bellMs && Number(m.sourceMs) <= bellMs + SAMPLE_WINDOW_S * 1000) {
        mark = m.raw;
        sourceMs = m.sourceMs;
      }
    } catch {
      // No price at the bell: settle with none, which voids.
    }
    try {
      const hash = await wallet().writeContract({
        address: MARKET, abi: ropeAbi, functionName: "settle", args: [id, mark, sourceMs],
      });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status === "success") {
        log(`settled round #${id} ${mark ? `at ${Number(mark) / 1e8}` : "with no bell price — VOID"}  tx ${hash.slice(0, 10)}…`);
      }
    } catch (err) {
      // TooEarly: the chain's clock has not reached the bell yet. Next tick.
      if (!revertName(err)?.startsWith("TooEarly")) log(`settle #${id} failed: ${String(err).slice(0, 140)}`);
    }
    r = await readRound(id);
  }
  return {
    onchain: { roundId: id, nonce: id, status: r.status } as Onchain,
    settled: r.status === SETTLED || r.status === VOIDED,
    voided: r.status === VOIDED,
    winningOutcome: r.status === SETTLED ? (r.winner as 0 | 1) : null,
    close: r.close ? Number(r.close) / 1e8 : null,
    strike: Number(r.strike) / 1e8,
  };
}

/** Our shares of one side of a round, raw. */
export async function outcomeBalance(oc: Onchain, account: `0x${string}`, outcomeIdx: 0 | 1) {
  const [up, down] = await publicClient.readContract({
    address: MARKET, abi: ropeAbi, functionName: "sharesOf", args: [oc.roundId, account],
  });
  return outcomeIdx === 0 ? up : down;
}

/** The custom error a call reverted with, e.g. "PriceLimit(510000)". */
export function revertName(err: unknown): string | null {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const d = r.data;
      if (d?.errorName) return `${d.errorName}(${(d.args ?? []).join(",")})`;
      if (r.raw) {
        try {
          const dec = decodeErrorResult({ abi: ropeAbi, data: r.raw });
          return `${dec.errorName}(${(dec.args ?? []).join(",")})`;
        } catch {
          /* fall through */
        }
      }
    }
  }
  return null;
}

/**
 * Re-measure σ from the last hour of Hyperliquid one-minute candles and push
 * it on-chain when it has moved more than 10%. Hourly: volatility regimes
 * change over hours, and a quote priced on a stale σ either gives options
 * away (σ too low) or prices every round as a coin flip (σ too high).
 */
const SIGMA_EVERY_MS = 60 * 60_000;
let sigmaCheckedAt = 0;

export async function refreshSigma() {
  if (Date.now() - sigmaCheckedAt < SIGMA_EVERY_MS) return;
  sigmaCheckedAt = Date.now();
  try {
    const next = await sigmaWad(ASSET);
    const cur = await publicClient.readContract({ address: MARKET, abi: ropeAbi, functionName: "sigmaWad" });
    const drift = Number(next > cur ? next - cur : cur - next) / Number(cur);
    const perMin = ((Number(next) / 1e18) * Math.sqrt(60) * 100).toFixed(3);
    if (drift < 0.1) {
      log(`σ ${ASSET} ≈ ${perMin}% a minute — unchanged on-chain`);
      return;
    }
    const hash = await wallet().writeContract({ address: MARKET, abi: ropeAbi, functionName: "setSigma", args: [next] });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`σ ${ASSET} set to ≈ ${perMin}% a minute (was ${((Number(cur) / 1e18) * Math.sqrt(60) * 100).toFixed(3)}%)  tx ${hash.slice(0, 10)}…`);
  } catch (err) {
    // Keep the last σ; a missed refresh is not worth a stalled round.
    log(`σ refresh failed: ${String(err).slice(0, 120)}`);
  }
}
