"use client";

/**
 * One lesson: the sections, a one-question check, and the way on. Answering
 * the check right marks the lesson done in this browser.
 */
import Link from "next/link";
import { Fragment, useState } from "react";
import { PageHeader, useClimberTheme } from "../../shared";
import { LESSONS, lessonBySlug } from "@/lib/lessons";
import { useLearned } from "../progress";

/** **bold** and nothing else (see lib/lessons). */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 ? (
          <b key={i} className="text-[var(--text)]">
            {part}
          </b>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export default function LessonView({ slug }: { slug: string }) {
  useClimberTheme();
  const l = lessonBySlug(slug)!;
  const i = LESSONS.indexOf(l);
  const next = LESSONS[i + 1] ?? null;
  const prev = LESSONS[i - 1] ?? null;
  const { done, mark } = useLearned();
  const [picked, setPicked] = useState<number | null>(null);
  const right = picked === l.check.answer;
  const isDone = done.includes(slug);

  const answer = (k: number) => {
    setPicked(k);
    if (k === l.check.answer) mark(slug);
  };

  return (
    <main className="relative z-10 mx-auto min-h-screen max-w-3xl px-4 py-4">
      <PageHeader title="LEARN" />

      <nav className="mt-6 flex flex-wrap items-center gap-x-2 text-[10px] font-bold tracking-[0.22em] text-[var(--dim)]" aria-label="breadcrumb">
        <Link href="/learn" className="hover:text-[var(--gold)]">LEARN</Link>
        <span>/</span>
        <span>{l.group.toUpperCase()}</span>
        <span>·</span>
        <span className="tabular">
          LESSON {i + 1} OF {LESSONS.length}
        </span>
      </nav>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--edge)]">
        <div className="h-full bg-[var(--gold)]" style={{ width: `${((i + 1) / LESSONS.length) * 100}%` }} />
      </div>

      <header className="mt-5">
        <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">
          {l.minutes} MIN READ{isDone && <span className="text-[var(--up)]"> · DONE ✓</span>}
        </p>
        <h2 className="display mt-1 text-3xl leading-tight sm:text-4xl">{l.title}</h2>
        <p className="mt-2 text-[14px] text-[var(--dim)]">{l.sub}</p>
      </header>

      <div className="mt-6 space-y-6">
        {l.sections.map((s) => (
          <section key={s.h}>
            <h3 className="display text-lg tracking-[0.04em]">{s.h}</h3>
            {s.p?.map((t) => (
              <p key={t} className="mt-2 text-[14px] leading-relaxed text-[var(--dim)]">
                <Rich text={t} />
              </p>
            ))}
            {s.list && (
              <ul className="mt-2 space-y-2">
                {s.list.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-[var(--dim)]">
                    <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--gold)]" />
                    <span>
                      <Rich text={t} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {s.steps && (
              <ol className="mt-2 space-y-2">
                {s.steps.map((t, k) => (
                  <li key={t} className="flex gap-3 text-[14px] leading-relaxed text-[var(--dim)]">
                    <span className="display tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--gold)] text-[11px] text-[var(--gold)]">{k + 1}</span>
                    <span>
                      <Rich text={t} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {s.table && (
              <div className="chamfer-sm mt-3 border border-[var(--edge)] px-4 py-1" style={{ background: "var(--panel)" }}>
                {s.table.map(([k, v]) => (
                  <div key={k} className="grid gap-x-4 gap-y-0.5 border-b border-[var(--edge)] py-2 text-[13px] last:border-0 sm:grid-cols-[150px_1fr]">
                    <span className="font-bold text-[var(--gold)]">{k}</span>
                    <span className="break-words leading-relaxed text-[var(--dim)]">
                      <Rich text={v} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <section className="chamfer mt-8 border border-[var(--gold)] px-5 py-5" style={{ background: "var(--panel)" }}>
        <p className="text-[10px] font-bold tracking-[0.3em] text-[var(--gold)]">QUICK CHECK</p>
        <p className="mt-1 font-bold leading-snug">{l.check.q}</p>
        <div className="mt-3 space-y-1.5">
          {l.check.options.map((o, k) => {
            const chosen = picked === k;
            const showRight = picked !== null && right && k === l.check.answer;
            const color = showRight ? "var(--up)" : chosen ? "var(--down)" : "var(--edge)";
            return (
              <button
                key={o}
                onClick={() => answer(k)}
                disabled={right}
                className="chamfer-sm flex w-full items-center gap-3 border px-4 py-2.5 text-left text-[13px] transition enabled:hover:border-[var(--gold)]"
                style={{ borderColor: color, background: showRight ? "color-mix(in srgb, var(--up) 10%, transparent)" : "transparent" }}
              >
                <span className="display w-4 text-[var(--dim)]">{"ABC"[k]}</span>
                <span>{o}</span>
                {showRight && <span className="ml-auto text-[var(--up)]">✓</span>}
              </button>
            );
          })}
        </div>
        {picked !== null && (
          <p className="mt-3 text-[12px] leading-relaxed" style={{ color: right ? "var(--up)" : "var(--down)" }}>
            {right ? l.check.why : "Not quite. Have another look above and try again."}
          </p>
        )}
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={l.cta.href} className="chamfer-sm border border-[var(--gold)] px-4 py-2.5 text-[11px] font-black tracking-[0.2em] text-[var(--gold)] transition hover:bg-[var(--gold)] hover:text-black">
          {l.cta.label.toUpperCase()} →
        </Link>
        <div className="flex gap-2">
          {prev && (
            <Link href={`/learn/${prev.slug}`} className="chamfer-sm border border-[var(--edge)] px-4 py-2.5 text-[11px] font-black tracking-[0.2em] hover:border-[var(--gold)]">
              ← BACK
            </Link>
          )}
          <Link
            href={next ? `/learn/${next.slug}` : "/learn"}
            className="chamfer-sm bg-[var(--gold)] px-5 py-2.5 text-[11px] font-black tracking-[0.2em] text-black transition hover:brightness-110"
          >
            {next ? "NEXT LESSON →" : "BACK TO LEARN"}
          </Link>
        </div>
      </div>
      {next && <p className="mt-2 text-right text-[10px] font-bold tracking-[0.15em] text-[var(--dim)]">NEXT: {next.title.toUpperCase()}</p>}
    </main>
  );
}
