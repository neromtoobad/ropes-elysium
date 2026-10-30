"use client";

/**
 * The daily streak on the points page: the flame and its number, the last
 * seven days, the milestones, and the button that claims today.
 */
import { useEffect, useState } from "react";
import { Flame, useStreak } from "../streak";

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).toUpperCase().slice(0, 2);

function untilMidnight(now: number) {
  const s = Math.max(0, Math.floor((DAY - (now % DAY)) / 1000));
  return `${Math.floor(s / 3600)}H ${Math.floor((s % 3600) / 60)}M`;
}

export default function StreakPanel({ onClaimed }: { onClaimed: () => void }) {
  const { streak: s, claim } = useStreak();
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!s?.wallet) return null;
  const current = s.current ?? 0;
  const history = s.history ?? [];
  const claimed = new Set(history.map((h) => h.day));
  // Days a freeze covered: the gap before each claim that spent freezes.
  const frozen = new Set<string>();
  for (const h of history) for (let k = 1; k <= h.frozeBefore; k++) frozen.add(isoDay(Date.parse(`${h.day}T00:00:00Z`) - k * DAY));

  const today = isoDay(now);
  const week = Array.from({ length: 7 }, (_, i) => isoDay(Date.parse(`${today}T00:00:00Z`) - (6 - i) * DAY));

  const doClaim = async () => {
    setBusy(true);
    const j = await claim();
    setBusy(false);
    if (j?.claimedToday) {
      setBurst(true);
      setTimeout(() => setBurst(false), 1200);
      onClaimed();
    }
  };

  return (
    <section
      id="streak"
      className="chamfer mt-6 grid scroll-mt-6 gap-5 border px-5 py-5 sm:px-8 md:grid-cols-[auto_1fr_auto] md:items-center"
      style={{
        borderColor: s.claimedToday ? "var(--edge)" : "#ff8a1f",
        background: "radial-gradient(80% 120% at 0% 50%, rgba(255,138,31,0.16), transparent 60%), var(--panel)",
        boxShadow: s.claimedToday ? "none" : "0 0 40px -22px #ff8a1f",
      }}
    >
      <div className="flex items-center gap-4">
        <div className={`relative transition-transform duration-500 ${burst ? "scale-125" : ""}`}>
          <Flame size={56} lit={current > 0} />
          {burst && <span className="absolute inset-0 animate-ping rounded-full bg-[#ff8a1f]/30" />}
        </div>
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[#ffb35c]">DAILY STREAK</p>
          <p className="display tabular text-4xl leading-none">
            {current} <span className="text-base text-[var(--dim)]">{current === 1 ? "DAY" : "DAYS"}</span>
          </p>
          <p className="mt-1 text-[10px] font-bold tracking-[0.18em] text-[var(--dim)]">
            BEST {s.best ?? 0} · {s.freezes ?? 0} FREEZE{(s.freezes ?? 0) === 1 ? "" : "S"} BANKED
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <div className="grid grid-cols-7 gap-1.5">
          {week.map((d) => {
            const isToday = d === today;
            const on = claimed.has(d);
            const ice = frozen.has(d);
            return (
              <div key={d} className="flex flex-col items-center gap-1">
                <span className={`text-[9px] font-black tracking-[0.15em] ${isToday ? "text-[var(--text)]" : "text-[var(--dim)]"}`}>{isToday ? "TODAY" : weekday(d)}</span>
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 sm:h-10 sm:w-10 ${isToday && !on ? "animate-pulse" : ""}`}
                  style={{
                    borderColor: on ? "#ff8a1f" : ice ? "#7fd6ff" : isToday ? "#ff8a1f" : "var(--edge)",
                    background: on ? "rgba(255,138,31,0.18)" : ice ? "rgba(127,214,255,0.15)" : "transparent",
                    borderStyle: isToday && !on ? "dashed" : "solid",
                  }}
                  title={on ? "Checked in" : ice ? "Covered by a freeze" : isToday ? "Check in today" : "Missed"}
                >
                  {on ? <Flame size={16} /> : ice ? <span className="text-[13px] text-[#7fd6ff]">❄</span> : null}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.rules.milestones.map((m) => {
            const hit = (s.best ?? 0) >= m.days;
            return (
              <span
                key={m.days}
                className="rounded-full border px-2.5 py-0.5 text-[9px] font-black tracking-[0.15em]"
                style={{ borderColor: hit ? "#ff8a1f" : "var(--edge)", color: hit ? "#ffb35c" : "var(--dim)" }}
              >
                {m.days} DAYS · +{m.bonus}
              </span>
            );
          })}
          <span className="rounded-full border border-[var(--edge)] px-2.5 py-0.5 text-[9px] font-black tracking-[0.15em] text-[var(--dim)]">
            ❄ A FREEZE EVERY {s.rules.freezeEvery} DAYS
          </span>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-1.5 md:w-56">
        {s.claimedToday ? (
          <>
            <div className="chamfer-sm border border-[var(--edge)] px-4 py-3 text-center text-[11px] font-black tracking-[0.2em] text-[var(--up)]">CHECKED IN ✓</div>
            <p className="text-center text-[10px] font-bold tracking-[0.15em] text-[var(--dim)]">NEXT CHECK-IN IN {untilMidnight(now)}</p>
          </>
        ) : (
          <>
            <button
              onClick={doClaim}
              disabled={busy}
              className="chamfer-sm px-4 py-3 text-[12px] font-black tracking-[0.2em] text-black transition hover:brightness-110 disabled:opacity-60"
              style={{ background: "linear-gradient(90deg, #ff8a1f, #ffd34d)" }}
            >
              {busy ? "LIGHTING…" : `CHECK IN · +${(s.next?.points ?? 0) + (s.next?.bonus ?? 0)}`}
            </button>
            <p className="text-center text-[10px] font-bold tracking-[0.15em] text-[var(--dim)]">
              {s.next && s.next.bonus > 0
                ? `DAY ${s.next.streak} INCLUDES A +${s.next.bonus} MILESTONE`
                : (s.wouldFreeze ?? 0) > 0
                  ? `A FREEZE SAVES YOUR ${current}-DAY STREAK`
                  : current > 0
                    ? `KEEP IT ALIVE · ENDS IN ${untilMidnight(now)}`
                    : `DAY 1 PAYS +${s.rules.perDay}, UP TO +${s.rules.cap} A DAY`}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
