"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EXPIRIES, chain, row, countdown, secondsToExpiry, expiresAt, expiryOf, px, type Expiry, type ChainRow } from "@/lib/options";
import { Nav, Footer, usePrice, useNow } from "./Chrome";

type Side = "call" | "put";
type Dir = "buy" | "sell";
interface Pick {
  strike: number;
  side: Side;
}

/** Direction C, "Terminal": the trading screen. Book-shaped, priced by the vault's model until December 1. */
export default function Trade() {
  const price = usePrice();
  const now = useNow();
  const bars = useCandles();
  const [exp, setExp] = useState<Expiry>("15m");
  const [pick, setPick] = useState<Pick | null>(null);
  const [dir, setDir] = useState<Dir>("buy");
  const [kind, setKind] = useState<"limit" | "market">("limit");
  const [limit, setLimit] = useState<string | null>(null);
  const [size, setSize] = useState("10");
  const [view, setView] = useState<"chart" | "chain" | "both">("both");

  const spot = price?.price ?? null;
  const sigma = price?.sigma ?? null;
  const rows = useMemo(() => (spot && sigma ? chain(spot, exp, sigma, 11) : []), [spot, sigma, exp]);

  // Default to the call just above the price; re-anchor when the expiry's strike grid changes.
  useEffect(() => {
    if (!spot || !rows.length) return;
    if (pick && rows.some((r) => r.strike === pick.strike)) return;
    const above = [...rows].reverse().find((r) => r.strike >= spot) ?? rows[0];
    setPick({ strike: above.strike, side: "call" });
  }, [rows, spot, pick]);

  const choose = (r: ChainRow, side: Side, d: Dir) => {
    setPick({ strike: r.strike, side });
    setDir(d);
    setLimit(null);
  };

  const sel = pick && spot && sigma ? row(spot, pick.strike, exp, sigma) : null;
  const ask = sel ? (pick!.side === "call" ? sel.callAsk : sel.putAsk) : null;
  const bid = sel ? (pick!.side === "call" ? sel.callBid : sel.putBid) : null;
  const fair = sel ? (pick!.side === "call" ? sel.call : sel.put) : null;
  const livePx = dir === "buy" ? ask : bid;
  const usePx = kind === "market" || limit === null ? livePx : Number(limit);
  const qty = Math.max(0, Number(size) || 0);

  const spotIdx = rows.findIndex((r) => spot !== null && r.strike < spot);
  const label = pick ? `${pick.strike.toFixed(2)} ${pick.side} · ${exp}` : "…";

  return (
    <div className="rb rb-trade">
      <Nav on="/trade" tight price={price} />
      <div className="main">
        {/* markets + expiries */}
        <aside className="mk">
          <div className="rb-kicker hd">markets</div>
          <button className="m on">
            <span>HYPE</span>
            <small className={price && price.change24h < 0 ? "rb-down" : "rb-up"}>{spot ? spot.toFixed(2) : "…"}</small>
          </button>
          <div className="rb-kicker hd">expiries</div>
          {EXPIRIES.map((e) =>
            e.id === "1m" ? (
              <Link key={e.id} href="/play" className="m">
                <span>1m · Climb</span>
                <small>{now ? countdown(secondsToExpiry(e.id, now)) : "--:--"}</small>
              </Link>
            ) : (
              <button key={e.id} className={`m${exp === e.id ? " on" : ""}`} onClick={() => setExp(e.id)}>
                <span>{e.label}</span>
                <small className={exp === e.id ? "rb-cy" : undefined}>{now ? countdown(secondsToExpiry(e.id, now)) : "--:--"}</small>
              </button>
            ),
          )}
          <p className="aside-note rb-mono rb-faint">One-minute up or down lives in Climb. More markets after launch.</p>
        </aside>

        {/* header, chart, chain */}
        <section className="mid">
          <div className="hdr">
            <b className="title">HYPE options</b>
            <Stat k="index · hyperliquid" v={spot ? `$${spot.toFixed(2)}` : "…"} sub={price ? pct(price.change24h) : ""} subClass={price && price.change24h < 0 ? "rb-down" : "rb-up"} />
            <Stat k="volatility" v={sigma ? `${Math.round(sigma * 100)}%` : "…"} />
            <Stat k={`${expiryOf(exp).label} series expires`} v={now ? `${expiresAt(exp, now)} UTC` : "--:--"} sub={now ? `in ${countdown(secondsToExpiry(exp, now))}` : ""} subClass="rb-cy" />
            <div className="rb-tabs views" role="tablist">
              {(["chart", "chain", "both"] as const).map((v) => (
                <button key={v} className={view === v ? "on" : undefined} onClick={() => setView(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {view !== "chain" && (
            <Chart bars={bars} spot={spot} strikes={rows.map((r) => r.strike)} picked={pick?.strike ?? null} exp={exp} now={now} tall={view === "chart"} />
          )}

          {view !== "chart" && (
            <div className="chainwrap">
              <table className="rb-chain">
                <thead>
                  <tr>
                    <th className="opt">Δ</th>
                    <th className="opt">chance</th>
                    <th>call bid</th>
                    <th>call ask</th>
                    <th className="k">strike</th>
                    <th>put bid</th>
                    <th>put ask</th>
                    <th className="opt">chance</th>
                    <th className="opt">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <ChainLine key={r.strike} r={r} spotRow={i === spotIdx} pick={pick} dir={dir} onPick={choose} />
                  ))}
                  {spotIdx === -1 && rows.length > 0 && (
                    <tr className="spotrow">
                      <td colSpan={9} />
                    </tr>
                  )}
                </tbody>
              </table>
              {!rows.length && <div className="loading rb-mono rb-faint">Reading Hyperliquid…</div>}
              <p className="note rb-mono rb-faint">
                Preview. Prices are the vault&apos;s model (Black-Scholes on the live Hyperliquid price, ±1% spread). Chance is the model&apos;s odds of finishing in the money. The onchain book opens December 1.
              </p>
            </div>
          )}
        </section>

        {/* book, ticket, positions */}
        <aside className="rt">
          <div className="book">
            <div className="rb-kicker">order book · {label}</div>
            <div className="lvls rb-mono rb-num">
              <div className="l faint">
                <span>price</span>
                <span>from</span>
              </div>
              <div className="l">
                <span className="rb-down">{ask !== null ? px(ask) : "…"}</span>
                <span className="rb-faint">vault ask</span>
              </div>
              <div className="l mid">
                <span className="rb-cy">spread {ask !== null && bid !== null ? px(ask - bid) : "…"}</span>
                <span className="rb-faint">fair {fair !== null ? px(fair) : "…"}</span>
              </div>
              <div className="l">
                <span className="rb-up">{bid !== null ? px(bid) : "…"}</span>
                <span className="rb-faint">vault bid</span>
              </div>
            </div>
            <p className="empty rb-mono rb-faint">Traders&apos; limit orders stack here when the book opens. The vault always quotes, so the book is never empty.</p>
          </div>

          <div className="ticket">
            <div className="rb-seg">
              <button className={dir === "buy" ? "buy" : undefined} onClick={() => (setDir("buy"), setLimit(null))}>
                Buy
              </button>
              <button className={dir === "sell" ? "sell" : undefined} onClick={() => (setDir("sell"), setLimit(null))}>
                Sell
              </button>
            </div>
            <div className="rb-seg">
              <button className={kind === "limit" ? "on" : undefined} onClick={() => setKind("limit")}>
                Limit
              </button>
              <button className={kind === "market" ? "on" : undefined} onClick={() => setKind("market")}>
                Market
              </button>
            </div>
            <div>
              <label className="rb-label" htmlFor="px">
                price per option
              </label>
              <div className="rb-field">
                <input
                  id="px"
                  inputMode="decimal"
                  disabled={kind === "market"}
                  value={kind === "market" ? (livePx !== null ? px(livePx) : "") : (limit ?? (livePx !== null ? px(livePx) : ""))}
                  onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))}
                />
                <small>tUSDC</small>
              </div>
            </div>
            <div>
              <label className="rb-label" htmlFor="sz">
                options (1 HYPE each)
              </label>
              <div className="rb-field">
                <input id="sz" inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9]/g, ""))} />
                <small>options</small>
              </div>
            </div>
            <Summary pick={pick} dir={dir} pxEach={usePx} qty={qty} />
            {pick && usePx !== null && spot && <Payoff pick={pick} dir={dir} pxEach={usePx} qty={qty} spot={spot} />}
            <button className="rb-btn big" disabled title="Orders open with the onchain book on December 1">
              Book opens December 1
            </button>
          </div>

          <div className="pos">
            <div className="rb-kicker">positions</div>
            <p className="rb-mono rb-faint">
              None yet. One-minute rounds are live now in <Link href="/play" className="rb-cy">Climb</Link>.
            </p>
          </div>
        </aside>
      </div>
      <Footer />
    </div>
  );
}

