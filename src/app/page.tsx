"use client";

/**
 * The landing, as a poster: the promise in four words on the left, and the
 * wall on the right — the real top climbers hanging on one rope, each at the
 * height of the best climb they've banked. One viewport on desktop; mobile
 * stacks the poster over the wall and scrolls.
 */
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { TableState } from "@/lib/state";
import { useClimberTheme, type LeaderRow, pad, NavMenu } from "./shared";

const NAV = [
  { href: "/play", label: "PLAY" },
  { href: "/leaders", label: "LEADERS" },
  { href: "/points", label: "POINTS" },
  { href: "/transparency", label: "PROOF" },
  { href: "/learn", label: "LEARN" },
  { href: "/feedback", label: "FEEDBACK" },
  { href: "/docs/overview", label: "DOCS" },
  { href: "/token", label: "$ROPES", gold: true },
];

/** Who hangs where: colour by rank, and the leader cheers from the top. */
const SKINS = ["gold", "green", "violet", "pink", "teal"];

export default function Landing() {
  useClimberTheme();
  const [state, setState] = useState<TableState | null>(null);
  const [wall, setWall] = useState<{ rows: WallRow[]; label: string } | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const load = () => {
      // Only a well-formed payload becomes state: a 500 body stored here would
      // make `state.round.index` throw and take the page down with it.
      fetch("/api/state")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.mark) return;
          setState(j);
          if (j.round) setLeft(j.round.secondsLeft);
        })
        .catch(() => {});
      // This week's ranked climbs; while ranked is young, fall back to
      // all-time ranked, then to every climb including practice.
      Promise.all([
        fetch("/api/boards").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/leaderboard").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([b, l]) => {
        const toWall = (rs: { wallet: string; name: string; handle?: string | null; best: number }[]) => rs.map((r) => ({ id: r.wallet, name: r.handle ? `@${r.handle}` : r.name, best: r.best }));
        if (b?.week?.best?.length >= 3) setWall({ rows: toWall(b.week.best), label: "THIS WEEK · RANKED" });
        else if (b?.allTime?.best?.length >= 3) setWall({ rows: toWall(b.allTime.best), label: "ALL-TIME · RANKED" });
        else if (Array.isArray(l?.rows)) setWall({ rows: (l.rows as LeaderRow[]).map((r) => ({ id: r.id, name: r.name, best: r.best })), label: "ALL-TIME" });
      });
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  // The bell counts down between polls so the clock never sits still.
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="relative z-10 flex min-h-dvh flex-col lg:h-screen lg:max-h-screen lg:overflow-hidden">
      <div className="hz-band shrink-0" />
      <header className="mx-auto flex w-full max-w-[1440px] shrink-0 items-center justify-between gap-4 px-4 py-4 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/mark.webp" alt="" width={64} height={34} priority className="h-7 w-auto sm:h-8" />
          <span className="display text-lg tracking-[0.08em] sm:text-xl">ROPES</span>
        </Link>
        {/* same MENU as every other page on a phone; three loose words up
            here read as a different site */}
        <NavMenu />
        <nav className="hidden items-center gap-7 text-[13px] font-bold tracking-[0.2em] text-[var(--dim)] sm:flex" aria-label="sections">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`inline-flex min-h-11 items-center ${n.gold ? "text-[var(--gold)]" : "hover:text-[var(--text)]"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-[1440px] gap-8 px-4 pb-6 sm:px-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_minmax(0,640px)] lg:gap-10 lg:px-12">
        {/* the poster */}
        <section className="mt-2 flex flex-col justify-center lg:mt-0">
          <h1 className="home-stack display">
            One
            <br />
            <span className="o">minute.</span>
            <br />
            One
            <br />
            <span className="g">rope.</span>
          </h1>
          <p className="mt-6 max-w-[560px] text-base leading-relaxed text-[#c8c5dd] sm:text-[17px]">
            Every minute a new {state?.mark?.asset ?? "HYPE"} round opens on Elysium. Pick UP or DOWN, ride
            Hyperliquid&apos;s live mark, bail whenever you like. Survive the bell and your stack climbs on.
          </p>
          <div className="mt-7 flex flex-col items-stretch gap-3 text-center sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:text-left">
            <Link href="/play?seat=1" className="chamfer display bg-[var(--gold)] px-8 py-4 text-lg tracking-[0.12em] text-[#120d02] transition hover:brightness-110 sm:text-xl">
              TAKE A SEAT →
            </Link>
            <p className="text-[11px] font-bold tracking-[0.16em] text-[var(--dim)] sm:text-xs" style={{ fontFamily: "var(--font-mono, ui-monospace), monospace" }}>
              FREE · NO WALLET{left != null ? ` · NEXT BELL IN 0:${pad(left)}` : ""}
            </p>
          </div>
        </section>

        {/* the wall */}
        <Wall rows={wall?.rows ?? null} label={wall?.label ?? ""} round={state?.round?.index ?? null} />
      </div>

      <footer className="mx-auto w-full max-w-[1440px] shrink-0 px-4 pb-4 text-[10px] font-bold tracking-[0.18em] text-[var(--dim)] sm:px-8 lg:px-12">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--edge)] pt-3">
          <span>EVERY ROUND IS AN ON-CHAIN MARKET ON ELYSIUM, PRICED FROM HYPERLIQUID&apos;S LIVE MARK</span>
          <span className="space-x-4">
            <Link href="/transparency" className="hover:text-[var(--text)]">TRANSPARENCY</Link>
            <Link href="/mainnet" className="hover:text-[var(--text)]">MAINNET</Link>
            <Link href="/docs/overview" className="hover:text-[var(--text)]">DOCS</Link>
            <a href="https://github.com/neromtoobad/ropes-elysium" target="_blank" rel="noreferrer" className="hover:text-[var(--text)]">GITHUB</a>
          </span>
        </div>
      </footer>
    </main>
  );
}

/**
 * The top five by best banked multiple, hung on one rope. Height is the
 * multiple; a minimum gap keeps two near-equal climbs from stacking on top of
 * each other, which is why the wall has no scale, only each climber's tag.
 */
type WallRow = { id: string; name: string; best: number };

function Wall({ rows, label, round }: { rows: WallRow[] | null; label: string; round: number | null }) {
  const top = (rows ?? []).filter((r) => r.best > 1).sort((a, b) => b.best - a.best).slice(0, 5);
  const hi = top.length ? top[0].best : 2;
  const lo = top.length ? top[top.length - 1].best : 1;
  const span = Math.max(0.2, hi - lo);
  let prev = -100;
  const ys = top.map((r, i) => {
    // Half by the multiple, half by rank: by multiple alone one runaway
    // leader left the rest of the five in a heap at the floor. The order
    // and the gaps still follow the numbers.
    const byValue = (hi - r.best) / span;
    const byRank = top.length > 1 ? i / (top.length - 1) : 0;
    let y = 16 + (byValue + byRank) * 33; // % from the top of the wall
    if (y - prev < 16) y = prev + 16;
    prev = y;
    return y;
  });
  // The gaps can push the last climber into the floor; squeeze the column back.
  const last = ys[ys.length - 1] ?? 0;
  if (last > 80) ys.forEach((y, i) => (ys[i] = 16 + ((y - 16) * 64) / (last - 16)));

  return (
    <section className="wall-panel relative h-[500px] overflow-hidden sm:h-[560px] border border-[var(--edge)] lg:h-auto lg:min-h-0">
      <div className="absolute left-4 right-4 top-4 flex items-center justify-between whitespace-nowrap text-[10px] font-bold tracking-[0.18em] text-[var(--dim)] sm:left-5 sm:right-5 sm:text-[11px] sm:tracking-[0.22em]">
        <span>
          THE WALL<span className="hidden sm:inline"> · </span><b className="hidden text-[var(--text)] sm:inline">BEST CLIMBS</b>
          {label && <span className="hidden lg:inline"> · {label}</span>}
        </span>
        {round != null && (
          <span className="flex items-center gap-2 text-[var(--text)]">
            <span className="h-2 w-2 rounded-full bg-[var(--up)]" style={{ boxShadow: "0 0 12px var(--up)" }} />
            ROUND #{round.toLocaleString()}
          </span>
        )}
      </div>
      <div className="wall-rope" />
      {top.map((r, i) => {
        const onLeft = i % 2 === 0;
        const tag = (
          <Link href="/leaders" className="wall-tag">
            #{i + 1} {r.name} <b>{r.best.toFixed(2)}×</b>
          </Link>
        );
        return (
          <div
            key={r.id}
            className="absolute flex items-center gap-2.5"
            style={{ top: `${ys[i]}%`, transform: "translateY(-50%)", ...(onLeft ? { right: "calc(50% - 30px)" } : { left: "calc(50% - 30px)" }) }}
          >
            {onLeft && tag}
            <Image
              src={`/climbers/${SKINS[i]}/${i === 0 ? "cheer" : "climb"}.webp`}
              alt=""
              width={96}
              height={96}
              className="h-16 w-auto sm:h-24"
              style={{ transform: onLeft ? "scaleX(-1)" : undefined, filter: "drop-shadow(0 10px 18px #000b)" }}
            />
            {!onLeft && tag}
          </div>
        );
      })}
      {rows && top.length === 0 && (
        <p className="absolute inset-x-0 top-1/2 text-center text-sm text-[var(--dim)]">The wall is empty. Be the first to bank a climb.</p>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-4 pt-12 text-[10px] font-bold tracking-[0.18em] text-[var(--dim)]" style={{ background: "linear-gradient(transparent, var(--bg))" }}>
        <span>THE FLOOR ↓</span>
        <span>HEIGHT = BEST MULTIPLE<span className="hidden sm:inline"> BANKED</span></span>
      </div>
    </section>
  );
}
