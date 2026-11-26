import type { Metadata } from "next";
import Link from "next/link";
import { LiveNav, Footer } from "../rb/Chrome";

export const metadata: Metadata = {
  title: "$ROPES · ROPES",
  description: "The token of the ROPES options book: 1B fixed supply, a fair launch with no presale, and buybacks paid for by real trading fees. Not launched yet.",
  openGraph: { title: "$ROPES", description: "1B fixed supply. Fair launch, no presale. 60% of protocol revenue buys back and burns $ROPES. Not launched yet.", images: [{ url: "/og/og-token.png", width: 1200, height: 630, alt: "$ROPES" }] },
  twitter: { card: "summary_large_image", site: "@PlayRopes", images: ["/og/og-token.png"] },
};

/** The launch contract address. Empty until launch; the page says "not launched" while it is. */
const ADDRESS = process.env.NEXT_PUBLIC_ROPES_TOKEN ?? "";

const ALLOC = [
  { k: "Fair launch pool", p: 45, c: "#34b7dd", how: "In the launch pool from day one. Only circulates when someone buys it at market. Liquidity locked forever." },
  { k: "Trading rewards", p: 15, c: "#3fd3a0", how: "Weekly over 36 months from mainnet, capped by the fees each wallet pays." },
  { k: "Team", p: 15, c: "#e2c27a", how: "Nothing for 12 months, then monthly over 24. Public vesting contract." },
  { k: "Treasury & growth", p: 15, c: "#9b8cff", how: "Locked 6 months, then monthly over 24. Multisig, every spend posted." },
  { k: "Season 0 airdrop", p: 5, c: "#ff8fc7", how: "Testnet players, by ROPES Points. Claim 50% now or 100% over 90 days." },
  { k: "Liquidity reserve", p: 5, c: "#93d9ee", how: "Locked. Only seeds new listings, announced 7 days ahead." },
];

const SPLIT = [
  { p: 60, k: "Buy and burn $ROPES", d: "Bought on the open market, then sent to a dead address.", c: "rb-gold" },
  { p: 10, k: "Buy and burn KNTQ", d: "Our share in the network we build on.", c: "rb-cy" },
  { p: 30, k: "Security and operations", d: "Audits, bug bounty, keeper gas, running the book.", c: "rb-mute" },
];

const CHECKS = [
  ["Mint renounced", "Supply is fixed at 1,000,000,000. Nobody can mint more."],
  ["Liquidity locked forever", "The launch pool position can never be withdrawn."],
  ["Team vesting onchain", "12 months locked, then 24 monthly releases, in a public contract."],
  ["Buybacks are public", "Every week's revenue, buy and burn, with transactions, on /transparency."],
  ["No insider deals", "No presale, no private round, no OTC sales, no hidden loans."],
  ["Audit before real money", "The book reaches mainnet only after an outside audit."],
];

function Donut() {
  const R = 130, r = 88, cx = 140, cy = 140;
  let a0 = -Math.PI / 2;
  const P = (rad: number, ang: number) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
  return (
    <svg viewBox="0 0 280 280" className="donut" role="img" aria-label="Allocation of 1 billion $ROPES">
      {ALLOC.map((x) => {
        const a1 = a0 + (x.p / 100) * Math.PI * 2;
        const A = a0 + 0.014, B = a1 - 0.014, big = B - A > Math.PI ? 1 : 0;
        a0 = a1;
        return <path key={x.k} d={`M${P(R, A)} A${R},${R} 0 ${big} 1 ${P(R, B)} L${P(r, B)} A${r},${r} 0 ${big} 0 ${P(r, A)} Z`} fill={x.c} />;
      })}
      <text x="140" y="138" textAnchor="middle" fill="#f8f7f4" fontSize="38" fontWeight="500" fontFamily="var(--font-sans)">1B</text>
      <text x="140" y="162" textAnchor="middle" fill="rgba(248,247,244,.55)" fontSize="11" fontFamily="var(--font-mono)">$ROPES, hard cap</text>
    </svg>
  );
}

