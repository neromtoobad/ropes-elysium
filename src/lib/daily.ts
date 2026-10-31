/**
 * The Daily Climb: one shot a day.
 *
 * A player's FIRST run of the UTC day — practice or ranked, whichever they
 * take first — is their Daily Climb, and today's board ranks those runs
 * alone. It resets at 00:00 UTC. It is for the glory: no points, no prize,
 * and the ranked boards (lib/boards) are untouched by it.
 *
 * The score is the multiple the run finished at (banked or cut); a run still
 * on the wall shows its settled stack, marked live. Ties go to the run that
 * survived more bells, then to whoever started first.
 *
 * Identity is the player (the browser's key), so a practice climber with no
 * wallet is on the board too. Runs carry no timestamp, so "today" is every
 * run that started on or after the first round opened since midnight UTC.
 */
import { db } from "./db";
import { toUsd } from "./chain";
import { dayStart, firstRoundIndexSince } from "./boards";

export type DailyRow = {
  rank: number;
  runId: string;
  name: string;
  multiple: number;
  rounds: number;
  status: "alive" | "banked" | "eliminated";
  ranked: boolean;
};

export type Daily = {
  /** YYYY-MM-DD, UTC. */
  day: string;
  resetsAt: string;
  entrants: number;
  rows: DailyRow[];
};

/** Today's first run per player, in start order (ties by id, as the ledger does). */
async function todaysFirstRuns() {
  const from = await firstRoundIndexSince(dayStart());
  if (from === null) return [];
  const runs = await db.run.findMany({
    where: { startedRoundIndex: { gte: from } },
    select: {
      id: true,
      playerId: true,
      status: true,
      stack: true,
      buyIn: true,
      finalMultiple: true,
      roundsSurvived: true,
      startedRoundIndex: true,
      payoutAddress: true,
      player: { select: { displayName: true } },
    },
    orderBy: [{ startedRoundIndex: "asc" }, { id: "asc" }],
  });
  const first = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!first.has(r.playerId)) first.set(r.playerId, r);
  return [...first.values()];
}

async function compute(): Promise<Daily> {
  const start = dayStart();
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const runs = await todaysFirstRuns();
  const scored = runs
    .map((r) => ({
      runId: r.id,
      name: r.player.displayName,
      multiple: r.status === "alive" ? toUsd(r.stack) / toUsd(r.buyIn) : (r.finalMultiple ?? toUsd(r.stack) / toUsd(r.buyIn)),
      rounds: r.roundsSurvived,
      status: r.status as DailyRow["status"],
      ranked: r.payoutAddress !== null,
      start: r.startedRoundIndex,
    }))
    .sort((a, b) => b.multiple - a.multiple || b.rounds - a.rounds || a.start - b.start);
  return {
    day: start.toISOString().slice(0, 10),
    resetsAt: end.toISOString(),
    entrants: scored.length,
    rows: scored.map(({ start: _start, ...r }, i) => ({ rank: i + 1, ...r })),
  };
}

let cache: { at: number; value: Daily } | null = null;

/** Cached for ten seconds: the home page, the boards and the play page all read it. */
export async function getDaily(): Promise<Daily> {
  if (cache && Date.now() - cache.at < 10_000 && cache.value.day === dayStart().toISOString().slice(0, 10)) {
    return cache.value;
  }
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}

/** This player's Daily Climb today: the run, and where it stands. */
export async function dailyFor(playerId: string) {
  const from = await firstRoundIndexSince(dayStart());
  const first =
    from === null
      ? null
      : await db.run.findFirst({
          where: { playerId, startedRoundIndex: { gte: from } },
          orderBy: [{ startedRoundIndex: "asc" }, { id: "asc" }],
          select: { id: true },
        });
  const board = await getDaily();
  const row = first ? board.rows.find((r) => r.runId === first.id) ?? null : null;
  return {
    runId: first?.id ?? null,
    rank: row?.rank ?? null,
    entrants: board.entrants,
    resetsAt: board.resetsAt,
  };
}
