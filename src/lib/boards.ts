/**
 * Ranked play and the weekly boards.
 *
 * A RANKED run is a paid seat: bought from the player's own tUSDC bankroll,
 * which only exists behind a signed deposit from a real wallet. Practice
 * seats (the house's money, no wallet) still play the same market, but they
 * never count here — a free seat costs nothing, so a free seat proves nothing.
 *
 * Ranked identity is the wallet (payoutAddress), not the browser's player
 * key: two browsers on one wallet are one climber on the board.
 *
 * Weeks run Monday 00:00 UTC to the next Monday. A run counts in the week
 * its bell rang for the last time.
 */
import { db } from "./db";
import { toUsd } from "./chain";

/** Ranked seats one wallet may buy per UTC day. Every call costs something. */
export const RANKED_SEATS_PER_DAY = 20;

export type BoardRow = {
  /** Lowercased wallet: the ranked identity. */
  wallet: string;
  name: string;
  runs: number;
  /** Proceeds minus buy-ins across the window's ranked runs. */
  net: number;
  /** Best banked multiple in the window. */
  best: number;
  /** Most rounds one run survived in the window. */
  longest: number;
  /** Self-claimed X handle, lowercased, no @. */
  handle: string | null;
};

export function weekBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start, end };
}

const dayStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** The first round that opened at or after a moment — rounds pause when the
 *  wall is idle, so a round index is not a clock and has to be looked up. */
async function firstRoundIndexSince(at: Date) {
  const r = await db.round.findFirst({ where: { opensAt: { gte: at } }, orderBy: { index: "asc" }, select: { index: true } });
  return r?.index ?? null;
}

/** Ranked seats this wallet has bought today (UTC). */
export async function rankedSeatsToday(address: string) {
  const from = await firstRoundIndexSince(dayStart());
  if (from === null) return 0;
  return db.run.count({
    where: { payoutAddress: { equals: address, mode: "insensitive" }, startedRoundIndex: { gte: from } },
  });
}

function aggregate(runs: RankedRun[], handles: Map<string, string>) {
  const by = new Map<string, BoardRow>();
  for (const r of runs) {
    const row = by.get(r.wallet) ?? { wallet: r.wallet, name: r.name, runs: 0, net: 0, best: 0, longest: 0, handle: handles.get(r.wallet) ?? null };
    row.runs += 1;
    row.net += r.net;
    row.best = Math.max(row.best, r.multiple);
    row.longest = Math.max(row.longest, r.rounds);
    row.name = r.name; // runs arrive oldest first, so the latest name wins
    by.set(r.wallet, row);
  }
  return [...by.values()];
}

let cache: { at: number; value: Awaited<ReturnType<typeof compute>> } | null = null;

/** Both boards plus the all-time ranked board. Cached for ten seconds: the
 *  home page and the leaderboard both poll it. */
export async function getBoards() {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}

export type RankedRun = {
  wallet: string;
  name: string;
  net: number;
  multiple: number;
  rounds: number;
  banked: boolean;
  champion: boolean;
  endedAt: Date | null;
};

/** Every ended ranked run, oldest first, with the moment its last bell rang.
 *  The boards and the points table are both views of this one list. */
export async function endedRankedRuns(): Promise<RankedRun[]> {
  const ended = await db.run.findMany({
    where: { payoutAddress: { not: null }, status: { in: ["banked", "eliminated"] } },
    include: { player: { select: { displayName: true } }, table: { select: { finishedAt: true } } },
    orderBy: { startedRoundIndex: "asc" },
  });

  // Champions are crowned by the table, which records the moment on the
  // table rather than the run.
  const idx = [...new Set(ended.map((r) => r.endedRoundIndex).filter((i): i is number => i !== null))];
  const rounds = idx.length
    ? await db.round.findMany({ where: { index: { in: idx } }, select: { index: true, expiresAt: true } })
    : [];
  const bell = new Map(rounds.map((r) => [r.index, r.expiresAt]));

  return ended.map((r) => ({
    wallet: r.payoutAddress!.toLowerCase(),
    name: r.player.displayName,
    net: toUsd(r.stack) - toUsd(r.buyIn),
    multiple: r.finalMultiple ?? toUsd(r.stack) / toUsd(r.buyIn),
    rounds: r.roundsSurvived,
    banked: r.status === "banked",
    champion: r.isChampion,
    endedAt: (r.endedRoundIndex !== null ? bell.get(r.endedRoundIndex) : null) ?? r.table?.finishedAt ?? null,
  }));
}

/** Wallet → claimed handle. Tolerates the table not existing yet: the web
 *  app can boot a moment before the executor's schema push lands. */
export async function handleMap(): Promise<Map<string, string>> {
  const rows = await db.climber.findMany({ where: { handle: { not: null } }, select: { address: true, handle: true } }).catch(() => []);
  return new Map(rows.map((c) => [c.address, c.handle!]));
}

/** Rank a window's runs the way the Summit does. Shared with the points
 *  table, which pays out on where a climber finished each week. */
export function summitOf(runs: RankedRun[], handles = new Map<string, string>()) {
  return aggregate(runs, handles).sort((a, b) => b.net - a.net);
}
export function longestOf(runs: RankedRun[], handles = new Map<string, string>()) {
  return aggregate(runs, handles).filter((r) => r.longest > 0).sort((a, b) => b.longest - a.longest || b.best - a.best);
}

async function compute() {
  const { start, end } = weekBounds();
  const [rows, handles] = await Promise.all([endedRankedRuns(), handleMap()]);
  const thisWeek = rows.filter((r) => r.endedAt && r.endedAt >= start && r.endedAt < end);

  const week = aggregate(thisWeek, handles);
  const allTime = aggregate(rows, handles);
  return {
    week: {
      start: start.toISOString(),
      end: end.toISOString(),
      summit: summitOf(thisWeek, handles),
      longest: longestOf(thisWeek, handles),
      best: [...week].filter((r) => r.best > 1).sort((a, b) => b.best - a.best),
    },
    allTime: {
      summit: [...allTime].sort((a, b) => b.net - a.net),
      best: [...allTime].filter((r) => r.best > 1).sort((a, b) => b.best - a.best),
    },
    rankedSeatsPerDay: RANKED_SEATS_PER_DAY,
  };
}
