"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

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

/** The sections that sit in the bar on a wide screen. */
const PRIMARY = [
  { href: "/trade", label: "Trade" },
  { href: "/play", label: "Climb" },
  { href: "/leaders", label: "Leaders" },
  { href: "/transparency", label: "Proof" },
  { href: "/docs/overview", label: "Docs", match: "/docs" },
  { href: "/token", label: "$ROPES" },
];

/** Every section, for the one menu panel on smaller screens. */
const ALL = [
  { href: "/", label: "Home" },
  ...PRIMARY,
  { href: "/wallet", label: "Wallet" },
  { href: "/learn", label: "Learn" },
  { href: "/feedback", label: "Feedback" },
];

function isOn(path: string, l: { href: string; match?: string }) {
  const m = l.match ?? l.href;
  return m === "/" ? path === "/" : path === m || path.startsWith(m + "/");
}

/**
 * The one site bar. Every page uses it, so the sections never move: links in
 * the bar on a wide screen, one Menu button with one panel below 1180px.
 * `inset` drops the side padding for pages that already sit in a padded column;
 * `extra` adds page-specific controls (sound, the bell) beside Wallet.
 */
export function SiteBar({ tight, inset, price: given, extra }: { tight?: boolean; inset?: boolean; price?: Price | null; extra?: ReactNode }) {
  const path = usePathname() ?? "/";
  const polled = usePrice(given === undefined ? 10_000 : 3_600_000);
  const price = given === undefined ? polled : given;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const away = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", esc);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", esc);
      window.removeEventListener("pointerdown", away);
    };
  }, [open]);
  return (
    <nav ref={ref} className={"rbar" + (tight ? " tight" : "") + (inset ? " inset" : "")} aria-label="Site">
      <Link href="/" className="rb-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/knot.webp" alt="" />
        ROPES
      </Link>
      <span className="rb-pill sm rbar-net">testnet</span>
      <div className="rb-links">
        {PRIMARY.map((l) => (
          <Link key={l.href} href={l.href} className={isOn(path, l) ? "on" : undefined} aria-current={isOn(path, l) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="rb-right">
        <span className="rb-pill rb-num rbar-price">
          <i />
          HYPE {price ? "$" + price.price.toFixed(2) : "…"}
        </span>
        {extra}
        <Link href="/wallet" className="rb-btn">
          Wallet
        </Link>
        <button className="rbar-menu" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
          <span className={"rbar-burger" + (open ? " x" : "")} aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="rbar-label">{open ? "Close" : "Menu"}</span>
        </button>
      </div>
      {open && (
        <div id="site-menu" className="rbar-sheet">
          {ALL.map((l) => (
            <Link key={l.href} href={l.href} className={isOn(path, l) ? "on" : undefined}>
              {l.label}
            </Link>
          ))}
          <a href="https://x.com/PlayRopes" target="_blank" rel="noreferrer" className="full">
            @PlayRopes on X ↗
          </a>
        </div>
      )}
    </nav>
  );
}

/** Kept for older imports: the same bar. */
export function Nav({ tight, price }: { on?: string; tight?: boolean; price?: Price | null }) {
  return <SiteBar tight={tight} price={price} />;
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

/** The bar with its own live HYPE price, for server-rendered pages. */
export function LiveNav(props: { on?: string; tight?: boolean }) {
  return <SiteBar tight={props.tight} />;
}
