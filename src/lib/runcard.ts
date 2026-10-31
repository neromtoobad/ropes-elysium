/**
 * One run, as its share card tells it: who, how high, how it ended, and the
 * bells it rode. Public — a run id is already on every viewer's wall — and
 * read-only.
 */
import { db } from "./db";
import { toUsd } from "./chain";
import { dayStart, firstRoundIndexSince } from "./boards";

/** The eight climbers. Mirrors CAST in Cliff.tsx, which is a client module. */
export const CLIMBER_IDS = ["green", "red", "gold", "blue", "violet", "orange", "teal", "pink"] as const;
export type CardClimber = (typeof CLIMBER_IDS)[number];
export const climberOr = (c: unknown): CardClimber =>
  CLIMBER_IDS.includes(c as CardClimber) ? (c as CardClimber) : "gold";

export type RunCard = {
  id: string;
  name: string;
  status: "alive" | "banked" | "eliminated";
  multiple: number;
  /** Highest settled stack the run reached, as a multiple of the buy-in. */
  peak: number;
  rounds: number;
  ranked: boolean;
  /** The bells, oldest first: the side ridden and how it went. */
  trail: { side: "UP" | "DOWN"; outcome: "won" | "lost" | "push" }[];
  /** This was the player's Daily Climb (first run of its UTC day). */
  daily: boolean;
  /** YYYY-MM-DD the run started, UTC. */
  day: string | null;
};

export async function getRunCard(id: string): Promise<RunCard | null> {
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;
  const r = await db.run.findUnique({
    where: { id },
    include: {
      player: { select: { displayName: true } },
      positions: {
        select: { side: true, outcome: true, stackAfter: true, round: { select: { index: true } } },
      },
    },
  });
  if (!r) return null;

  const buy = toUsd(r.buyIn);
  const settled = [...r.positions]
    .filter((p) => p.stackAfter !== null && (p.outcome === "won" || p.outcome === "lost" || p.outcome === "push"))
    .sort((a, b) => a.round.index - b.round.index);
  const multiple =
    r.status === "alive" ? toUsd(r.stack) / buy : (r.finalMultiple ?? toUsd(r.stack) / buy);
  const peak = Math.max(
    1,
    multiple,
    ...settled.filter((p) => p.outcome !== "lost").map((p) => toUsd(p.stackAfter!) / buy),
  );

  // Was it the Daily Climb of the day it started on?
  const startRound = await db.round.findUnique({ where: { index: r.startedRoundIndex }, select: { opensAt: true } });
  let daily = false;
  let day: string | null = null;
  if (startRound) {
    const d0 = dayStart(startRound.opensAt);
    day = d0.toISOString().slice(0, 10);
    const from = await firstRoundIndexSince(d0);
    if (from !== null) {
      const first = await db.run.findFirst({
        where: { playerId: r.playerId, startedRoundIndex: { gte: from } },
        orderBy: [{ startedRoundIndex: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      daily = first?.id === r.id;
    }
  }

  return {
    id: r.id,
    name: r.player.displayName,
    status: r.status as RunCard["status"],
    multiple,
    peak,
    rounds: r.roundsSurvived,
    ranked: r.payoutAddress !== null,
    trail: settled.map((p) => ({ side: p.side as "UP" | "DOWN", outcome: p.outcome as "won" | "lost" | "push" })),
    daily,
    day,
  };
}

/** The headline, in words, for the card, the page title and the post. */
export function runVerdict(c: RunCard) {
  if (c.status === "alive") return "STILL CLIMBING";
  if (c.status === "eliminated") return "CUT AT THE BELL";
  return c.multiple >= 1 ? "BAILED IN TIME" : "WALKED AWAY";
}
