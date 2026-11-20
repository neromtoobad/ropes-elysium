"use client";

import { chain, px, type Expiry, type ChainRow } from "@/lib/options";

/**
 * The rope ladder: one rung per strike, calls on the left, puts on the right,
 * the climber hanging at the live price. Prices are the vault's model quotes
 * (Black-Scholes, ±1% half-spread) until the onchain book opens.
 */
export function Ladder({
  spot,
  sigma,
  expiry,
  count = 9,
  picked,
  onPick,
}: {
  spot: number;
  sigma: number;
  expiry: Expiry;
  count?: number;
  picked?: { strike: number; side: "call" | "put" } | null;
  onPick?: (row: ChainRow, side: "call" | "put") => void;
}) {
  const rows = chain(spot, expiry, sigma, count);
  const spotAt = rows.findIndex((r) => r.strike < spot);
  const isPicked = (r: ChainRow, side: "call" | "put") => picked?.strike === r.strike && picked.side === side;

  return (
    <div className="rb-ladder">
      <div className="rope" />
      <div className="rb-ladder-head rb-mono" aria-hidden>
        <span>calls · ask</span>
        <span />
        <span>puts · ask</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.strike}>
          {i === spotAt && <Spot spot={spot} />}
          <div className="rb-rung">
            <div className="bar" />
            <div className="l">
              <span className="rb-chip bidchip" title="best bid for the call">
                <small>bid</small>
                <span className="rb-up">{px(r.callBid)}</span>
              </span>
              <button className={`rb-chip${isPicked(r, "call") ? " sel" : ""}`} onClick={() => onPick?.(r, "call")} title={`Buy the ${r.strike.toFixed(2)} call`}>
                <small>call</small>
                {px(r.callAsk)}
              </button>
            </div>
            <span className="k">{r.strike.toFixed(2)}</span>
            <div className="r">
              <button className={`rb-chip${isPicked(r, "put") ? " sel" : ""}`} onClick={() => onPick?.(r, "put")} title={`Buy the ${r.strike.toFixed(2)} put`}>
                <small>put</small>
                {px(r.putAsk)}
              </button>
              <span className="rb-chip bidchip" title="best bid for the put">
                <small>bid</small>
                <span className="rb-down">{px(r.putBid)}</span>
              </span>
            </div>
          </div>
        </div>
      ))}
      {spotAt === -1 && <Spot spot={spot} />}
    </div>
  );
}

function Spot({ spot }: { spot: number }) {
  return (
    <div className="rb-spot">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/climbers/green/climb.webp" alt="" />
      <div className="lab">
        <span className="rb-pill rb-num">
          <i />
          HYPE {spot.toFixed(2)}
          <span className="now"> · now</span>
        </span>
      </div>
    </div>
  );
}
