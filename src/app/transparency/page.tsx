import type { Metadata } from "next";
import { getTransparency, PREVIOUS_MARKET } from "@/lib/transparency";
import { addressUrl } from "@/lib/elysium";
import { DocsHeader, DocsFooter } from "../docs/DocsChrome";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Transparency · ROPES",
  description: "Every ROPES round, checked live against Hyperliquid's own candles. Vault, risk and keys, read straight from Elysium.",
};

const usd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Hyperliquid quotes five significant figures, so every price gets the same width. */
const px = (n: number | null) => (n == null ? "—" : n.toFixed(Math.max(0, 4 - Math.floor(Math.log10(Math.abs(n) || 1)))));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const hhmm = (s: number) => new Date(s * 1000).toISOString().slice(11, 16);

function Mark({ ok, pending }: { ok: boolean | null; pending?: boolean }) {
  if (pending) return <span className="tp-dim">pending</span>;
  if (ok === null) return <span className="tp-dim">?</span>;
  return ok ? <span className="tp-ok">✓</span> : <span className="tp-bad">✗</span>;
}

export default async function Transparency() {
  let t;
  try {
    t = await getTransparency();
  } catch (e) {
    return (
      <div className="docs">
        <DocsHeader section="Transparency" />
        <main className="tp"><h1>Transparency</h1><p className="doc-lede">Couldn't reach Elysium right now. Try again in a moment.</p></main>
        <DocsFooter />
      </div>
    );
  }
  const p = t.params;
  const riskUsed = t.free + t.liability > 0 ? (t.liability / (t.free + t.liability)) * 100 : 0;
  return (
    <div className="docs">
      <DocsHeader section="Transparency" />
      <main className="tp">
        <p className="tp-eyebrow"><span className="dot" /> Live from Elysium testnet · refreshed {new Date(t.at).toISOString().slice(11, 19)} UTC</p>
        <h1>What anyone can check</h1>
        <p className="doc-lede">
          Every ROPES round is struck and settled at the open of Hyperliquid&apos;s own 1-minute candle. This page reads the
          market straight from Elysium and checks the latest rounds against Hyperliquid&apos;s published candles.
        </p>

        <section className="tp-stats">
          <div><small>Rounds struck</small><strong>{t.roundCount.toLocaleString()}</strong><span>one every live minute</span></div>
          <div><small>Last {t.rows.filter((r) => !r.midEra).length} rounds checked</small><strong className={t.checked && t.exact === t.checked ? "up" : ""}>{t.exact}/{t.checked}</strong><span>strikes &amp; closes = Hyperliquid candle open</span></div>
          <div><small>House vault</small><strong>{usd(t.vault)}</strong><span>tUSDC · {usd(t.free)} free</span></div>
          <div><small>At risk right now</small><strong>{usd(t.liability)}</strong><span>{riskUsed.toFixed(1)}% of the vault</span></div>
          <div><small>Keeper gas</small><strong>{t.keeperGas.toFixed(4)}</strong><span>HYPE · ≈ {Math.floor(t.keeperRunwayHours)} live hours</span></div>
        </section>

        <h2>Latest rounds, checked against Hyperliquid</h2>
        <p className="tp-note">
          Strike = the {t.asset} candle open for the round&apos;s minute. Close = the open of the candle that starts at the bell.
          A round closed exactly on its strike voids and refunds everyone.
        </p>
        <p className="tp-swipe">Swipe the table sideways for every column →</p>
        <div className="doc-table">
          <table className="tp-table">
            <thead>
              <tr><th>Round</th><th>Minute (UTC)</th><th>Strike</th><th>HL open</th><th></th><th>Close</th><th>HL open</th><th></th><th>Result</th></tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.id} className={r.midEra ? "tp-mid" : ""}>
                  <td>#{r.id}</td>
                  <td>{hhmm(r.opensAt)}</td>
                  <td>{px(r.strike)}</td>
                  <td>{px(r.strikeHL)}</td>
                  <td><Mark ok={r.strikeOk} /></td>
                  <td>{px(r.close)}</td>
                  <td>{r.status === "settled" ? px(r.closeHL) : "—"}</td>
                  <td>{r.status === "settled" ? <Mark ok={r.closeOk} /> : r.status === "open" ? <Mark ok={null} pending /> : "—"}</td>
                  <td>{r.status === "open" ? <span className="tp-dim">riding</span> : r.status === "voided" ? <span className="tp-gold">VOID · refunded</span> : <span className={r.winner === "UP" ? "tp-ok" : "tp-bad"}>{r.winner}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tp-note">
          Rounds before #47 used the book mid and aren&apos;t counted. <a href="/docs/price-source">Why</a>.
        </p>

        <h2>Rules the contract enforces, read live</h2>
        <div className="doc-table">
          <table>
            <tbody>
              <tr><td>Half-spread</td><td>{p.halfSpreadPct}% (doubles in the last {p.lateSecs} s)</td></tr>
              <tr><td>Round risk cap</td><td>{p.roundCapPct}% of the vault&apos;s free balance</td></tr>
              <tr><td>No buying in the last</td><td>{p.buyLockSecs} s</td></tr>
              <tr><td>Trades need a mark at most</td><td>{p.maxStaleSecs} s old</td></tr>
              <tr><td>Strike / close sample window</td><td>{p.sampleWindowSecs} s, or the round voids</td></tr>
              <tr><td>Volatility (σ) in use</td><td>≈ {p.sigmaPerMinPct.toFixed(3)}% a minute</td></tr>
              <tr><td>Gas reserved for the scoreboard</td><td>{p.hookGas.toLocaleString()}</td></tr>
            </tbody>
          </table>
        </div>

        <h2>Keys and what they can do</h2>
        <div className="tp-keys">
          <div>
            <small>Owner</small>
            <a href={addressUrl(t.owner)} target="_blank" rel="noreferrer">{short(t.owner)}</a>
            <p>Can rotate the operator and adjust parameters within fixed bounds. <b>Can&apos;t</b> move user or vault funds.</p>
          </div>
          <div>
            <small>Operator (keeper)</small>
            <a href={addressUrl(t.operator)} target="_blank" rel="noreferrer">{short(t.operator)}</a>
            <p>Relays Hyperliquid prices, opens and settles rounds, routes orders. <b>Can&apos;t</b> settle on a late price or withdraw the vault.</p>
          </div>
          <div>
            <small>Anyone</small>
            <span>—</span>
            <p>Can redeem shares, deposit to or withdraw from the vault (free balance only), and void a round abandoned for 120 s.</p>
          </div>
        </div>

        <h2>Contracts</h2>
        <div className="doc-table">
          <table>
            <tbody>
              <tr><td>RopeMarket ({t.asset})</td><td><a href={addressUrl(t.market)} target="_blank" rel="noreferrer">{t.market}</a></td></tr>
              <tr><td>ArenaRegistry</td><td><a href={addressUrl(t.hook)} target="_blank" rel="noreferrer">{t.hook}</a></td></tr>
              <tr><td>tUSDC (test dollars)</td><td><a href={addressUrl(t.collateral)} target="_blank" rel="noreferrer">{t.collateral}</a></td></tr>
              {t.firstRound > 1 && (
                <tr><td>Previous RopeMarket (rounds before {t.firstRound.toLocaleString()})</td><td><a href={addressUrl(PREVIOUS_MARKET)} target="_blank" rel="noreferrer">{PREVIOUS_MARKET}</a></td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="tp-note">Testnet: tUSDC has no value. On testnet, players&apos; stakes sit in a pooled house wallet; per-player custody comes before mainnet. <a href="/docs/trust-model">Trust model</a>.</p>
      </main>
      <DocsFooter />
    </div>
  );
}
