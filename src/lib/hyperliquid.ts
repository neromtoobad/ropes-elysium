/**
 * The Hyperliquid side: the live mark the rope is tied to, and the volatility
 * the market prices with.
 *
 * Until Elysium's HyperCore read precompile ships (Kinetiq: ~4 weeks after
 * mainnet), the only way to get a Hyperliquid price into an Elysium contract
 * is to carry it there. This module reads Hyperliquid's public info API.
 *
 * Two prices, two jobs:
 *   - the live MID (allMids) prices every trade between bells — it is what the
 *     book says right now;
 *   - the minute CANDLE OPEN (first trade of the minute) is what every round
 *     is struck at and settled on — a published Hyperliquid number that
 *     scripts/audit.ts checks every strike and close against, for equality.
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

/**
 * The OPEN of Hyperliquid's own one-minute candle for the minute starting at
 * `minuteStartMs`: the first trade of that minute. This is what a round is
 * struck at and settled on. Unlike a book mid, it is a published, permanent
 * Hyperliquid number, so anyone can check a strike or a close for exact
 * equality against `candleSnapshot` (scripts/audit.ts does).
 *
 * The candle appears with the minute's first trade, normally within a second
 * or two. Polls until it does, up to `waitMs`; null if it never does (the
 * round then voids rather than settling on something else).
 */
export async function candleOpen(asset: string, minuteStartMs: number, waitMs = 5000): Promise<Mark | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const cs = await candles(asset, minuteStartMs, Date.now() + 1000);
      const c = cs.find((x) => x.t === minuteStartMs);
      if (c) return { price: Number(c.o), raw: toE8(c.o), sourceMs: BigInt(Date.now()) };
    } catch {
      /* retry */
    }
    if (Date.now() > until) return null;
    await new Promise((r) => setTimeout(r, 300));
  }
}
