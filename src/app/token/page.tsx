import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MAINNET_LABEL } from "@/lib/launch";
import { DocsHeader, DocsFooter } from "../docs/DocsChrome";

export const metadata: Metadata = {
  title: "$ROPES · ROPES",
  description: "The plan for $ROPES: backed by game volume, launching on Ascend after Elysium mainnet. Not launched yet.",
  openGraph: { title: "$ROPES", description: "Backed by game volume. Launching on Ascend after Elysium mainnet. Not launched yet.", images: [{ url: "/og/og-token.png", width: 1200, height: 630, alt: "$ROPES, not launched yet" }] },
  twitter: { card: "summary_large_image", site: "@PlayRopes", images: ["/og/og-token.png"] },
};

const ROLE = [
  { art: "/climbers/gold/climb.webp", title: "Backed by game volume", body: "The house vault earns the spread on every trade. Part of that income buys $ROPES, so more rounds played means more buybacks." },
  { art: "/climbers/teal/leap.webp", title: "Holders pick the next rope", body: "Which Hyperliquid market gets a ROPES wall next: BTC, SOL, or the 24/7 S&P for weekends." },
  { art: "/climbers/pink/cheer.webp", title: "Seasons and skins", body: "Seasonal leaderboards and climber skins run on $ROPES." },
];

const LOOP = ["Players ride one-minute ropes", "The spread goes to the house vault", "Vault income buys $ROPES", "Holders vote in the next rope", "A new market brings new players"];

const PATH: { when: string; what: string; state: "done" | "next" | "later" }[] = [
  { when: "Now", what: "ROPES live on Elysium testnet", state: "done" },
  { when: MAINNET_LABEL, what: "Elysium mainnet goes live", state: "next" },
  { when: "Before real money", what: "Security review and per-player custody", state: "later" },
  { when: "Then", what: "ROPES on mainnet with real USDC", state: "later" },
  { when: "Dec 2026 – Jan 2027 (target)", what: "$ROPES launches on Ascend", state: "later" },
];

const OPEN = ["Total supply and allocation", "Launch-pool size on Ascend", "What share of vault income goes to buybacks, and how often", "How votes on the next rope are counted"];

export default function Token() {
  return (
    <div className="docs">
      <DocsHeader section="$ROPES" />
      <main className="tp">
        <section className="mn-hero">
          <div>
            <p className="tp-eyebrow"><span className="dot gold" /> Token plan · not launched</p>
            <h1>$ROPES</h1>
            <p className="doc-lede">
              The token for the one-minute rope. Backed by the volume the game already does, launching on{" "}
              <a href="https://x.com/ascendlaunch" target="_blank" rel="noreferrer">Ascend</a> after ROPES is live on Elysium mainnet.
            </p>
            <div className="tk-chips">
              <span><small>Status</small>Not launched</span>
              <span><small>Launchpad</small>Ascend</span>
              <span><small>Chain</small>Elysium</span>
              <span><small>Target</small>Dec 2026 – Jan 2027</span>
            </div>
          </div>
          <Image src="/logo-full.webp" alt="" width={251} height={657} priority className="mn-art tk-logo" />
        </section>

        <section className="tk-warn">
          <b>$ROPES has not launched.</b> Any &quot;ROPES token&quot; you can buy today is not ours. There is no presale, no
          whitelist and no airdrop. When it launches, the contract address will appear on this page, in a pinned post from{" "}
          <b>@PlayRopes</b>, and on the Ascend launch page linked from here. If any one of the three is missing, it isn&apos;t us.
        </section>

        <h2>What $ROPES does</h2>
        <div className="tk-role">
          {ROLE.map((r) => (
            <div key={r.title}>
              <Image src={r.art} alt="" width={120} height={180} />
              <b>{r.title}</b>
              <p>{r.body}</p>
            </div>
          ))}
        </div>

        <h2>The loop</h2>
        <ol className="tk-loop">
          {LOOP.map((s, i) => <li key={s}><small>{i + 1}</small>{s}</li>)}
        </ol>
        <p className="tp-note">
          The vault&apos;s edge is the spread, not players losing: it quotes both sides at{" "}
          <Link href="/docs/pricing">fair value ± 1%</Link>, and a round can still cost it money. Buybacks come from income
          the vault actually earns, which you can watch on <Link href="/transparency">Transparency</Link>.
        </p>

        <h2>The road to launch</h2>
        <ol className="mn-steps">
          {PATH.map((s) => (
            <li key={s.what} className={s.state}>
              <small>{s.when}</small>
              <b>{s.what}</b>
            </li>
          ))}
        </ol>
        <p className="tp-note">The token follows the product. It launches once ROPES runs on real USDC, not before. <Link href="/mainnet">Mainnet countdown</Link>.</p>

        <div className="mn-split">
          <section>
            <h2>Why Ascend</h2>
            <p className="tk-p">
              Ascend is the launchpad for Elysium projects, and it rewards real holders and real volume. ROPES is a game with
              many small repeat players and a round every minute: steady volume that comes from playing, not from the launch.
            </p>
          </section>
          <section>
            <h2>Still being designed</h2>
            <ul className="mn-list no">
              {OPEN.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <p className="tp-note">These will be published here before launch, not after.</p>
          </section>
        </div>
      </main>
      <DocsFooter />
    </div>
  );
}
