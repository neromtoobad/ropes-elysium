import Link from "next/link";
import { SiteBar } from "../rb/Chrome";

/** The top bar for /docs, /transparency and /mainnet: the site bar plus the news line. */
export function DocsHeader({ section }: { section: string }) {
  return (
    <header className="docs-top" aria-label={section}>
      <div className="docs-top-in">
        <SiteBar inset />
      </div>
      <div className="docs-banner">
        <span className="dot" /> The options book opens on testnet <b>December 1</b>. Climb runs every minute now.{" "}
        <Link href="/trade" className="docs-banner-link">See the book →</Link>
      </div>
    </header>
  );
}

export function DocsFooter() {
  return (
    <footer className="docs-foot">
      <span>ROPES · the onchain options exchange for Hyperliquid</span>
      <span>
        Only trust <b>@PlayRopes</b> and <b>playropes.xyz</b>. $ROPES is not launched yet. We never DM first.
      </span>
    </footer>
  );
}