function ChainLine({ r, spotRow, pick, dir, onPick }: { r: ChainRow; spotRow: boolean; pick: Pick | null; dir: Dir; onPick: (r: ChainRow, s: Side, d: Dir) => void }) {
  const on = (s: Side, d: Dir) => (pick?.strike === r.strike && pick.side === s && dir === d ? " on" : "");
  return (
    <>
      {spotRow && (
        <tr className="spotrow">
          <td colSpan={9} />
        </tr>
      )}
      <tr className={pick?.strike === r.strike ? "sel" : undefined}>
        <td className="opt rb-faint">{r.delta.toFixed(2)}</td>
        <td className="opt rb-faint">{Math.round(r.above * 100)}%</td>
        <td className={`px rb-up${on("call", "sell")}`} onClick={() => onPick(r, "call", "sell")} title="Sell this call at the bid">
          {px(r.callBid)}
        </td>
        <td className={`px${on("call", "buy")}`} onClick={() => onPick(r, "call", "buy")} title="Buy this call at the ask">
          {px(r.callAsk)}
        </td>
        <td className="k">{r.strike.toFixed(2)}</td>
        <td className={`px rb-down${on("put", "sell")}`} onClick={() => onPick(r, "put", "sell")} title="Sell this put at the bid">
          {px(r.putBid)}
        </td>
        <td className={`px${on("put", "buy")}`} onClick={() => onPick(r, "put", "buy")} title="Buy this put at the ask">
          {px(r.putAsk)}
        </td>
        <td className="opt rb-faint">{Math.round((1 - r.above) * 100)}%</td>
        <td className="opt rb-faint">{(r.delta - 1).toFixed(2)}</td>
      </tr>
    </>
  );
}

