import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { climberOr, getRunCard, runVerdict } from "@/lib/runcard";

/**
 * A run, shared. The link a player posts after a run: X unfurls it into the
 * card (api/og/run), and anyone who taps through lands here, one tap from
 * their own seat.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const climber = climberOr((await searchParams).c);
  const card = await getRunCard(id).catch(() => null);
  if (!card) return { title: "ROPES" };
  const title = `${card.name} · ${card.multiple.toFixed(2)}× · ${runVerdict(card).toLowerCase()}`;
  const description = `${card.rounds} bell${card.rounds === 1 ? "" : "s"} survived, peak ${card.peak.toFixed(2)}×${
    card.daily ? ", on the Daily Climb" : ""
  }. One minute of HYPE, on a rope. Can you climb higher?`;
  const image = { url: `/api/og/run/${card.id}?c=${climber}`, width: 1200, height: 630 };
  return {
    title,
    description,
    openGraph: { title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function RunPage({ params, searchParams }: Props) {
  const { id } = await params;
  const climber = climberOr((await searchParams).c);
  const card = await getRunCard(id).catch(() => null);
  if (!card) notFound();
  return (
    <main className="relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-6 px-4 py-10">
      <p className="text-[10px] font-black tracking-[0.35em] text-[var(--dim)]">
        {card.daily ? "A DAILY CLIMB ON ROPES" : "A CLIMB ON ROPES"}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/og/run/${card.id}?c=${climber}`}
        alt={`${card.name} reached ${card.multiple.toFixed(2)}× and ${runVerdict(card).toLowerCase()} after ${card.rounds} bells`}
        width={1200}
        height={630}
        className="chamfer-sm h-auto w-full border border-[var(--edge)]"
      />
      <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
        <Link
          href="/play"
          className="chamfer-sm display flex min-h-12 items-center justify-center bg-[var(--gold)] px-6 text-base tracking-[0.12em] text-black"
        >
          TAKE A SEAT — IT&apos;S FREE →
        </Link>
        <Link
          href="/leaders?tab=daily"
          className="chamfer-sm flex min-h-12 items-center justify-center border border-[var(--edge)] px-6 text-[11px] font-black tracking-[0.2em] text-[var(--text)] hover:border-[var(--gold)]"
        >
          TODAY&apos;S DAILY CLIMB
        </Link>
      </div>
      <p className="max-w-md text-center text-[11px] leading-relaxed text-[var(--dim)]">
        Every minute HYPE either closes above the line or below it. Pick a side, ride the bell, bail any second.
        Your first run each day is your Daily Climb.
      </p>
    </main>
  );
}
