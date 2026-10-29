import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTransparency, type Transparency } from "@/lib/transparency";
import { GOOGLE_CAL, MAINNET_LABEL } from "@/lib/launch";
import { DocsHeader, DocsFooter } from "../docs/DocsChrome";
import { Countdown } from "./Countdown";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mainnet · ROPES",
  description: `Elysium mainnet goes live ${MAINNET_LABEL}. What ROPES ships, in what order, and what works today.`,
  openGraph: { title: "ROPES → mainnet", description: `Elysium mainnet goes live ${MAINNET_LABEL}. Here's the ROPES plan.`, images: [{ url: "/og/og-mainnet.png", width: 1200, height: 630, alt: "Elysium mainnet, Nov 9" }] },
  twitter: { card: "summary_large_image", site: "@PlayRopes", images: ["/og/og-mainnet.png"] },
};

const STEPS: { when: string; what: string; detail: string; state: "done" | "next" | "later" }[] = [
  { when: "Now", what: "Live on Elysium testnet", detail: "A round every live minute, struck and settled at Hyperliquid's candle open, checked in public.", state: "done" },
  { when: MAINNET_LABEL, what: "Elysium mainnet goes live", detail: "Kinetiq's Hyperliquid L2 opens. ROPES keeps running on testnet that day.", state: "next" },
  { when: "Before real money", what: "Security review and per-player custody", detail: "The review report is published, and every player's position is held on-chain in their own name.", state: "later" },
  { when: "ROPES mainnet", what: "One-minute HYPE rounds on real USDC", detail: "The same contracts and rules, with a seeded house vault and the round risk cap in force.", state: "later" },
  { when: "Launch", what: "$ROPES on Ascend", detail: "The token goes live; house-vault spread income funds buybacks.", state: "later" },
  { when: "≈ 4 weeks after", what: "No keeper", detail: "Prices read on-chain through the HyperCore precompile, so anyone can trade without a relayer.", state: "later" },
];

const WORKS = [
  ["One-minute HYPE rounds", "/docs/how-a-round-works"],
  ["Strike and close at Hyperliquid's candle open", "/docs/price-source"],
  ["On-chain market maker: there's always a price", "/docs/pricing"],
  ["BAIL any second until the bell", "/docs/bail"],
  ["Voids refund everyone's cost", "/docs/voids"],
  ["Every round checked in public", "/transparency"],
] as const;

const NOT_YET = [
  "Real USDC (testnet uses tUSDC, which has no value)",
  "Per-player custody (testnet stakes sit in a pooled house wallet)",
  "A published security review",
  "Keeper-free prices through the HyperCore precompile",
  "$ROPES (not launched; nothing you see today is ours)",
];

export default async function Mainnet() {
  let t: Transparency | null = null;
  try {
    t = await getTransparency();
  } catch {
    /* the proof strip just hides */
  }
  return (
    <div className="docs">
      <DocsHeader section="Mainnet" />
      <main className="tp">
        <section className="mn-hero">
          <div>
            <p className="tp-eyebrow"><span className="dot" /> Elysium mainnet · {MAINNET_LABEL}</p>
            <h1>ROPES is going to mainnet</h1>
            <p className="doc-lede">
              Elysium, Kinetiq&apos;s Hyperliquid L2, goes live on {MAINNET_LABEL}. ROPES has run on its testnet since
              Oct 18: one minute of HYPE, on a rope, every round checked against Hyperliquid.
            </p>
            <Countdown />
            <p className="tp-note">Counting to the start of {MAINNET_LABEL} UTC. Elysium sets the exact hour.</p>
            <div className="mn-ctas">
              <a href={GOOGLE_CAL} target="_blank" rel="noreferrer" className="mn-btn gold">Add to Google Calendar</a>
              <a href="/mainnet/calendar.ics" className="mn-btn">Download .ics</a>
              <a href="https://x.com/PlayRopes" target="_blank" rel="noreferrer" className="mn-btn">Follow @PlayRopes</a>
              <Link href="/play" className="mn-btn up">Play on testnet now →</Link>
            </div>
          </div>
          <Image src="/climbers/gold/cheer.webp" alt="" width={270} height={420} priority className="mn-art" />
        </section>

        {t && (
          <section className="mn-proof">
            <div><strong>{t.roundCount.toLocaleString()}</strong><span>rounds struck on testnet</span></div>
            <div><strong className="up">{t.exact}/{t.checked}</strong><span>latest strikes &amp; closes exact to Hyperliquid</span></div>
            <div><strong>{t.params.halfSpreadPct}%</strong><span>half-spread, fixed in the contract</span></div>
            <Link href="/transparency">See every round →</Link>
          </section>
        )}

        <h2>What ships, in order</h2>
        <ol className="mn-steps">
          {STEPS.map((s) => (
            <li key={s.what} className={s.state}>
              <small>{s.when}</small>
              <b>{s.what}</b>
              <p>{s.detail}</p>
            </li>
          ))}
        </ol>
        <p className="tp-note">ROPES moves to real money when it&apos;s reviewed, not on a date. <Link href="/docs/roadmap">Full roadmap</Link>.</p>

        <div className="mn-split">
          <section>
            <h2>What works today</h2>
            <ul className="mn-list ok">
              {WORKS.map(([w, href]) => <li key={w}><Link href={href}>{w}</Link></li>)}
            </ul>
          </section>
          <section>
            <h2>What doesn&apos;t work yet</h2>
            <ul className="mn-list no">
              {NOT_YET.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </section>
        </div>

        <section className="mn-safe">
          <b>Stay safe before launch.</b> There is no presale, no whitelist and no airdrop form. We never DM first. The
          only places ROPES announces anything are <b>@PlayRopes</b> and <b>playropes.xyz</b>.{" "}
          <Link href="/token">About $ROPES →</Link>
        </section>
      </main>
      <DocsFooter />
    </div>
  );
}