export default function Token() {
  return (
    <div className="rb rb-token">
      <div className="rb-wrap">
        <LiveNav />
        <header className="hero">
          <span className="rb-pill">
            <i />
            {ADDRESS ? "Live on Elysium" : "Not launched yet"}
          </span>
          <h1>
            <span className="rb-gold">$</span>ROPES
          </h1>
          <p>The token of the onchain options book. One billion tokens, a fair launch with no presale, and buybacks paid for by real trading fees.</p>
          <div className="chips">
            <span><small>supply</small>1,000,000,000</span>
            <span><small>launch</small>Fair, no presale</span>
            <span><small>chain</small>Elysium</span>
            <span><small>revenue to buyback</small>60%</span>
          </div>
          <div className="ctas">
            <a href="/ROPES-Tokenomics.pdf" className="rb-btn big" target="_blank" rel="noreferrer">
              Read the token paper
            </a>
            <Link href="/docs/token" className="rb-btn big ghost">
              Docs
            </Link>
          </div>
        </header>

        <section className={`warn rb-panel${ADDRESS ? " live" : ""}`}>
          {ADDRESS ? (
            <>
              <b>The only $ROPES contract:</b> <code className="rb-mono">{ADDRESS}</code>. It is also in a pinned post from @PlayRopes. If an address doesn&apos;t match both, it isn&apos;t us.
            </>
          ) : (
            <>
              <b>$ROPES has not launched.</b> Any &quot;ROPES token&quot; you can buy today is not ours. When it launches, the address appears here and in a pinned post from <b>@PlayRopes</b>. If either is missing, it isn&apos;t us. We never DM first.
            </>
          )}
        </section>

        <div className="rb-center gap">
          <div className="rb-kicker">1,000,000,000 · fixed</div>
          <h2 className="rb-h2">
            Who gets <em>what</em>.
          </h2>
        </div>
        <section className="alloc rb-panel">
          <Donut />
          <table>
            <tbody>
              {ALLOC.map((x) => (
                <tr key={x.k}>
                  <td>
                    <i style={{ background: x.c }} />
                    {x.k}
                  </td>
                  <td className="rb-mono rb-num">{x.p}%</td>
                  <td>{x.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="rb-center gap">
          <div className="rb-kicker">from trades to burns</div>
          <h2 className="rb-h2">
            Fees in, <em>tokens out</em>.
          </h2>
        </div>
        <section className="split">
          {SPLIT.map((s) => (
            <div key={s.k} className="rb-panel">
              <strong className={s.c}>{s.p}%</strong>
              <b>{s.k}</b>
              <p>{s.d}</p>
            </div>
          ))}
        </section>
        <p className="note rb-mono rb-faint">
          Revenue is book fees, 20% of the backstop vault&apos;s profit, Climb fees and the launch pool&apos;s 1% swap fee. Before mainnet, only the pool fee is real revenue. Every buy and burn will be listed on <Link href="/transparency" className="rb-cy">/transparency</Link>.
        </p>

        <div className="rb-center gap">
          <div className="rb-kicker">how it launches</div>
          <h2 className="rb-h2">
            One pool, <em>open to everyone</em>.
          </h2>
        </div>
        <section className="launch">
          {[
            ["Same price for everyone", "All 450M launch tokens sit in one $ROPES/HYPE pool on Elysium. Everyone buys from the same curve, the team included."],
            ["Starts small", "The pool opens at a 1,000 HYPE valuation and rises only as people buy."],
            ["Snipers pay the protocol", "The swap fee starts high and falls to 1% in the first minutes. What bots pay goes to the buyback."],
            ["Locked forever", "The pool position can never be pulled. Its 1% fee is protocol revenue from the first trade."],
          ].map(([k, d], i) => (
            <div key={k} className="rb-panel">
              <span className="n rb-mono">{i + 1}</span>
              <b>{k}</b>
              <p>{d}</p>
            </div>
          ))}
        </section>

        <div className="rb-center gap">
          <div className="rb-kicker">what we commit to</div>
          <h2 className="rb-h2">
            Don&apos;t trust it. <em>Check it</em>.
          </h2>
        </div>
        <section className="checks">
          {CHECKS.map(([k, d]) => (
            <div key={k}>
              <i>✓</i>
              <b>{k}</b>
              <p>{d}</p>
            </div>
          ))}
        </section>

        <p className="risk rb-mono rb-faint">
          $ROPES can lose most or all of its value. Buybacks depend on revenue, and the book earns no real fees until mainnet. This page is not an offer to sell, not investment advice and not a promise of profit.
        </p>
        <div style={{ height: 80 }} />
        <Footer />
      </div>
    </div>
  );
}
