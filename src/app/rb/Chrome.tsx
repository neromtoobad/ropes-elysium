"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Live HYPE from /api/price (Hyperliquid mark + the vault's volatility). Polls every 3 s. */
export interface Price {
  asset: string;
  price: number;
  change24h: number;
  sigma: number;
  at: number;
}

export function usePrice(everyMs = 3000) {
  const [p, setP] = useState<Price | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/price")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j?.price && setP(j))
        .catch(() => {});
    load();
    const t = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [everyMs]);
  return p;
}

/** A clock that ticks once a second, for countdowns. Null until mounted so server and client HTML match. */
export function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/play", label: "Climb" },
  { href: "/transparency", label: "Proof" },
  { href: "/points", label: "Points" },
  { href: "/docs/overview", label: "Docs" },
];

export function Nav({ on, tight, price }: { on?: string; tight?: boolean; price?: Price | null }) {
  return (
    <nav className={`rb-nav${tight ? " tight" : ""}`}>
      <Link href="/" className="rb-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/knot.webp" alt="" />
        ROPES
      </Link>
      <span className="rb-pill sm">testnet</span>
      <div className="rb-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={on === l.href ? "on" : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="rb-right">
        <span className="rb-pill rb-num">
          <i />
          HYPE {price ? `$${price.price.toFixed(2)}` : "…"}
        </span>
        <Link href="/wallet" className="rb-btn">
          Wallet
        </Link>
      </div>
    </nav>
  );
}

export function Footer() {
  return (
    <footer className="rb-foot">
      <span>
        <b>playropes.xyz</b> &nbsp;·&nbsp; @PlayRopes &nbsp;·&nbsp; We never DM first
      </span>
      <span className="builton">
        built on {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rb/elysium-lockup-light.svg" alt="Elysium" />
      </span>
    </footer>
  );
}
