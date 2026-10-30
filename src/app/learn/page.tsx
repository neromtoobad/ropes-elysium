"use client";

/**
 * The learn hub: every lesson, grouped in the order a new player needs them,
 * with this browser's progress. The docs are the reference; this is the
 * walk-through.
 */
import Link from "next/link";
import { PageHeader, useClimberTheme } from "../shared";
import { GROUPS, LESSONS } from "@/lib/lessons";
import { useLearned } from "./progress";

export default function Learn() {
  useClimberTheme();
  const { done } = useLearned();
  const total = LESSONS.length;
  const finished = LESSONS.filter((l) => done.includes(l.slug)).length;
  const next = LESSONS.find((l) => !done.includes(l.slug)) ?? null;
  const minutes = LESSONS.reduce((n, l) => n + l.minutes, 0);

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-5xl px-4 py-4">
      <PageHeader title="LEARN" />

      <div className="mt-6 grid gap-5 md:grid-cols-[1fr_320px] md:items-end">
        <div>
          <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">{total} LESSONS · ABOUT {minutes} MINUTES</p>
          <h2 className="display mt-1 text-3xl leading-none sm:text-4xl">Learn the rope.</h2>
          <p className="mt-2 max-w-xl text-[12px] leading-relaxed text-[var(--dim)]">
            Two or three minutes each, in the order you need them. Each ends with one question to check it landed. Want every detail?{" "}
            <Link href="/docs/overview" className="font-bold text-[var(--text)] underline decoration-dotted hover:text-[var(--gold)]">The docs</Link> have it.
          </p>
        </div>
        <div className="chamfer border border-[var(--gold)] px-5 py-4" style={{ background: "var(--panel)" }}>
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-bold tracking-[0.25em] text-[var(--dim)]">YOUR PROGRESS</span>
            <span className="display tabular text-xl text-[var(--gold)]">
              {finished}/{total}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--edge)]">
            <div className="h-full rounded-full bg-[var(--gold)] transition-all" style={{ width: `${(finished / total) * 100}%` }} />
          </div>
          {next ? (
            <Link href={`/learn/${next.slug}`} className="chamfer-sm mt-3 block bg-[var(--gold)] px-4 py-2.5 text-center text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110">
              {finished === 0 ? "START HERE" : "NEXT"}: {next.title.toUpperCase()} →
            </Link>
          ) : (
            <Link href="/play" className="chamfer-sm mt-3 block bg-[var(--gold)] px-4 py-2.5 text-center text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110">
              ALL DONE. GO CLIMB →
            </Link>
          )}
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {GROUPS.map((g, gi) => (
          <section key={g}>
            <h3 className="display text-lg tracking-[0.08em]">
              <span className="text-[var(--dim)]">0{gi + 1}</span> {g.toUpperCase()}
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {LESSONS.filter((l) => l.group === g).map((l) => {
                const n = LESSONS.indexOf(l) + 1;
                const isDone = done.includes(l.slug);
                return (
                  <Link
                    key={l.slug}
                    href={`/learn/${l.slug}`}
                    className="chamfer-sm group flex items-start gap-3 border px-4 py-3 transition hover:border-[var(--gold)]"
                    style={{ background: "var(--panel)", borderColor: next?.slug === l.slug ? "var(--gold)" : "var(--edge)" }}
                  >
                    <span
                      className="display tabular mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm"
                      style={{ borderColor: isDone ? "var(--up)" : "var(--edge)", color: isDone ? "var(--up)" : "var(--dim)" }}
                    >
                      {isDone ? "✓" : n}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold leading-snug group-hover:text-[var(--gold)]">{l.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--dim)]">{l.sub}</span>
                      <span className="mt-1 block text-[9px] font-bold tracking-[0.2em] text-[var(--dim)]">
                        {l.minutes} MIN{isDone && <span className="text-[var(--up)]"> · DONE</span>}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
