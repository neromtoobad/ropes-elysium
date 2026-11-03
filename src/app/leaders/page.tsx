"use client";

/**
 * The leaders. One ranking: season points, computed from ranked runs
 * (lib/points, lib/trophies); this page only reads it. THIS WEEK shows the two
 * weekly boards (lib/boards) whose placings pay into those points when the
 * week closes. TODAY is the Daily Climb (lib/daily): everyone's first run of
 * the UTC day, practice or ranked, for the glory. Your card, streak and
 * trophies sit around the table.
 */
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PageHeader, usePlayerKey, useLedger, useClimberTheme, short, usd } from "../shared";
import { Crest, leagueColor } from "./Crest";
import StreakPanel from "./StreakPanel";

type Row = { wallet: string; name: string; handle: string | null; points: number; day: number; rank: number; prevRank: number | null; league: string; trophies: number };
type BoardRow = { wallet: string; name: string; runs: number; net: number; best: number; longest: number; handle: string | null };
type DailyRow = { rank: number; runId: string; name: string; multiple: number; rounds: number; status: "alive" | "banked" | "eliminated"; ranked: boolean };
type Daily = { day: string; resetsAt: string; entrants: number; rows: DailyRow[] };
type Boards = { week: { start: string; end: string; summit: BoardRow[]; longest: BoardRow[] } };
type Tab = "season" | "week" | "daily";
type Rules = {
  seat: number;
  round: number;
  bankPerX: number;
  bankCap: number;
  champion: number;
  daily: number;
  summit: number[];
  longest: number[];
  inviteShare: number;
  trophy: number[];
  streak: { perDay: number; cap: number };
};
type TrophyDef = { id: string; name: string; goal: string; thresholds: number[]; rarity: number[] };
type TrophyState = { id: string; tier: number; value: number | null; earnedAt: (string | null)[] };
type League = { id: string; name: string; min: number };
type Table = { season: { name: string; sub: string }; at: string; rules: Rules; leagues: League[]; trophies: TrophyDef[]; total: number; rows: Row[] };
type Me = {
  wallet: string | null;
  name?: string | null;
  handle?: string | null;
  inviteCode?: string;
  points?: number;
  day?: number;
  rank?: number | null;
  prevRank?: number | null;
  of?: number;
  league?: { name: string; min: number; next: { name: string; min: number } | null };
  invited?: number;
  fromInvites?: number;
  trophies?: TrophyState[];
};

const num = (n: number) => Math.round(n).toLocaleString("en-US");
const METAL = ["#d68a4c", "#cfd8e3", "#ffd34d"];
const METAL_NAME = ["BRONZE", "SILVER", "GOLD"];

/** Counts up to a number once, so the card lands with a little weight. */
function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

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

const Name = ({ r }: { r: Row }) =>
  r.handle ? (
    <a href={`https://x.com/${r.handle}`} target="_blank" rel="noreferrer" className="hover:text-[var(--gold)]">
      @{r.handle}
    </a>
  ) : (
    <>{r.name}</>
  );

