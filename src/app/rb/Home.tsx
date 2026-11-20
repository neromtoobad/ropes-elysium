"use client";

import Link from "next/link";
import { useState } from "react";
import { EXPIRIES, quote, countdown, secondsToExpiry, expiresAt, px, type Expiry } from "@/lib/options";
import { Nav, Footer, usePrice, useNow } from "./Chrome";
import { Ladder } from "./Ladder";

/** Direction B, "Ladder": the product is the hero. */
export default function Home({ rounds }: { rounds: number | null }) {
  const price = usePrice();
  const now = useNow();
  const [exp, setExp] = useState<Expiry>("15m");
  const live = EXPIRIES.find((e) => e.id === exp)!;

  return (
    <div className="rb rb-home">
      <div className="sky">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rb/sky-b.webp" alt="" />
      </div>
      <div className="rb-wrap">
        <Nav price={price} />

        <header className="hero">
          <span className="rb-pill">
            <i />
            The book opens December 1 · testnet
          </span>
          <h1>
            Every minute
            <br />
            is an <em>expiry</em>.
          </h1>
          <p>ROPES is an options exchange for HYPE. Pick a price on the rope, buy or sell, and get paid on Hyperliquid&apos;s price at expiry. All onchain.</p>
          <div className="ctas">
            <Link href="/trade" className="rb-btn big">
              Open the book
            </Link>
            <Link href="/play" className="rb-btn big ghost">
              Play Climb
            </Link>
          </div>
        </header>

        <section className="stage rb-panel">
          <div className="bar">
            <span className="rb-kicker rb-num">
              HYPE · {live.label} series · expires {now ? expiresAt(exp, now) : "--:--"} UTC · in {now ? countdown(secondsToExpiry(exp, now)) : "--:--"}
            </span>
            <div className="rb-tabs" role="tablist">
              {EXPIRIES.map((e) => (
                <button key={e.id} className={e.id === exp ? "on" : undefined} onClick={() => setExp(e.id)} role="tab" aria-selected={e.id === exp}>
                  {e.id}
                </button>
              ))}
            </div>
          </div>
          {price ? (
            <Ladder spot={price.price} sigma={price.sigma} expiry={exp} count={9} onPick={() => (window.location.href = "/trade")} />
          ) : (
            <div className="loading rb-mono rb-faint">Reading Hyperliquid…</div>
          )}
          <p className="note rb-mono rb-faint">Preview. Prices come from the vault&apos;s pricing model on the live Hyperliquid price until the onchain book opens on December 1.</p>
        </section>

        <div className="rb-center gap">
          <div className="rb-kicker">from one minute to one day</div>
          <h2 className="rb-h2">
            Pick your <em>expiry</em>.
          </h2>
        </div>
        <section className="rail rb-panel">
          <div className="line" />
          <div className="pts">
            {EXPIRIES.map((e) => (
              <button key={e.id} className={e.id === exp ? "on" : undefined} onClick={() => setExp(e.id)}>
                <div className="dot" />
                <b>{e.label}</b>
                <span className="rb-num">{e.every}</span>
                <span className="rb-num rb-cy">next in {now ? countdown(secondsToExpiry(e.id, now)) : "--:--"}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="rb-center gap">
          <div className="rb-kicker">what people use it for</div>
          <h2 className="rb-h2">
            Protect. Earn. <em>Bet.</em>
          </h2>
        </div>
        <Uses spot={price?.price ?? null} sigma={price?.sigma ?? null} />

        <section className="proof rb-panel">
          <div>
            <div className="rb-kicker">since october 18</div>
            <h3>Already running on Elysium.</h3>
          </div>
          <div>
            <strong className="rb-num">{rounds ? rounds.toLocaleString("en-US") : "13,000+"}</strong>
            <span>one-minute options settled onchain</span>
          </div>
          <div>
            <strong>Every</strong>
            <span>strike and close checked against Hyperliquid</span>
          </div>
          <div>
            <Link href="/transparency" className="rb-btn ghost">
              See the proof
            </Link>
          </div>
        </section>

        <div style={{ height: 110 }} />
        <Footer />
      </div>
    </div>
  );
}

/** Three plain examples, priced live from the same model. */
function Uses({ spot, sigma }: { spot: number | null; sigma: number | null }) {
  const ex = (k: number, minutes: number, side: "call" | "put") => (spot && sigma ? quote(spot, k, minutes, sigma)[side] : null);
  const round = (x: number, step: number) => Math.round(x / step) * step;
  const protectK = spot ? round(spot * 0.99, 0.25) : null;
  const earnK = spot ? round(spot * 1.02, 1) : null;
  const betK = spot ? Math.ceil(spot / 0.1) * 0.1 : null;
  const line = (k: number | null, label: string, v: number | null, verb: string) => (k && v !== null ? `${k.toFixed(2)} ${label} · ${verb} ${px(v)} each` : "…");

  return (
    <section className="uses">
      <div className="rb-panel">
        <div className="rb-kicker">protect</div>
        <h3>Insure a position</h3>
        <p>Long HYPE on Hyperliquid? Buy a put for the next hour. If the price drops below it, the put pays.</p>
        <div className="ex rb-mono">{line(protectK, "put · 1h", protectK ? ex(protectK, 60, "put") : null, "costs")}</div>
      </div>
      <div className="rb-panel">
        <div className="rb-kicker">earn</div>
        <h3>Get paid to wait</h3>
        <p>Sell a call above the price on HYPE you already hold, and keep the premium.</p>
        <div className="ex rb-mono">{line(earnK, "call · 1d", earnK ? ex(earnK, 1440, "call") : null, "pays")}</div>
      </div>
      <div className="rb-panel">
        <div className="rb-kicker">bet</div>
        <h3>Take a quick view</h3>
        <p>Think HYPE climbs in the next 15 minutes? Buy a call. The most you can lose is what you paid.</p>
        <div className="ex rb-mono">{line(betK, "call · 15m", betK ? ex(betK, 15, "call") : null, "costs")}</div>
      </div>
    </section>
  );
}