function Stat({ k, v, sub, subClass }: { k: string; v: string; sub?: string; subClass?: string }) {
  return (
    <div className="stat">
      <small>{k}</small>
      <b className="rb-num">
        {v} {sub ? <span className={subClass}>{sub}</span> : null}
      </b>
    </div>
  );
}

/**
 * Cost and risk for the ticket. Fully collateralised: a buyer's worst case is
 * the premium; a seller locks the most the option can pay. Calls are capped at
 * one strike's worth of payout, so a seller locks strike − premium either way.
 */
function Summary({ pick, dir, pxEach, qty }: { pick: Pick | null; dir: Dir; pxEach: number | null; qty: number }) {
  if (!pick || pxEach === null || !isFinite(pxEach)) return null;
  const prem = pxEach * qty;
  const be = pick.side === "call" ? pick.strike + pxEach : pick.strike - pxEach;
  const lock = Math.max(0, pick.strike - pxEach) * qty;
  return (
    <div className="sum">
      {dir === "buy" ? (
        <>
          <div className="rb-row">
            <span>you pay</span>
            <b>${prem.toFixed(2)}</b>
          </div>
          <div className="rb-row">
            <span>most you can lose</span>
            <b>${prem.toFixed(2)}</b>
          </div>
        </>
      ) : (
        <>
          <div className="rb-row">
            <span>you receive</span>
            <b>${prem.toFixed(2)}</b>
          </div>
          <div className="rb-row">
            <span>collateral locked</span>
            <b>${lock.toFixed(2)}</b>
          </div>
        </>
      )}
      <div className="rb-row">
        <span>break-even at expiry</span>
        <b>${be.toFixed(2)}</b>
      </div>
    </div>
  );
}