function untilReset(end: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(end).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}D ${h}H` : `${h}H ${m}M`;
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();

export default function Leaders() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const ledger = useLedger(playerKey);
  const [table, setTable] = useState<Table | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [boards, setBoards] = useState<Boards | null>(null);
  const [daily, setDaily] = useState<Daily | null>(null);
  const [tab, setTab] = useState<Tab>("season");
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // /leaders?tab=daily lands on today's board (the run page and the seat link here)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "daily" || t === "week" || t === "season") setTab(t);
  }, []);

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
    const load = () => {
      fetch("/api/boards")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.week && setBoards(j))
        .catch(() => {});
      fetch("/api/daily")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.rows && setDaily(j))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    if (!playerKey) return;
    fetch("/api/points/me", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerKey }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setMe(j))
      .catch(() => {});
  }, [playerKey, refresh]);

  const rows = table?.rows ?? null;
  const podium = rows?.slice(0, 3) ?? [];
  const rest = rows?.slice(3) ?? [];
  const mine = me?.wallet ?? ledger?.bank?.address?.toLowerCase() ?? null;
  const TITLES: Record<Tab, [string, string]> = {
    season: ["SEASON POINTS", "Season standings"],
    week: ["THIS WEEK", "The weekly boards"],
    daily: ["TODAY", "The Daily Climb"],
  };

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-6xl px-4 py-4">
      <PageHeader title="LEADERS" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">{table ? `${table.season.name} · ${table.season.sub}` : "SEASON 0 · TESTNET"}</p>
          <h2 className="display mt-1 text-3xl leading-none sm:text-5xl">Climb the leagues.</h2>
        </div>
        <p className="text-[10px] font-bold tracking-[0.22em] text-[var(--dim)]">RANKED SEATS ONLY · LIVE</p>
      </div>

      <MyCard me={me} leagues={table?.leagues ?? null} playerKey={playerKey} onSaved={() => setRefresh((n) => n + 1)} />

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">{TITLES[tab][0]}</p>
            <h3 className="display text-2xl leading-none">{TITLES[tab][1]}</h3>
          </div>
          <div className="flex gap-1" role="tablist">
            {(["season", "week", "daily"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`gametab whitespace-nowrap ${tab === t ? "active" : ""}`}>
                {t === "season" ? "SEASON" : t === "week" ? "THIS WEEK" : "TODAY"}
              </button>
            ))}
          </div>
        </div>

        {tab === "week" ? (
          <WeekBoards boards={boards} rules={table?.rules ?? null} mine={mine} now={now} />
        ) : tab === "daily" ? (
          <TodayBoard daily={daily} mine={ledger?.daily?.runId ?? null} now={now} />
        ) : !rows ? (
          <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">COUNTING POINTS…</p>
        ) : rows.length === 0 ? (
          <div className="chamfer-sm mt-4 border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
            <p className="text-sm font-bold">Nobody on the table yet.</p>
            <p className="mt-1 text-[11px] text-[var(--dim)]">The first ranked seat that ends puts its climber on it.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              <Podium rows={podium} mine={me?.wallet ?? null} />
              <div className="mt-3 space-y-1">
                {rest.map((r) => {
                  const isMe = me?.wallet === r.wallet;
                  return (
                    <div
                      key={r.wallet}
                      className="chamfer-sm flex items-center justify-between gap-3 border px-3 py-2 sm:px-4"
                      style={{ background: "var(--panel)", borderColor: isMe ? "var(--gold)" : "var(--edge)", boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none" }}
                    >
                      <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <span className="display tabular w-7 text-base text-[var(--dim)]">{r.rank}</span>
                        <span className="w-7 shrink-0">
                          <Move rank={r.rank} prev={r.prevRank} />
                        </span>
                        <span className="shrink-0">
                          <Crest league={r.league} size={30} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold">
                            <Name r={r} />
                            {isMe && <span className="ml-2 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">YOU</span>}
                          </span>
                          <span className="tabular block truncate text-[10px] font-bold text-[var(--dim)]">
                            <span style={{ color: leagueColor(r.league) }}>{r.league}</span> · {short(r.wallet)}
                            {r.trophies > 0 && <span> · {r.trophies} {r.trophies === 1 ? "TROPHY" : "TROPHIES"}</span>}
                            {r.day > 0 && <span className="text-[var(--up)]"> · +{num(r.day)} 24H</span>}
                          </span>
                        </span>
                      </span>
                      <span className="display tabular shrink-0 text-lg text-[var(--gold)]">{num(r.points)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            <aside className="space-y-6">
              <HowPoints rules={table!.rules} />
              <Leagues leagues={table!.leagues} mine={me?.league?.name ?? null} />
            </aside>
          </div>
        )}
      </section>

      <StreakPanel onClaimed={() => setRefresh((n) => n + 1)} />

      {table && <Cabinet defs={table.trophies} mine={me?.wallet ? me.trophies ?? [] : null} tierPoints={table.rules.trophy} />}
    </main>
  );
}

/* ─────────────────────── this week · today ─────────────────────── */

function WeekBoards({ boards, rules, mine, now }: { boards: Boards | null; rules: Rules | null; mine: string | null; now: number }) {
  if (!boards) return <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">FETCHING THE BOARDS…</p>;
  return (
    <>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--dim)]">
        Week of {dayLabel(boards.week.start)}, closes in <span className="tabular font-bold text-[var(--gold)]">{untilReset(boards.week.end, now)}</span> (Monday 00:00 UTC).
        When it closes, the Summit top 10 earn {rules ? `+${rules.summit[0]} to +${rules.summit[rules.summit.length - 1]}` : "season points"} and the Longest Climb top 3{" "}
        {rules ? `+${rules.longest[0]} to +${rules.longest[rules.longest.length - 1]}` : "too"} on the season table.
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <Board
          title="THE SUMMIT"
          sub="NET WINNINGS THIS WEEK"
          rows={boards.week.summit}
          mine={mine}
          value={(r) => ({ text: usd(r.net), color: r.net >= 0 ? "var(--up)" : "var(--down)" })}
          detail={(r) => `${r.runs} RUN${r.runs === 1 ? "" : "S"} · BEST ${r.best.toFixed(2)}×`}
        />
        <Board
          title="LONGEST CLIMB"
          sub="MOST ROUNDS ONE RUN SURVIVED"
          rows={boards.week.longest}
          mine={mine}
          value={(r) => ({ text: `${r.longest}R`, color: "var(--gold)" })}
          detail={(r) => `BEST ${r.best.toFixed(2)}× · NET ${usd(r.net)}`}
        />
      </div>
    </>
  );
}

function TodayBoard({ daily, mine, now }: { daily: Daily | null; mine: string | null; now: number }) {
  if (!daily) return <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">FETCHING TODAY&apos;S CLIMB…</p>;
  return (
    <>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--dim)]">
        Your first run of the day is your one shot, practice or ranked. Ranked by where it finished, then by bells survived. {dayLabel(`${daily.day}T00:00:00Z`)} ·{" "}
        {daily.entrants} climber{daily.entrants === 1 ? "" : "s"} · resets in <span className="tabular font-bold text-[var(--gold)]">{untilReset(daily.resetsAt, now)}</span>. It&apos;s
        for the glory: no points.{" "}
        <Link href="/play" className="font-bold text-[var(--text)] underline decoration-dotted hover:text-[var(--gold)]">
          Take your shot →
        </Link>
      </p>
      {daily.rows.length === 0 ? (
        <div className="chamfer-sm mt-4 border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
          <p className="text-sm font-bold">Nobody has climbed today yet.</p>
          <p className="mt-1 text-[11px] text-[var(--dim)]">The first run of the day sets the height to beat.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-1">
          {daily.rows.map((r) => {
            const isMe = r.runId === mine;
            const c = r.status === "eliminated" ? "var(--down)" : r.multiple >= 1 ? "var(--up)" : "var(--gold)";
            return (
              <Link
                key={r.runId}
                href={`/run/${r.runId}`}
                className="chamfer-sm flex items-center justify-between gap-3 border px-4 py-2.5 transition hover:border-[var(--gold)]"
                style={{ background: "var(--panel)", borderColor: isMe ? "var(--gold)" : "var(--edge)", boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none" }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`display tabular w-7 text-lg ${r.rank === 1 ? "glow-gold" : "text-[var(--dim)]"}`}>{r.rank}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">
                      {r.name}
                      {isMe && <span className="ml-2 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">YOU</span>}
                    </span>
                    <span className="tabular block text-[10px] font-bold text-[var(--dim)]">
                      {r.status === "alive" ? <span className="text-[var(--up)]">● LIVE</span> : r.status === "eliminated" ? "CUT" : "BANKED"} · {r.rounds} BELL
                      {r.rounds === 1 ? "" : "S"} · {r.ranked ? "RANKED" : "PRACTICE"}
                    </span>
                  </span>
                </span>
                <span className="display tabular shrink-0 text-lg" style={{ color: c }}>
                  {r.multiple.toFixed(2)}×
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function Board({
  title,
  sub,
  rows,
  mine,
  value,
  detail,
}: {
  title: string;
  sub: string;
  rows: BoardRow[];
  mine: string | null;
  value: (r: BoardRow) => { text: string; color: string };
  detail: (r: BoardRow) => string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="display text-lg tracking-[0.08em]">{title}</h2>
        <span className="text-[9px] font-bold tracking-[0.2em] text-[var(--dim)]">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <div className="chamfer-sm border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
          <p className="text-sm font-bold">Nobody on this board yet.</p>
          <p className="mt-1 text-[11px] text-[var(--dim)]">The first ranked run that ends this week puts its climber on top.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {rows.slice(0, 25).map((r, i) => {
            const isMe = mine !== null && r.wallet === mine;
            const v = value(r);
            return (
              <div
                key={r.wallet}
                className="chamfer-sm flex items-center justify-between gap-3 border px-4 py-2.5"
                style={{ background: "var(--panel)", borderColor: isMe ? "var(--gold)" : "var(--edge)", boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none" }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`display tabular w-7 text-lg ${i === 0 ? "glow-gold" : "text-[var(--dim)]"}`}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">
                      {r.handle ? (
                        <a href={`https://x.com/${r.handle}`} target="_blank" rel="noreferrer" className="hover:text-[var(--gold)]">
                          @{r.handle}
                        </a>
                      ) : (
                        r.name
                      )}
                      {isMe && <span className="ml-2 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">YOU</span>}
                    </span>
                    <span className="tabular block text-[10px] font-bold text-[var(--dim)]">
                      {short(r.wallet)} · {detail(r)}
                    </span>
                  </span>
                </span>
                <span className="display tabular shrink-0 text-lg" style={{ color: v.color }}>
                  {v.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── your card ───────────────────────────── */

function MyCard({ me, leagues, playerKey, onSaved }: { me: Me | null; leagues: League[] | null; playerKey: string | null; onSaved: () => void }) {
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [nm, setNm] = useState("");
  const [nmMsg, setNmMsg] = useState<string | null>(null);
  useEffect(() => {
    if (me?.name) setNm(me.name);
  }, [me?.name]);
  const [copied, setCopied] = useState(false);
  const shown = useCountUp(me?.points ?? 0);
  useEffect(() => setHandle(me?.handle ?? ""), [me?.handle]);

  if (!me) return <div className="chamfer mt-6 h-56 animate-pulse border border-[var(--edge)]" style={{ background: "var(--panel)" }} />;

  if (!me.wallet) {
    return (
      <div className="chamfer relative mt-6 overflow-hidden border border-[var(--edge)] px-5 py-6 sm:px-8" style={{ background: "var(--panel)" }}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex -space-x-3">
            {["base", "ledge", "ridge", "peak", "summit"].map((id, i) => (
              <span key={id} style={{ transform: `translateY(${Math.abs(2 - i) * 6}px)` }}>
                <Crest league={id} size={56} />
              </span>
            ))}
          </div>
          {/* 260px basis: on a phone the copy drops under the crests instead
              of squeezing into the sliver beside them */}
          <div className="min-w-0 flex-1 basis-[260px]">
            <p className="display text-2xl">You&apos;re not on the table yet.</p>
            <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[var(--dim)]">
              Points and trophies come from <b className="text-[var(--gold)]">ranked</b> seats, paid from your own tUSDC bankroll. Test tUSDC is free on the wallet page. Connect,
              deposit, take a ranked seat, and your card, crest and invite link show up here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/wallet" className="chamfer-sm bg-[var(--gold)] px-4 py-2 text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110">
                GET TEST tUSDC →
              </Link>
              <Link href="/learn/set-up" className="chamfer-sm border border-[var(--edge)] px-4 py-2 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]">
                HOW TO SET UP
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const points = me.points ?? 0;
  const league = me.league!;
  const color = leagueColor(league.name);
  const pct = league.next ? Math.min(100, ((points - league.min) / (league.next.min - league.min)) * 100) : 100;
  const link = `https://playropes.xyz/r/${me.inviteCode}`;
  const tweet = `I'm climbing on @PlayRopes: one minute of HYPE, up or down, on a rope.\n\nTake a seat with my invite:`;
  const tiers = (me.trophies ?? []).reduce((n, t) => n + t.tier, 0);

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
  const saveName = async () => {
    if (!playerKey) return;
    setSaving(true);
    setNmMsg(null);
    try {
      const r = await fetch("/api/name", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerKey, name: nm }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "could not save");
      setNmMsg(`YOU'RE ${j.name} NOW`);
      onSaved();
    } catch (err) {
      setNmMsg(String(err).replace("Error: ", "").toUpperCase());
    } finally {
      setSaving(false);
    }
  };
  const copy = () =>
    navigator.clipboard?.writeText(link).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );

  return (
    <div
      className="chamfer relative mt-6 grid gap-6 overflow-hidden border px-5 py-6 sm:px-8 md:grid-cols-[1.25fr_1fr]"
      style={{
        background: `radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, ${color} 22%, transparent), transparent 55%), var(--panel)`,
        borderColor: color,
        boxShadow: `0 0 60px -30px ${color}`,
      }}
    >
      <div className="flex min-w-0 gap-4 sm:gap-5">
        {/* 64px on a phone: at 96 the stats beside it got 58px columns */}
        <div className="h-16 w-16 shrink-0 drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)] sm:h-24 sm:w-24 [&>svg]:h-full [&>svg]:w-full">
          <Crest league={league.name} size={96} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
            {me.handle ? `@${me.handle}` : short(me.wallet)} · <span style={{ color }}>{league.name}</span>
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="display tabular text-5xl leading-none text-[var(--gold)] sm:text-6xl">{num(shown)}</span>
            <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--dim)]">PTS</span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { k: "RANK", v: me.rank ? `#${me.rank}` : "–", extra: me.rank ? <Move rank={me.rank} prev={me.prevRank ?? null} /> : null },
              { k: "24H", v: `+${num(me.day ?? 0)}`, extra: null },
              { k: "TROPHIES", v: String(tiers), extra: null },
            ].map((s) => (
              <div key={s.k} className="chamfer-sm border border-[var(--edge)] px-1 py-1.5" style={{ background: "color-mix(in srgb, var(--bg) 60%, transparent)" }}>
                <p className="text-[8px] font-black tracking-[0.2em] text-[var(--dim)]">{s.k}</p>
                <p className="display tabular text-base leading-tight">
                  {s.v} {s.extra}
                </p>
              </div>
            ))}
          </div>
          {leagues && (
            <div className="mt-4">
              <div className="relative h-2.5 rounded-full bg-[var(--edge)]">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, var(--gold))` }} />
              </div>
              <p className="mt-1.5 text-[10px] font-bold tracking-[0.18em] text-[var(--dim)]">
                {league.next ? (
                  <>
                    <span className="tabular text-[var(--text)]">{num(league.next.min - points)}</span> TO <span style={{ color: leagueColor(league.next.name) }}>{league.next.name}</span>
                  </>
                ) : (
                  "TOP LEAGUE. HOLD IT."
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div>
          <label htmlFor="climber-name" className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
            YOUR NAME ON THE WALL
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="climber-name"
              value={nm}
              onChange={(e) => setNm(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 12))}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              placeholder="YourName"
              className="chamfer-sm w-full min-w-0 flex-1 border border-[var(--edge)] px-3 py-2 font-bold outline-none"
              style={{ background: "var(--bg)" }}
            />
            <button
              onClick={saveName}
              disabled={saving || nm.length < 2 || nm === (me.name ?? "")}
              className="chamfer-sm bg-[var(--gold)] px-4 text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "…" : "SAVE"}
            </button>
          </div>
          {nmMsg && <p className="mt-1 text-[10px] font-bold tracking-[0.15em] text-[var(--gold)]">{nmMsg}</p>}
        </div>

        <div>
          <label htmlFor="handle" className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">
            YOUR X HANDLE ON THE BOARDS
          </label>
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
            <button
              onClick={save}
              disabled={saving || handle.replace(/^@/, "").toLowerCase() === (me.handle ?? "")}
              className="chamfer-sm bg-[var(--gold)] px-4 text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "…" : "SAVE"}
            </button>
          </div>
          {msg && <p className="mt-1 text-[10px] font-bold tracking-[0.15em] text-[var(--gold)]">{msg}</p>}
        </div>

        <div>
          <p className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">INVITE · YOU EARN 10% OF WHAT THEY EARN</p>
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

/* ─────────────────────────── trophy cabinet ─────────────────────────── */

function goalText(def: TrophyDef, i: number) {
  const n = def.thresholds[Math.min(i, def.thresholds.length - 1)];
  return def.goal.replace("{n}", String(n)).replace("(s)", n === 1 ? "" : "s");
}

function Cabinet({ defs, mine, tierPoints }: { defs: TrophyDef[]; mine: TrophyState[] | null; tierPoints: number[] }) {
  const earned = mine ? mine.reduce((n, t) => n + t.tier, 0) : 0;
  const total = defs.reduce((n, d) => n + d.thresholds.length, 0);
  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">THE TROPHY CABINET</p>
          <h3 className="display text-2xl leading-none">Trophies</h3>
        </div>
        <p className="text-[10px] font-bold tracking-[0.2em] text-[var(--dim)]">
          {mine ? (
            <>
              <span className="tabular text-[var(--gold)]">{earned}</span> OF {total} TIERS ·{" "}
            </>
          ) : null}
          <span style={{ color: METAL[0] }}>BRONZE +{tierPoints[0]}</span> · <span style={{ color: METAL[1] }}>SILVER +{tierPoints[1]}</span> ·{" "}
          <span style={{ color: METAL[2] }}>GOLD +{tierPoints[2]}</span>
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {defs.map((d) => (
          <TrophyTile key={d.id} def={d} state={mine?.find((t) => t.id === d.id) ?? null} />
        ))}
      </div>
    </section>
  );
}

function TrophyTile({ def, state }: { def: TrophyDef; state: TrophyState | null }) {
  const tier = state?.tier ?? 0;
  const tiers = def.thresholds.length;
  const maxed = tier >= tiers;
  // A single-tier trophy is gold the moment it's won.
  const metalIdx = tier === 0 ? -1 : tiers === 1 ? 2 : tier - 1;
  const metal = metalIdx >= 0 ? METAL[metalIdx] : null;
  const nextMetal = tiers === 1 ? METAL[2] : METAL[Math.min(tier, 2)];
  const lower = def.id === "summit";
  const target = def.thresholds[Math.min(tier, tiers - 1)];
  const v = state?.value ?? null;
  const progress = maxed ? 1 : lower ? (v !== null && v <= target ? 1 : 0) : Math.min(1, (v ?? 0) / target);
  const rarity = def.rarity[Math.max(0, tier - 1)] ?? 0;
  const valueText =
    v === null ? null : def.id === "moonshot" ? `BEST ${v.toFixed(2)}×` : lower ? `BEST #${v}` : def.id === "survivor" || def.id === "on-fire" ? `BEST ${v} / ${target}` : `${Math.round(v)} / ${target}`;

  return (
    <div
      className="chamfer-sm group relative flex flex-col items-center overflow-hidden border px-3 pb-3 pt-4 text-center transition duration-300 hover:-translate-y-0.5"
      style={{
        background: metal ? `radial-gradient(90% 70% at 50% 30%, color-mix(in srgb, ${metal} 26%, transparent), transparent 70%), var(--panel)` : "var(--panel)",
        borderColor: metal ?? "var(--edge)",
        boxShadow: metal ? `0 10px 30px -18px ${metal}` : "none",
      }}
    >
      <div className="absolute right-2.5 top-2.5 flex gap-1" aria-label={`${tier} of ${tiers} tiers`}>
        {def.thresholds.map((_, i) => {
          const lit = i < tier;
          const c = tiers === 1 ? METAL[2] : METAL[i];
          return <span key={i} className="h-2 w-2 rounded-full border" style={{ background: lit ? c : "transparent", borderColor: lit ? c : "var(--edge)" }} />;
        })}
      </div>
      <div className="relative h-24 w-24 sm:h-28 sm:w-28">
        <Image
          src={`/trophies/${def.id}.webp`}
          alt=""
          fill
          sizes="112px"
          className="object-contain transition duration-300 group-hover:-rotate-3 group-hover:scale-105"
          style={{ filter: tier === 0 ? "grayscale(1) brightness(0.55)" : "drop-shadow(0 8px 14px rgba(0,0,0,0.45))", opacity: tier === 0 ? 0.6 : 1 }}
        />
      </div>
      <p className="display mt-2 text-[15px] leading-tight">{def.name}</p>
      <p className="mt-0.5 h-3 text-[9px] font-black tracking-[0.25em]" style={{ color: metal ?? "var(--dim)" }}>
        {metal ? (tiers === 1 ? "EARNED" : METAL_NAME[metalIdx]) : "LOCKED"}
      </p>
      <p className="mt-1 min-h-[30px] text-[11px] leading-snug text-[var(--dim)]">{goalText(def, maxed ? tiers - 1 : tier)}</p>
      {!maxed ? (
        <div className="mt-2 w-full">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--edge)]">
            <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: nextMetal }} />
          </div>
          <p className="tabular mt-1 h-3 text-[9px] font-bold tracking-[0.15em] text-[var(--dim)]">{valueText ?? ""}</p>
        </div>
      ) : (
        <p className="mt-2 text-[9px] font-black tracking-[0.25em]" style={{ color: METAL[2] }}>
          MAXED
        </p>
      )}
      <p className="mt-2 text-[9px] font-bold tracking-[0.18em] text-[var(--dim)]">
        {tier > 0 ? `${Math.round(rarity * 100)}% OF CLIMBERS HAVE THIS` : rarity > 0 ? `${Math.round(rarity * 100)}% OF CLIMBERS HAVE IT` : "NOBODY HAS IT YET"}
      </p>
    </div>
  );
}

