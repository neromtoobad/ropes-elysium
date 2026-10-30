/**
 * ROPES Points, Season 0 (testnet).
 *
 * Nothing here is stored as a running total. Points are a pure function of
 * the ranked runs (lib/boards), the invite graph (Climber.referredBy) and the
 * hand-typed grants (PointGrant). Every point is an EVENT with a timestamp,
 * so "the last 24 hours" and "where you ranked a day ago" fall out of the
 * same list as the season total — no snapshot job, no table to drift.
 *
 * Only ranked seats earn. A practice seat costs nothing, so it proves
 * nothing (same rule as the boards).
 */
import { db } from "./db";
import { endedRankedRuns, handleMap, longestOf, summitOf, weekBounds, type RankedRun } from "./boards";
import { computeTrophies, TIER_POINTS, type TrophyState } from "./trophies";
import { checkInsByWallet, STREAK, walk } from "./streak";

export const SEASON = { id: 0, name: "SEASON 0", sub: "TESTNET" };

/** The table, in one place: the /points page prints it straight from here. */
export const RULES = {
  seat: 10, // every ranked seat that ends
  round: 5, // every round that seat survived
  bankPerX: 20, // banking a profit: per 1× above the buy-in…
  bankCap: 200, // …capped, so one moonshot cannot end a season
  champion: 100, // last one holding at the table
  daily: 25, // first ranked seat of each UTC day
  summit: [500, 300, 200, 150, 125, 100, 75, 60, 50, 40], // weekly Summit top 10, net > 0
  longest: [150, 100, 50], // weekly Longest Climb top 3
  inviteShare: 0.1, // of everything an invited wallet earns, excluding its own invite income
  trophy: TIER_POINTS, // bronze, silver, gold (lib/trophies)
  streak: STREAK, // daily check-ins (lib/streak)
};

/** Leagues by season points. Climbing names, because it is a climbing game. */
export const LEAGUES = [
  { id: "base", name: "BASE CAMP", min: 0 },
  { id: "ledge", name: "LEDGE", min: 250 },
  { id: "ridge", name: "RIDGE", min: 1000 },
  { id: "peak", name: "PEAK", min: 2500 },
  { id: "summit", name: "SUMMIT", min: 6000 },
] as const;

export function leagueOf(points: number) {
  let i = 0;
  while (i + 1 < LEAGUES.length && points >= LEAGUES[i + 1].min) i++;
  return { ...LEAGUES[i], next: LEAGUES[i + 1] ?? null };
}

type Event = { wallet: string; points: number; at: Date; kind: string };

export type PointsRow = {
  wallet: string;
  name: string;
  handle: string | null;
  points: number;
  /** Earned in the last 24 hours. */
  day: number;
  rank: number;
  /** Rank 24 hours ago; null if the climber was not on the table yet. */
  prevRank: number | null;
  league: string;
  /** Trophy tiers earned, all trophies together. */
  trophies: number;
};

function runEvents(runs: RankedRun[]): Event[] {
  const out: Event[] = [];
  const seenDay = new Set<string>();
  for (const r of runs) {
    if (!r.endedAt) continue;
    const e = (points: number, kind: string) => points > 0 && out.push({ wallet: r.wallet, points, at: r.endedAt!, kind });
    e(RULES.seat + RULES.round * r.rounds, "seat");
    if (r.banked && r.multiple > 1) e(Math.min(RULES.bankCap, Math.round(RULES.bankPerX * (r.multiple - 1))), "bank");
    if (r.champion) e(RULES.champion, "champion");
    const day = `${r.wallet}:${r.endedAt.toISOString().slice(0, 10)}`;
    if (!seenDay.has(day)) {
      seenDay.add(day);
      e(RULES.daily, "daily");
    }
  }
  return out;
}

/** Placings on every FINISHED week's boards, credited the moment it closed.
 *  Also hands back the Summit places, which the Summit Finisher trophy reads. */
function weekEvents(runs: RankedRun[], now: Date) {
  const weeks = new Map<number, RankedRun[]>();
  for (const r of runs) {
    if (!r.endedAt) continue;
    const { end } = weekBounds(r.endedAt);
    if (end > now) continue;
    weeks.set(end.getTime(), [...(weeks.get(end.getTime()) ?? []), r]);
  }
  const out: Event[] = [];
  const places: { wallet: string; place: number; at: Date }[] = [];
  for (const [endMs, rs] of weeks) {
    const at = new Date(endMs);
    summitOf(rs)
      .filter((b) => b.net > 0)
      .slice(0, RULES.summit.length)
      .forEach((b, i) => {
        out.push({ wallet: b.wallet, points: RULES.summit[i], at, kind: "summit" });
        places.push({ wallet: b.wallet, place: i + 1, at });
      });
    longestOf(rs)
      .slice(0, RULES.longest.length)
      .forEach((b, i) => out.push({ wallet: b.wallet, points: RULES.longest[i], at, kind: "longest" }));
  }
  return { events: out, places };
}

