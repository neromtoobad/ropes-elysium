"use client";

/**
 * ROPES Points. Your card (points, league, rank, handle, invite link) over
 * the season table. Everything is computed from ranked runs (lib/points);
 * this page only reads it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, usePlayerKey, useClimberTheme, short } from "../shared";

type Row = { wallet: string; name: string; handle: string | null; points: number; day: number; rank: number; prevRank: number | null; league: string };
type Rules = { seat: number; round: number; bankPerX: number; bankCap: number; champion: number; daily: number; summit: number[]; longest: number[]; inviteShare: number };
type Table = { season: { name: string; sub: string }; at: string; rules: Rules; leagues: { id: string; name: string; min: number }[]; total: number; rows: Row[] };
type Me = {
  wallet: string | null;
  handle?: string | null;
  inviteCode?: string;
  invitedBy?: boolean;
  points?: number;
  day?: number;
  rank?: number | null;
  prevRank?: number | null;
  of?: number;
  league?: { name: string; min: number; next: { name: string; min: number } | null };
  invited?: number;
  fromInvites?: number;
};

const num = (n: number) => n.toLocaleString("en-US");

function Move({ rank, prev }: { rank: number; prev: number | null }) {
  if (prev === null) return <span className="text-[9px] font-black tracking-[0.15em] text-[var(--gold)]">NEW</span>;
  const d = prev - rank;
  if (d === 0) return <span className="text-[10px] font-bold text-[var(--dim)]">–</span>;
  return (
    <span className="tabular text-[10px] font-black" style={{ color: d > 0 ? "var(--up)" : "var(--down)" }}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

export default function Points() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const [table, setTable] = useState<Table | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"season" | "day">("season");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const load = () =>
      fetch("/api/points")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.rows && setTable(j))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!playerKey) return;
    fetch("/api/points/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerKey }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setMe(j))
      .catch(() => {});
  }, [playerKey, refresh]);

  const rows = table
    ? tab === "season"
      ? table.rows
      : [...table.rows].filter((r) => r.day > 0).sort((a, b) => b.day - a.day)
    : null;

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-5xl px-4 py-4">
      <PageHeader title="ROPES POINTS" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">
            {table ? `${table.season.name} · ${table.season.sub}` : "SEASON 0 · TESTNET"}
          </p>
          <h2 className="display mt-1 text-3xl leading-none sm:text-4xl">Climb the leagues.</h2>
        </div>
        <p className="text-[10px] font-bold tracking-[0.22em] text-[var(--dim)]">
          RANKED SEATS ONLY · LIVE, NOT SNAPSHOTS
        </p>
      </div>

      <MyCard me={me} playerKey={playerKey} onSaved={() => setRefresh((n) => n + 1)} />

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex gap-1" role="tablist">
              {(["season", "day"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`gametab whitespace-nowrap ${tab === t ? "active" : ""}`}>
                  {t === "season" ? "SEASON" : "LAST 24H"}
                </button>
              ))}
            </div>
            {table && (
              <span className="hidden text-[9px] font-bold tracking-[0.2em] text-[var(--dim)] sm:inline">
                {num(table.total)} CLIMBER{table.total === 1 ? "" : "S"} · ▲▼ = MOVES SINCE YESTERDAY
              </span>
            )}
          </div>
          {!rows ? (
            <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">COUNTING POINTS…</p>
          ) : rows.length === 0 ? (
            <div className="chamfer-sm border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
              <p className="text-sm font-bold">{tab === "day" ? "Nobody has scored in the last 24 hours." : "Nobody on the table yet."}</p>
              <p className="mt-1 text-[11px] text-[var(--dim)]">The first ranked seat that ends puts its climber on it.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {rows.map((r, i) => {
                const isMe = me?.wallet === r.wallet;
                return (
                  <div
                    key={r.wallet}
                    className="chamfer-sm flex items-center justify-between gap-3 border px-4 py-2.5"
                    style={{ background: "var(--panel)", borderColor: isMe ? "var(--gold)" : "var(--edge)", boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none" }}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`display tabular w-8 text-lg ${i === 0 ? "glow-gold" : "text-[var(--dim)]"}`}>{tab === "season" ? r.rank : i + 1}</span>
                      <span className="w-8 shrink-0">{tab === "season" && <Move rank={r.rank} prev={r.prevRank} />}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold">
                          {r.handle ? (
                            <a href={`https://x.com/${r.handle}`} target="_blank" rel="noreferrer" className="hover:text-[var(--gold)]">@{r.handle}</a>
                          ) : (
                            r.name
                          )}
                          {isMe && <span className="ml-2 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">YOU</span>}
                        </span>
                        <span className="tabular block text-[10px] font-bold text-[var(--dim)]">
                          {r.league} · {short(r.wallet)}
                          {tab === "season" && r.day > 0 && <span className="text-[var(--up)]"> · +{num(r.day)} TODAY</span>}
                        </span>
                      </span>
                    </span>
                    <span className="display tabular shrink-0 text-lg text-[var(--gold)]">{num(tab === "season" ? r.points : r.day)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          {table && <HowPoints rules={table.rules} />}
          {table && <Leagues leagues={table.leagues} mine={me?.league?.name ?? null} />}
        </aside>
      </div>
    </main>
  );
}

function MyCard({ me, playerKey, onSaved }: { me: Me | null; playerKey: string | null; onSaved: () => void }) {
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setHandle(me?.handle ?? ""), [me?.handle]);

  if (!me) return <div className="chamfer mt-5 h-40 border border-[var(--edge)]" style={{ background: "var(--panel)" }} />;

  if (!me.wallet) {
    return (
      <div className="chamfer mt-5 border border-[var(--edge)] px-5 py-6" style={{ background: "var(--panel)" }}>
        <p className="display text-xl">You&apos;re not on the table yet.</p>
        <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[var(--dim)]">
          Points come from <b className="text-[var(--gold)]">ranked</b> seats: paid from your own tUSDC bankroll. Test tUSDC is free on the wallet page. Connect a
          wallet, deposit, take a ranked seat, and your card shows up here with your invite link.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/wallet" className="chamfer-sm bg-[var(--gold)] text-black transition hover:brightness-110 px-4 py-2 text-[11px] font-black tracking-[0.2em]">GET TEST tUSDC →</Link>
          <Link href="/play" className="chamfer-sm border border-[var(--edge)] px-4 py-2 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]">PLAY</Link>
        </div>
      </div>
    );
  }

  const points = me.points ?? 0;
  const league = me.league!;
  const pct = league.next ? Math.min(100, ((points - league.min) / (league.next.min - league.min)) * 100) : 100;
  const link = `https://playropes.xyz/r/${me.inviteCode}`;
  const tweet = `I'm climbing on @PlayRopes: one minute of HYPE, up or down, on a rope.\n\nTake a seat with my invite:`;

  const save = async () => {
    if (!playerKey) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerKey, handle }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not save");
      setMsg(j.handle ? `SAVED AS @${j.handle}` : "HANDLE CLEARED");
      onSaved();
    } catch (err) {
      setMsg(String(err).replace("Error: ", "").toUpperCase());
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }, () => {});
  };

  return (
    <div className="chamfer mt-5 grid gap-5 border border-[var(--gold)] px-5 py-5 md:grid-cols-[1.1fr_1fr]" style={{ background: "var(--panel)", boxShadow: "0 0 40px -24px var(--gold)" }}>
      <div className="min-w-0">
        <p className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
          {me.handle ? `@${me.handle}` : short(me.wallet)} · {league.name}
        </p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="display tabular text-5xl leading-none text-[var(--gold)]">{num(points)}</span>
          <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--dim)]">POINTS</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-bold tracking-[0.15em]">
          <span>
            RANK <span className="tabular text-[var(--text)]">{me.rank ? `#${me.rank}` : "–"}</span>
            <span className="text-[var(--dim)]"> / {me.of ?? 0}</span> {me.rank && <Move rank={me.rank} prev={me.prevRank ?? null} />}
          </span>
          <span>
            24H <span className="tabular text-[var(--up)]">+{num(me.day ?? 0)}</span>
          </span>
        </div>
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--edge)]">
            <div className="h-full rounded-full bg-[var(--gold)]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[10px] font-bold tracking-[0.18em] text-[var(--dim)]">
            {league.next ? `${num(league.next.min - points)} TO ${league.next.name}` : "TOP LEAGUE. HOLD IT."}
          </p>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <label htmlFor="handle" className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">YOUR X HANDLE ON THE BOARDS</label>
          <div className="mt-1.5 flex gap-2">
            <div className="chamfer-sm flex min-w-0 flex-1 items-center border border-[var(--edge)] px-3" style={{ background: "var(--bg)" }}>
              <span className="text-[var(--dim)]">@</span>
              <input
                id="handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_@]/g, "").slice(0, 16))}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="yourhandle"
                className="w-full min-w-0 bg-transparent py-2 pl-1 font-bold outline-none"
              />
            </div>
            <button onClick={save} disabled={saving || handle.replace(/^@/, "").toLowerCase() === (me.handle ?? "")} className="chamfer-sm bg-[var(--gold)] text-black transition hover:brightness-110 px-4 text-[11px] font-black tracking-[0.2em] disabled:opacity-40">
              {saving ? "…" : "SAVE"}
            </button>
          </div>
          {msg && <p className="mt-1 text-[10px] font-bold tracking-[0.15em] text-[var(--gold)]">{msg}</p>}
        </div>

        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
            INVITE · YOU EARN 10% OF WHAT THEY EARN
          </p>
          <div className="mt-1.5 flex gap-2">
            <code className="chamfer-sm min-w-0 flex-1 truncate border border-[var(--edge)] px-3 py-2 text-[12px] font-bold" style={{ background: "var(--bg)" }}>
              playropes.xyz/r/{me.inviteCode}
            </code>
            <button onClick={copy} className="chamfer-sm shrink-0 border border-[var(--edge)] px-3 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]">
              {copied ? "COPIED" : "COPY"}
            </button>
            <a
              href={`https://x.com/intent/post?text=${encodeURIComponent(tweet)}&url=${encodeURIComponent(link)}`}
              target="_blank"
              rel="noreferrer"
              className="chamfer-sm shrink-0 border border-[var(--edge)] px-3 py-2 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]"
            >
              POST
            </a>
          </div>
          <p className="mt-1 text-[10px] font-bold tracking-[0.15em] text-[var(--dim)]">
            {me.invited ?? 0} INVITED · +{num(me.fromInvites ?? 0)} POINTS FROM INVITES
          </p>
        </div>
      </div>
    </div>
  );
}

function HowPoints({ rules }: { rules: Rules }) {
  const items: [string, string][] = [
    ["Every ranked seat", `+${rules.seat}`],
    ["Every round it survives", `+${rules.round}`],
    ["Bank a profit", `+${rules.bankPerX} per 1× (max ${rules.bankCap})`],
    ["Last one holding", `+${rules.champion}`],
    ["First ranked seat of the day", `+${rules.daily}`],
    ["Weekly Summit top 10", `+${rules.summit[rules.summit.length - 1]} to +${rules.summit[0]}`],
    ["Weekly Longest Climb top 3", `+${rules.longest[rules.longest.length - 1]} to +${rules.longest[0]}`],
    ["Your invites", `${Math.round(rules.inviteShare * 100)}% of theirs`],
  ];
  return (
    <section>
      <h3 className="display text-lg tracking-[0.08em]">HOW POINTS WORK</h3>
      <div className="chamfer-sm mt-2 border border-[var(--edge)] px-4 py-3" style={{ background: "var(--panel)" }}>
        {items.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--edge)] py-1.5 text-[12px] last:border-0">
            <span>{k}</span>
            <span className="tabular shrink-0 font-bold text-[var(--gold)]">{v}</span>
          </div>
        ))}
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--dim)]">
          Practice seats never score. 20 ranked seats a wallet a day. Weekly placings land when the week closes, Monday 00:00 UTC.
          Farmed or linked wallets get removed. Season 0 is testnet: points are standing, not a token promise.{" "}
          <Link href="/docs/points" className="underline decoration-dotted hover:text-[var(--gold)]">Full rules</Link>
        </p>
      </div>
    </section>
  );
}

function Leagues({ leagues, mine }: { leagues: { id: string; name: string; min: number }[]; mine: string | null }) {
  return (
    <section>
      <h3 className="display text-lg tracking-[0.08em]">LEAGUES</h3>
      <div className="mt-2 space-y-1">
        {[...leagues].reverse().map((l) => (
          <div
            key={l.id}
            className="chamfer-sm flex items-center justify-between border px-4 py-2 text-[12px] font-bold tracking-[0.15em]"
            style={{ background: "var(--panel)", borderColor: mine === l.name ? "var(--gold)" : "var(--edge)" }}
          >
            <span className={mine === l.name ? "text-[var(--gold)]" : ""}>{l.name}</span>
            <span className="tabular text-[var(--dim)]">{l.min === 0 ? "START" : `${num(l.min)}+`}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
