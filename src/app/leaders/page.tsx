"use client";

/**
 * The boards. Only RANKED seats count (paid from a wallet's own bankroll);
 * practice on the house's money never does. Two weekly boards reset every
 * Monday 00:00 UTC — the Summit (net winnings) and the Longest Climb (rounds
 * survived) — with the all-time ranked board underneath.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader, usePlayerKey, useLedger, useClimberTheme, usd, short } from "../shared";

type Row = { wallet: string; name: string; runs: number; net: number; best: number; longest: number; handle: string | null };
type Boards = {
  week: { start: string; end: string; summit: Row[]; longest: Row[] };
  allTime: { summit: Row[] };
  rankedSeatsPerDay: number;
};

function untilReset(end: string, now: number) {
  const s = Math.max(0, Math.floor((new Date(end).getTime() - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}D ${h}H` : `${h}H ${m}M`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();

export default function Leaders() {
  useClimberTheme();
  const playerKey = usePlayerKey();
  const ledger = useLedger(playerKey);
  const mine = ledger?.bank?.address?.toLowerCase() ?? null;
  const [boards, setBoards] = useState<Boards | null>(null);
  const [tab, setTab] = useState<"week" | "all">("week");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = () =>
      fetch("/api/boards")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.week && setBoards(j))
        .catch(() => {});
    load();
    const id = setInterval(load, 10_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, []);

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-5xl px-4 py-4">
      <PageHeader title="THE BOARDS" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-1" role="tablist">
          {(["week", "all"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`gametab ${tab === t ? "active" : ""}`}
            >
              {t === "week" ? "THIS WEEK" : "ALL-TIME"}
            </button>
          ))}
        </div>
        {boards && tab === "week" && (
          <p className="text-[10px] font-bold tracking-[0.22em] text-[var(--dim)]">
            WEEK OF {day(boards.week.start)} · RESETS IN{" "}
            <span className="tabular text-[var(--gold)]">{untilReset(boards.week.end, now)}</span> · MONDAY 00:00 UTC
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--dim)]">
        Only <b className="text-[var(--gold)]">ranked</b> seats count: paid from your own tUSDC bankroll, up to{" "}
        {boards?.rankedSeatsPerDay ?? 20} a day per wallet. Practice seats play the same market on the house&apos;s money
        and never count.{" "}
        <Link href="/play" className="font-bold text-[var(--text)] underline decoration-dotted hover:text-[var(--gold)]">
          Take a ranked seat →
        </Link>{" "}
        Every ranked seat also scores{" "}
        <Link href="/points" className="font-bold text-[var(--text)] underline decoration-dotted hover:text-[var(--gold)]">
          ROPES Points →
        </Link>
      </p>

      {!boards ? (
        <p className="mt-10 text-center text-[11px] font-bold tracking-[0.3em] text-[var(--dim)]">FETCHING THE BOARDS…</p>
      ) : tab === "week" ? (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
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
      ) : (
        <div className="mt-5">
          <Board
            title="ALL-TIME RANKED"
            sub="NET WINNINGS SINCE RANKED BEGAN"
            rows={boards.allTime.summit}
            mine={mine}
            value={(r) => ({ text: usd(r.net), color: r.net >= 0 ? "var(--up)" : "var(--down)" })}
            detail={(r) => `${r.runs} RUN${r.runs === 1 ? "" : "S"} · BEST ${r.best.toFixed(2)}× · ${r.longest}R`}
          />
        </div>
      )}
    </main>
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
  rows: Row[];
  mine: string | null;
  value: (r: Row) => { text: string; color: string };
  detail: (r: Row) => string;
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
                style={{
                  background: "var(--panel)",
                  borderColor: isMe ? "var(--gold)" : "var(--edge)",
                  boxShadow: isMe ? "0 0 24px -12px var(--gold)" : "none",
                }}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`display tabular w-7 text-lg ${i === 0 ? "glow-gold" : "text-[var(--dim)]"}`}>{i + 1}</span>
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