function rankOf(events: Event[], until: Date | null) {
  const sum = new Map<string, number>();
  for (const e of events) if (!until || e.at <= until) sum.set(e.wallet, (sum.get(e.wallet) ?? 0) + e.points);
  const order = [...sum.entries()].filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { sum, rank: new Map(order.map(([w], i) => [w, i + 1])) };
}

async function compute(now = new Date()) {
  const [runs, handles, climbers, grants, checkIns] = await Promise.all([
    endedRankedRuns(),
    handleMap(),
    db.climber.findMany({ where: { referredBy: { not: null } }, select: { address: true, referredBy: true } }).catch(() => []),
    db.pointGrant.findMany().catch(() => []),
    checkInsByWallet(),
  ]);

  // Each claimed day pays what its place in the streak was worth, at the
  // moment it was claimed.
  const streakEvents: Event[] = [];
  for (const [wallet, days] of checkIns) {
    const at = new Map(days.map((d) => [d.day, d.at]));
    for (const d of walk(days.map((x) => x.day)).days) streakEvents.push({ wallet, points: d.points + d.bonus, at: at.get(d.day)!, kind: "streak" });
  }

  const weekly = weekEvents(runs, now);
  const inviter = new Map(climbers.map((c) => [c.address, c.referredBy!]));
  const trophies = computeTrophies({
    runs,
    summitPlaces: weekly.places,
    inviter,
    grants: grants.map((g) => ({ wallet: g.address.toLowerCase(), reason: g.reason, at: g.createdAt })),
    checkIns,
  });
  const base = [
    ...runEvents(runs),
    ...weekly.events,
    ...trophies.events,
    ...streakEvents,
    ...grants.map((g) => ({ wallet: g.address.toLowerCase(), points: g.points, at: g.createdAt, kind: "grant" })),
  ];
  // The inviter's cut, as events of its own at the same moments — so it
  // lands in the inviter's 24h column exactly when the invitee earned it.
  const invites = base
    .filter((e) => inviter.has(e.wallet) && e.kind !== "grant")
    .map((e) => ({ wallet: inviter.get(e.wallet)!, points: e.points * RULES.inviteShare, at: e.at, kind: "invite" }));
  const events = [...base, ...invites];

  const dayAgo = new Date(now.getTime() - 86_400_000);
  const nowRank = rankOf(events, null);
  const thenRank = rankOf(events, dayAgo);

  const names = new Map(runs.map((r) => [r.wallet, r.name])); // oldest first: the latest name wins
  const day = new Map<string, number>();
  const fromInvites = new Map<string, number>();
  for (const e of events) {
    if (e.at > dayAgo) day.set(e.wallet, (day.get(e.wallet) ?? 0) + e.points);
    if (e.kind === "invite") fromInvites.set(e.wallet, (fromInvites.get(e.wallet) ?? 0) + e.points);
  }

  const rows: PointsRow[] = [...nowRank.rank.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([wallet, rank]) => {
      const points = Math.round(nowRank.sum.get(wallet) ?? 0);
      return {
        wallet,
        name: names.get(wallet) ?? "climber",
        handle: handles.get(wallet) ?? null,
        points,
        day: Math.round(day.get(wallet) ?? 0),
        rank,
        prevRank: thenRank.rank.get(wallet) ?? null,
        league: leagueOf(points).name,
        trophies: (trophies.states.get(wallet) ?? []).reduce((n, t) => n + t.tier, 0),
      };
    });

  const invitedCount = new Map<string, number>();
  for (const c of climbers) invitedCount.set(c.referredBy!, (invitedCount.get(c.referredBy!) ?? 0) + 1);

  return {
    at: now.toISOString(),
    rows,
    fromInvites,
    invitedCount,
    trophies: trophies.states as Map<string, TrophyState[]>,
    rarity: trophies.rarity,
  };
}

let cache: { at: number; value: Awaited<ReturnType<typeof compute>> } | null = null;

/** The whole table. Cached for thirty seconds; it is a full scan of ranked runs. */
export async function getPoints() {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}

/** Drop the cache — after an invite lands or a handle changes, so the
 *  player sees their own change on the next poll. */
export function invalidatePoints() {
  cache = null;
}
