"use client";

/**
 * ROPES Points. Your card (league crest, points, rank, handle, invite link),
 * the trophy cabinet, the podium and the season table. Everything is computed
 * from ranked runs (lib/points, lib/trophies); this page only reads it.
 */
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { PageHeader, usePlayerKey, useClimberTheme, short } from "../shared";
import { Crest, leagueColor } from "./Crest";

type Row = { wallet: string; name: string; handle: string | null; points: number; day: number; rank: number; prevRank: number | null; league: string; trophies: number };
type Rules = { seat: number; round: number; bankPerX: number; bankCap: number; champion: number; daily: number; summit: number[]; longest: number[]; inviteShare: number; trophy: number[] };
type TrophyDef = { id: string; name: string; goal: string; thresholds: number[]; rarity: number[] };
type TrophyState = { id: string; tier: number; value: number | null; earnedAt: (string | null)[] };
type League = { id: string; name: string; min: number };
type Table = { season: { name: string; sub: string }; at: string; rules: Rules; leagues: League[]; trophies: TrophyDef[]; total: number; rows: Row[] };
type Me = {
  wallet: string | null;
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

  const rows = table ? (tab === "season" ? table.rows : [...table.rows].filter((r) => r.day > 0).sort((a, b) => b.day - a.day)) : null;
  const podium = rows?.slice(0, 3) ?? [];
  const rest = rows?.slice(3) ?? [];

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-6xl px-4 py-4">
      <PageHeader title="ROPES POINTS" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">{table ? `${table.season.name} · ${table.season.sub}` : "SEASON 0 · TESTNET"}</p>
          <h2 className="display mt-1 text-3xl leading-none sm:text-5xl">Climb the leagues.</h2>
        </div>
        <p className="text-[10px] font-bold tracking-[0.22em] text-[var(--dim)]">RANKED SEATS ONLY · LIVE</p>
      </div>

      <MyCard me={me} leagues={table?.leagues ?? null} playerKey={playerKey} onSaved={() => setRefresh((n) => n + 1)} />

      {table && <Cabinet defs={table.trophies} mine={me?.wallet ? me.trophies ?? [] : null} tierPoints={table.rules.trophy} />}

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--dim)]">THE TABLE</p>
            <h3 className="display text-2xl leading-none">{tab === "season" ? "Season standings" : "Hottest in 24 hours"}</h3>
          </div>
          <div className="flex gap-1" role="tablist">
            {(["season", "day"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`gametab whitespace-nowrap ${tab === t ? "active" : ""}`}>
                {t === "season" ? "SEASON" : "LAST 24H"}
              </button>
            ))}
          </div>
        </div>

        {!rows ? (
          <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">COUNTING POINTS…</p>
        ) : rows.length === 0 ? (
          <div className="chamfer-sm mt-4 border border-dashed border-[var(--edge)] px-4 py-8 text-center" style={{ background: "var(--panel)" }}>
            <p className="text-sm font-bold">{tab === "day" ? "Nobody has scored in the last 24 hours." : "Nobody on the table yet."}</p>
            <p className="mt-1 text-[11px] text-[var(--dim)]">The first ranked seat that ends puts its climber on it.</p>
          </div>
        ) : (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="min-w-0">
              <Podium rows={podium} mine={me?.wallet ?? null} day={tab === "day"} />
              <div className="mt-3 space-y-1">
                {rest.map((r, i) => {
                  const isMe = me?.wallet === r.wallet;
                  return (
                    <div
                      key={r.wallet}
                      className="chamfer-sm flex items-center justify-between gap-3 border px-3 py-2 sm:px-4"
                      style={{ background: "var(--panel)", borderColor: isMe ? "var(--gold)" : "var(--edge)", boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none" }}
                    >
                      <span className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <span className="display tabular w-7 text-base text-[var(--dim)]">{tab === "season" ? r.rank : i + 4}</span>
                        <span className="w-7 shrink-0">{tab === "season" && <Move rank={r.rank} prev={r.prevRank} />}</span>
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
                            {tab === "season" && r.day > 0 && <span className="text-[var(--up)]"> · +{num(r.day)}</span>}
                          </span>
                        </span>
                      </span>
                      <span className="display tabular shrink-0 text-lg text-[var(--gold)]">{num(tab === "season" ? r.points : r.day)}</span>
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
    </main>
  );
}

/* ───────────────────────────── your card ───────────────────────────── */

function MyCard({ me, leagues, playerKey, onSaved }: { me: Me | null; leagues: League[] | null; playerKey: string | null; onSaved: () => void }) {
  const [handle, setHandle] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
          <div className="min-w-0 flex-1">
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
        <div className="shrink-0 drop-shadow-[0_10px_18px_rgba(0,0,0,0.45)]">
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

function Podium({ rows, mine, day }: { rows: Row[]; mine: string | null; day: boolean }) {
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
              <p className="display tabular text-base text-[var(--gold)] sm:text-lg">{num(day ? r.day : r.points)}</p>
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
