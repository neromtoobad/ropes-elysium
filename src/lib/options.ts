/**
 * Option maths for the new site: Black-Scholes with r = 0, the same model the
 * ROPES vault already prices its one-minute rounds with (RopeMarket.sol uses
 * Φ(d₂) for the digital). Used to draw the preview chain and ladder before the
 * onchain book opens, and later as the backstop vault's reference curve.
 */

export type Expiry = "1m" | "5m" | "15m" | "1h" | "1d";

export const EXPIRIES: { id: Expiry; label: string; minutes: number; every: string; step: number }[] = [
  { id: "1m", label: "1 min", minutes: 1, every: "Climb · up or down", step: 0.05 },
  { id: "5m", label: "5 min", minutes: 5, every: "new every 5 minutes", step: 0.05 },
  { id: "15m", label: "15 min", minutes: 15, every: "new every 15 minutes", step: 0.1 },
  { id: "1h", label: "1 hour", minutes: 60, every: "new every hour", step: 0.25 },
  { id: "1d", label: "1 day", minutes: 1440, every: "new daily at 08:00 UTC", step: 1 },
];

export const expiryOf = (id: Expiry) => EXPIRIES.find((e) => e.id === id)!;

const MIN_PER_YEAR = 525_600;

/** Abramowitz–Stegun 7.1.26, |error| < 1.5e-7: plenty for display prices. */
function erf(x: number) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
export const N = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

export interface Quote {
  call: number;
  put: number;
  /** Call delta; put delta is callDelta − 1. */
  delta: number;
  /** Probability the price finishes above the strike (the digital's fair value). */
  above: number;
}

/** Fair values for one strike. `sigma` is annualised (0.78 = 78%). */
export function quote(spot: number, strike: number, minutes: number, sigma: number): Quote {
  const v = sigma * Math.sqrt(Math.max(minutes, 1e-6) / MIN_PER_YEAR);
  const d1 = (Math.log(spot / strike) + (v * v) / 2) / v;
  const d2 = d1 - v;
  const call = spot * N(d1) - strike * N(d2);
  return { call, put: call - spot + strike, delta: N(d1), above: N(d2) };
}

export interface ChainRow extends Quote {
  strike: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
}

/** One strike, quoted with the vault's ±half-spread (never tighter than a 0.001 tick). */
export function row(spot: number, strike: number, expiry: Expiry, sigma: number, halfSpread = 0.01): ChainRow {
  const q = quote(spot, strike, expiryOf(expiry).minutes, sigma);
  const s = (x: number) => Math.max(0.001, x * halfSpread);
  return {
    ...q,
    strike,
    callBid: Math.max(0, q.call - s(q.call)),
    callAsk: q.call + s(q.call),
    putBid: Math.max(0, q.put - s(q.put)),
    putAsk: q.put + s(q.put),
  };
}

/** Strikes on the expiry's grid around spot, highest first. */
export function chain(spot: number, expiry: Expiry, sigma: number, count = 11, halfSpread = 0.01): ChainRow[] {
  const { step } = expiryOf(expiry);
  const mid = Math.round(spot / step) * step;
  const half = Math.floor(count / 2);
  const rows: ChainRow[] = [];
  for (let i = half; i >= -half; i--) rows.push(row(spot, +(mid + i * step).toFixed(2), expiry, sigma, halfSpread));
  return rows;
}

/** Seconds until the next expiry of a rolling series (all aligned to UTC). */
export function secondsToExpiry(expiry: Expiry, nowMs = Date.now()) {
  const { minutes } = expiryOf(expiry);
  if (expiry === "1d") {
    const d = new Date(nowMs);
    let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 8);
    if (next <= nowMs) next += 86_400_000;
    return Math.ceil((next - nowMs) / 1000);
  }
  const period = minutes * 60_000;
  return Math.ceil((period - (nowMs % period)) / 1000);
}

export function countdown(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

/** The UTC clock time a series expires, e.g. "14:45". */
export function expiresAt(expiry: Expiry, nowMs = Date.now()) {
  const t = new Date(nowMs + secondsToExpiry(expiry, nowMs) * 1000);
  return `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
}

export const px = (x: number, d = 3) => x.toFixed(d);
