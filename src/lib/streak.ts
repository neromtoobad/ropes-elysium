/**
 * Daily streaks: show up once a UTC day, claim it, keep the flame lit.
 *
 * Only the claimed days are stored (CheckIn). Everything else — the streak,
 * the freezes, what each day paid — is walked from that list, so the rules
 * can change without migrating anything and a streak can never disagree
 * with the days behind it.
 *
 * Wallets only, like the rest of the points: a check-in needs a player key
 * whose wallet was pinned by a verified deposit.
 */
import { db } from "./db";

export const STREAK = {
  /** Day n of a streak pays perDay × n, up to cap. */
  perDay: 5,
  cap: 35,
  /** One-off bonuses the day a streak reaches these lengths. */
  milestones: [
    { days: 7, bonus: 50 },
    { days: 30, bonus: 200 },
    { days: 100, bonus: 500 },
  ],
  /** A freeze is earned every this many streak days, and covers one missed day. */
  freezeEvery: 7,
  maxFreezes: 2,
};

const DAY = 86_400_000;
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const dayNum = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);

export type StreakDay = { day: string; streak: number; points: number; bonus: number; frozeBefore: number };

/**
 * Walk a wallet's claimed days in order. A gap of k missed days is bridged
 * when k freezes are banked (each is spent); otherwise the streak restarts.
 */
export function walk(days: string[]) {
  const sorted = [...new Set(days)].sort();
  const out: StreakDay[] = [];
  let streak = 0;
  let freezes = 0;
  let best = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const n = dayNum(d);
    const missed = prev === null ? 0 : n - prev - 1;
    let frozeBefore = 0;
    if (prev !== null && missed > 0) {
      if (missed <= freezes) {
        freezes -= missed;
        frozeBefore = missed;
      } else {
        streak = 0;
        freezes = 0;
      }
    }
    streak += 1;
    if (streak % STREAK.freezeEvery === 0) freezes = Math.min(STREAK.maxFreezes, freezes + 1);
    best = Math.max(best, streak);
    const bonus = STREAK.milestones.find((m) => m.days === streak)?.bonus ?? 0;
    out.push({ day: d, streak, points: Math.min(STREAK.cap, STREAK.perDay * streak), bonus, frozeBefore });
    prev = n;
  }
  return { days: out, streak, freezes, best, last: prev };
}

/** The streak as it stands TODAY: still alive if yesterday was claimed, or
 *  if the banked freezes can cover the days since the last claim. */
export function standing(days: string[], today = utcDay()) {
  const w = walk(days);
  const t = dayNum(today);
  const claimedToday = w.last === t;
  const missed = w.last === null ? 0 : t - w.last - 1;
  const alive = w.last !== null && (claimedToday || missed <= w.freezes);
  const current = alive ? w.streak : 0;
  // What claiming today would make the streak, and pay.
  const nextLen = claimedToday ? null : alive ? w.streak + 1 : 1;
  return {
    current,
    best: w.best,
    freezes: alive ? w.freezes - (claimedToday ? 0 : Math.max(0, missed)) : 0,
    claimedToday,
    /** Freezes today's claim would spend to bridge the gap. */
    wouldFreeze: !claimedToday && alive ? missed : 0,
    next: nextLen === null ? null : { streak: nextLen, points: Math.min(STREAK.cap, STREAK.perDay * nextLen), bonus: STREAK.milestones.find((m) => m.days === nextLen)?.bonus ?? 0 },
    history: w.days,
  };
}

export async function checkInsByWallet() {
  const rows = await db.checkIn.findMany({ select: { address: true, day: true, createdAt: true } }).catch(() => []);
  const by = new Map<string, { day: string; at: Date }[]>();
  for (const r of rows) by.set(r.address, [...(by.get(r.address) ?? []), { day: r.day, at: r.createdAt }]);
  return by;
}

/** Claim today for this wallet. Claiming twice is a no-op, not an error.
 *  The caller drops the points cache (lib/points imports this file, so this
 *  file can't import it back). */
export async function claim(address: string) {
  const a = address.toLowerCase();
  const day = utcDay();
  await db.checkIn.upsert({ where: { address_day: { address: a, day } }, create: { address: a, day }, update: {} });
  return day;
}

export async function daysOf(address: string) {
  const rows = await db.checkIn.findMany({ where: { address: address.toLowerCase() }, select: { day: true } });
  return rows.map((r) => r.day);
}