/* ───────────────────────────── the podium ───────────────────────────── */

const PODIUM = [
  { place: 1, skin: "gold", pose: "cheer", h: "h-24 sm:h-28", metal: METAL[2] },
  { place: 2, skin: "teal", pose: "climb", h: "h-16 sm:h-20", metal: METAL[1] },
  { place: 3, skin: "pink", pose: "climb", h: "h-11 sm:h-14", metal: METAL[0] },
];

function Podium({ rows, mine }: { rows: Row[]; mine: string | null }) {
  // Second, first, third: the winner stands in the middle.
  const order = [1, 0, 2];
  return (
    <div
      className="chamfer relative overflow-hidden border border-[var(--edge)] px-2 pt-5 sm:px-6"
      style={{ background: "radial-gradient(60% 80% at 50% 100%, color-mix(in srgb, var(--gold) 16%, transparent), transparent 70%), var(--panel)" }}
    >
      <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
        {order.map((i) => {
          const r = rows[i];
          const p = PODIUM[i];
          if (!r) return <div key={i} />;
          const isMe = mine === r.wallet;
          return (
            <div key={r.wallet} className="flex min-w-0 flex-col items-center">
              <div className={`relative ${i === 0 ? "h-32 w-24 sm:h-40 sm:w-28" : "h-24 w-20 sm:h-32 sm:w-24"}`}>
                <Image src={`/climbers/${p.skin}/${p.pose}.webp`} alt="" fill sizes="112px" className="object-contain object-bottom drop-shadow-[0_8px_12px_rgba(0,0,0,0.5)]" />
              </div>
              <p className="mt-1 w-full truncate text-center text-[12px] font-bold sm:text-sm">
                <Name r={r} />
                {isMe && <span className="ml-1 text-[9px] font-black tracking-[0.2em] text-[var(--gold)]">YOU</span>}
              </p>
              <p className="flex items-center gap-1 text-[9px] font-bold tracking-[0.12em]" style={{ color: leagueColor(r.league) }}>
                <Crest league={r.league} size={16} /> {r.league}
              </p>
              <p className="display tabular text-base text-[var(--gold)] sm:text-lg">{num(r.points)}</p>
              <div
                className={`mt-1 flex w-full items-start justify-center rounded-t-md ${p.h}`}
                style={{
                  background: `linear-gradient(180deg, color-mix(in srgb, ${p.metal} 60%, var(--panel)), color-mix(in srgb, ${p.metal} 10%, var(--panel)))`,
                  borderTop: `3px solid ${p.metal}`,
                }}
              >
                <span className="display mt-1 text-2xl text-black/60 sm:text-3xl">{p.place}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── sidebar ───────────────────────────── */

function HowPoints({ rules }: { rules: Rules }) {
  const items: [string, string][] = [
    ["Every ranked seat", `+${rules.seat}`],
    ["Every round it survives", `+${rules.round}`],
    ["Bank a profit", `+${rules.bankPerX} per 1× (max ${rules.bankCap})`],
    ["Last one holding", `+${rules.champion}`],
    ["First ranked seat of the day", `+${rules.daily}`],
    ["Daily check-in streak", `+${rules.streak.perDay} a day, up to +${rules.streak.cap}`],
    ["Trophy tiers", `+${rules.trophy[0]} / +${rules.trophy[1]} / +${rules.trophy[2]}`],
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
          Practice seats never score. 20 ranked seats a wallet a day. Weekly placings land when the week closes, Monday 00:00 UTC. Farmed or linked wallets get removed. Season 0 is
          testnet: points are standing, not a token promise.{" "}
          <Link href="/docs/points" className="underline decoration-dotted hover:text-[var(--gold)]">
            Full rules
          </Link>
        </p>
      </div>
    </section>
  );
}

function Leagues({ leagues, mine }: { leagues: League[]; mine: string | null }) {
  return (
    <section>
      <h3 className="display text-lg tracking-[0.08em]">LEAGUES</h3>
      <div className="mt-2 space-y-1">
        {[...leagues].reverse().map((l) => {
          const on = mine === l.name;
          const c = leagueColor(l.name);
          return (
            <div
              key={l.id}
              className="chamfer-sm flex items-center justify-between border px-3 py-1.5 text-[12px] font-bold tracking-[0.15em]"
              style={{ background: on ? `color-mix(in srgb, ${c} 14%, var(--panel))` : "var(--panel)", borderColor: on ? c : "var(--edge)" }}
            >
              <span className="flex items-center gap-2.5">
                <Crest league={l.id} size={32} />
                <span style={{ color: on ? c : undefined }}>{l.name}</span>
                {on && <span className="text-[9px] text-[var(--gold)]">YOU</span>}
              </span>
              <span className="tabular text-[var(--dim)]">{l.min === 0 ? "START" : `${l.min.toLocaleString("en-US")}+`}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
