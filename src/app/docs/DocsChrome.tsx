import Link from "next/link";
import Image from "next/image";

/** The top bar shared by /docs and /transparency. */
export function DocsHeader({ section }: { section: string }) {
  return (
    <header className="docs-top">
      <div className="docs-top-in">
        <Link href="/" className="docs-brand">
          <Image src="/logo-full.webp" alt="" width={251} height={657} className="h-8 w-auto" />
          <span className="display">ROPES</span>
          <span className="docs-crumb">{section}</span>
        </Link>
        <nav className="docs-top-nav">
          <Link href="/docs/overview">Docs</Link>
          <Link href="/transparency">Transparency</Link>
          <Link href="/mainnet">Mainnet</Link>
          <Link href="/token">$ROPES</Link>
          <a href="https://github.com/neromtoobad/ropes-elysium" target="_blank" rel="noreferrer">GitHub</a>
          <a href="https://x.com/PlayRopes" target="_blank" rel="noreferrer">X</a>
          <Link href="/play" className="docs-cta">Play →</Link>
        </nav>
      </div>
      <div className="docs-banner">
        <span className="dot" /> Elysium mainnet goes live <b>Nov 9, 2026</b>. ROPES is live on testnet now.{" "}
        <Link href="/mainnet" className="docs-banner-link">Countdown →</Link>
      </div>
    </header>
  );
}

export function DocsFooter() {
  return (
    <footer className="docs-foot">
      <span>ROPES · one minute of Hyperliquid, on a rope</span>
      <span>
        Only trust <b>@PlayRopes</b> and <b>ropes.nerom.site</b>. $ROPES is not launched yet. We never DM first.
      </span>
    </footer>
  );
}