/** Profit or loss at expiry across ±3% of spot. */
function Payoff({ pick, dir, pxEach, qty, spot }: { pick: Pick; dir: Dir; pxEach: number; qty: number; spot: number }) {
  const W = 296;
  const H = 92;
  const lo = spot * 0.97;
  const hi = spot * 1.03;
  const n = 60;
  const pnl = (s: number) => {
    const pay = pick.side === "call" ? Math.min(Math.max(0, s - pick.strike), pick.strike) : Math.max(0, pick.strike - s);
    return (dir === "buy" ? pay - pxEach : pxEach - pay) * Math.max(qty, 1);
  };
  const pts = Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n).map((s) => [s, pnl(s)] as const);
  const ys = pts.map((p) => p[1]);
  const top = Math.max(...ys, 0.0001);
  const bot = Math.min(...ys, -0.0001);
  const x = (s: number) => ((s - lo) / (hi - lo)) * W;
  const y = (v: number) => 8 + ((top - v) / (top - bot)) * (H - 16);
  const line = pts.map(([s, v]) => `${x(s).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <div className="payoff">
      <div className="rb-row">
        <span>profit at expiry</span>
        <span className="rb-faint">HYPE {lo.toFixed(2)} – {hi.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-label="Profit or loss at expiry">
        <defs>
          <clipPath id="above">
            <rect x="0" y="0" width={W} height={y(0)} />
          </clipPath>
          <clipPath id="below">
            <rect x="0" y={y(0)} width={W} height={H} />
          </clipPath>
        </defs>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="rgba(147,217,238,.25)" />
        <line x1={x(spot)} x2={x(spot)} y1="0" y2={H} stroke="rgba(52,183,221,.6)" strokeDasharray="2 3" />
        <polyline points={line} fill="none" stroke="#3FD3A0" strokeWidth="2" clipPath="url(#above)" vectorEffect="non-scaling-stroke" />
        <polyline points={line} fill="none" stroke="#FF6B7A" strokeWidth="2" clipPath="url(#below)" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

/** Real HYPE one-minute closes from Hyperliquid, refreshed every 20 s. */
function useCandles() {
  const [bars, setBars] = useState<{ t: number; c: number }[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/candles")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j?.candles && setBars(j.candles))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return bars;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Two hours of real price, the strike grid as dashed gold lines, and the time
 * left to this series' expiry drawn to the right of "now".
 */
function Chart({ bars, spot, strikes, picked, exp, now, tall }: { bars: { t: number; c: number }[]; spot: number | null; strikes: number[]; picked: number | null; exp: Expiry; now: number | null; tall: boolean }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const H = tall ? 520 : 300;
  const pts = spot && bars.length ? [...bars.map((b) => ({ t: b.t + 60_000, c: b.c })), { t: now ?? Date.now(), c: spot }] : [];
  const tNow = now ?? Date.now();
  const left = secondsToExpiry(exp, tNow) * 1000;
  const ahead = Math.min(left, 40 * 60_000);
  const t0 = tNow - 60 * 60_000;
  const t1 = tNow + Math.max(ahead, 15 * 60_000);
  const shown = strikes.length ? strikes.filter((_, i) => i >= 2 && i <= strikes.length - 3) : [];
  const vals = [...pts.map((p) => p.c), ...shown];
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const pad = (hi - lo) * 0.08 || 0.1;
  const R = 64;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * (W - R);
  const y = (v: number) => H - 26 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 50);
  const line = pts.filter((p) => p.t >= t0).map((p) => `${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const expX = left <= ahead ? x(tNow + left) : null;
  const ticks = [-45, -30, -15].map((m) => Math.floor((tNow + m * 60_000) / 300_000) * 300_000);

  return (
    <div className="chart" ref={ref} style={{ height: H }}>
      {W > 0 && pts.length > 1 && (
        <svg width={W} height={H}>
          <defs>
            <linearGradient id="rbfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(201,162,74,.2)" />
              <stop offset="1" stopColor="rgba(201,162,74,0)" />
            </linearGradient>
          </defs>
          <rect x={x(tNow)} y="0" width={W - R - x(tNow)} height={H} fill="rgba(52,183,221,.035)" />
          {shown.map((k) => (
            <g key={k}>
              <line x1="0" x2={W - R} y1={y(k)} y2={y(k)} stroke={k === picked ? "rgba(52,183,221,.8)" : "rgba(201,162,74,.28)"} strokeDasharray={k === picked ? "0" : "3 5"} />
              <text x={W - R + 8} y={y(k) + 4} fill={k === picked ? "#93D9EE" : "rgba(226,194,122,.85)"} fontFamily="var(--font-mono)" fontSize="11">
                {k.toFixed(2)}
              </text>
            </g>
          ))}
          {ticks.filter((t) => x(t) > 24 && x(t) < x(tNow) - 70).map((t) => (
            <text key={t} x={x(t)} y={H - 8} fill="rgba(248,247,244,.35)" fontFamily="var(--font-mono)" fontSize="10" textAnchor="middle">
              {hhmm(t)}
            </text>
          ))}
          <polyline points={`${line} ${x(tNow)},${H} ${x(pts[0].t < t0 ? t0 : pts[0].t)},${H}`} fill="url(#rbfill)" stroke="none" />
          <polyline points={line} fill="none" stroke="#E2C27A" strokeWidth="2.2" strokeLinejoin="round" />
          <line x1={x(tNow)} x2={x(tNow)} y1="12" y2={H - 22} stroke="rgba(52,183,221,.7)" />
          <text x={x(tNow) - 6} y="22" fill="#93D9EE" fontFamily="var(--font-mono)" fontSize="11" textAnchor="end">
            now
          </text>
          <circle cx={x(tNow)} cy={y(spot!)} r="5" fill="#34B7DD" />
          {expX !== null ? (
            <>
              <line x1={expX} x2={expX} y1="12" y2={H - 22} stroke="rgba(147,217,238,.45)" strokeDasharray="2 4" />
              <text x={expX - 6} y={H - 8} fill="#93D9EE" fontFamily="var(--font-mono)" fontSize="11" textAnchor="end">
                expiry {hhmm(tNow + left)}
              </text>
            </>
          ) : (
            <text x={W - R - 6} y={H - 8} fill="#93D9EE" fontFamily="var(--font-mono)" fontSize="11" textAnchor="end">
              expiry {hhmm(tNow + left)} →
            </text>
          )}
        </svg>
      )}
      {!(W > 0 && pts.length > 1) && <div className="loading rb-mono rb-faint">Reading Hyperliquid…</div>}
    </div>
  );
}

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;
