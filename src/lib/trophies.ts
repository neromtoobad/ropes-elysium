/**
 * Trophies: thirteen things worth doing on a rope, most of them in three tiers.
 *
 * Like the rest of the points table, nothing is stored. Each trophy is a
 * ladder over a series the ledger already has — rounds survived, multiples
 * banked, days played — and a tier is earned the moment that series first
 * crosses its threshold. That moment is the timestamp of the points event,
 * so trophy points land in the 24h column exactly when they were won.
 */
import type { RankedRun } from "./boards";
import { walk } from "./streak";

export const TIERS = ["bronze", "silver", "gold"] as const;
export type Tier = (typeof TIERS)[number];
/** Points per tier, by tier reached. A single-tier trophy pays the first. */
export const TIER_POINTS = [25, 75, 200];

export type TrophyDef = {
  id: string;
  name: string;
  /** "Survive {n} rounds in one run": {n} is the tier's threshold. */
  goal: string;
  thresholds: number[];
};

export const TROPHIES: TrophyDef[] = [
  { id: "first-climb", name: "First Climb", goal: "Finish your first ranked seat", thresholds: [1] },
  { id: "survivor", name: "Survivor", goal: "Survive {n} rounds in one run", thresholds: [3, 6, 10] },
  { id: "moonshot", name: "Moonshot", goal: "Bank a run at {n}× or more", thresholds: [2, 5, 10] },
  { id: "champion", name: "Last One Holding", goal: "Win {n} table(s) as the last run standing", thresholds: [1, 5, 20] },
  { id: "clean-exit", name: "Clean Exit", goal: "Bank {n} runs in profit", thresholds: [5, 25, 100] },
  { id: "diamond", name: "Diamond Grip", goal: "Fall under 0.5×, then bank above 1×, {n} time(s)", thresholds: [1, 3, 10] },
  { id: "on-fire", name: "On Fire", goal: "Play ranked {n} days in a row", thresholds: [3, 7, 14] },
  { id: "showed-up", name: "Showed Up", goal: "Reach a {n}-day check-in streak", thresholds: [7, 30, 100] },
  { id: "regular", name: "Regular", goal: "Play {n} ranked seats", thresholds: [10, 100, 500] },
  { id: "endurance", name: "Endurance", goal: "Survive {n} rounds in total", thresholds: [50, 250, 1000] },
  { id: "summit", name: "Summit Finisher", goal: "Finish a week's Summit in the top {n}", thresholds: [10, 3, 1] },
  { id: "recruiter", name: "Recruiter", goal: "Invite {n} wallet(s) that play ranked", thresholds: [1, 5, 20] },
  { id: "bug-hunter", name: "Bug Hunter", goal: "Get {n} feedback post(s) rewarded", thresholds: [1, 3, 10] },
];

export type TrophyState = {
  id: string;
  /** Tiers earned, 0–3 (0–1 for single-tier trophies). */
  tier: number;
  /** Where the series stands now (best rank for Summit, lower is better). */
  value: number | null;
  earnedAt: (string | null)[];
};

type Point = { at: Date; value: number };
/** Running total of a stream of increments. */
const cumulative = (xs: { at: Date; inc: number }[]): Point[] => {
  let v = 0;
  return [...xs].sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => ({ at: x.at, value: (v += x.inc) }));
};

/** First time each threshold was reached. `lowerIsBetter` for ranks. */
function ladder(series: Point[], thresholds: number[], lowerIsBetter = false) {
  const ordered = [...series].sort((a, b) => a.at.getTime() - b.at.getTime());
  const earnedAt = thresholds.map((t) => ordered.find((p) => (lowerIsBetter ? p.value <= t : p.value >= t))?.at ?? null);
  const value = ordered.length ? (lowerIsBetter ? Math.min(...ordered.map((p) => p.value)) : Math.max(...ordered.map((p) => p.value))) : null;
  // A higher tier implies the lower ones, even when the series jumped past them.
  for (let i = earnedAt.length - 2; i >= 0; i--) if (!earnedAt[i] && earnedAt[i + 1]) earnedAt[i] = earnedAt[i + 1];
  return { earnedAt, value };
}

/** Longest run of consecutive UTC days in a list of moments, as a series. */
function streakSeries(ats: Date[]): Point[] {
  const days = [...new Set(ats.map((a) => Math.floor(a.getTime() / 86_400_000)))].sort((a, b) => a - b);
  const out: Point[] = [];
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1;
    // Credited at the first ranked run of that day.
    const first = ats.filter((a) => Math.floor(a.getTime() / 86_400_000) === d).sort((a, b) => a.getTime() - b.getTime())[0];
    out.push({ at: first, value: run });
  });
  return out;
}

export type TrophyInput = {
  runs: RankedRun[];
  /** Weekly Summit finishes: wallet, place (1-based), when the week closed. */
  summitPlaces: { wallet: string; place: number; at: Date }[];
  /** invitee → inviter. */
  inviter: Map<string, string>;
  /** Hand grants with a reason, for Bug Hunter. */
  grants: { wallet: string; reason: string; at: Date }[];
  /** Daily check-ins by wallet (lib/streak). */
  checkIns: Map<string, { day: string; at: Date }[]>;
};

export function computeTrophies({ runs, summitPlaces, inviter, grants, checkIns }: TrophyInput) {
  const byWallet = new Map<string, RankedRun[]>();
  for (const r of runs) if (r.endedAt) byWallet.set(r.wallet, [...(byWallet.get(r.wallet) ?? []), r]);

  // Recruiter: an invitee counts once their first ranked seat ends.
  const recruits = new Map<string, Date[]>();
  for (const [invitee, from] of inviter) {
    const first = (byWallet.get(invitee) ?? []).map((r) => r.endedAt!).sort((a, b) => a.getTime() - b.getTime())[0];
    if (first) recruits.set(from, [...(recruits.get(from) ?? []), first]);
  }

  const wallets = new Set([...byWallet.keys(), ...recruits.keys(), ...grants.map((g) => g.wallet), ...checkIns.keys()]);
  const states = new Map<string, TrophyState[]>();
  const events: { wallet: string; points: number; at: Date; kind: string }[] = [];

  for (const w of wallets) {
    const rs = byWallet.get(w) ?? [];
    const at = (r: RankedRun) => r.endedAt!;
    const series: Record<string, { s: Point[]; lower?: boolean }> = {
      "first-climb": { s: cumulative(rs.map((r) => ({ at: at(r), inc: 1 }))) },
      survivor: { s: rs.map((r) => ({ at: at(r), value: r.rounds })) },
      moonshot: { s: rs.filter((r) => r.banked).map((r) => ({ at: at(r), value: r.multiple })) },
      champion: { s: cumulative(rs.filter((r) => r.champion).map((r) => ({ at: at(r), inc: 1 }))) },
      "clean-exit": { s: cumulative(rs.filter((r) => r.banked && r.multiple > 1).map((r) => ({ at: at(r), inc: 1 }))) },
      diamond: { s: cumulative(rs.filter((r) => r.dipped && r.banked && r.multiple > 1).map((r) => ({ at: at(r), inc: 1 }))) },
      "on-fire": { s: streakSeries(rs.map(at)) },
      regular: { s: cumulative(rs.map((r) => ({ at: at(r), inc: 1 }))) },
      endurance: { s: cumulative(rs.map((r) => ({ at: at(r), inc: r.rounds }))) },
      summit: { s: summitPlaces.filter((p) => p.wallet === w).map((p) => ({ at: p.at, value: p.place })), lower: true },
      recruiter: { s: cumulative((recruits.get(w) ?? []).map((a) => ({ at: a, inc: 1 }))) },
      "showed-up": {
        s: (() => {
          const days = checkIns.get(w) ?? [];
          const at = new Map(days.map((d) => [d.day, d.at]));
          return walk(days.map((d) => d.day)).days.map((d) => ({ at: at.get(d.day)!, value: d.streak }));
        })(),
      },
      "bug-hunter": { s: cumulative(grants.filter((g) => g.wallet === w && g.reason.startsWith("feedback:")).map((g) => ({ at: g.at, inc: 1 }))) },
    };

    const list: TrophyState[] = TROPHIES.map((t) => {
      const { earnedAt, value } = ladder(series[t.id].s, t.thresholds, series[t.id].lower);
      earnedAt.forEach((a, i) => a && events.push({ wallet: w, points: TIER_POINTS[i], at: a, kind: `trophy:${t.id}` }));
      return { id: t.id, tier: earnedAt.filter(Boolean).length, value, earnedAt: earnedAt.map((a) => a?.toISOString() ?? null) };
    });
    states.set(w, list);
  }

  // Rarity: the share of climbers holding at least each tier of each trophy.
  const n = Math.max(1, states.size);
  const rarity = Object.fromEntries(
    TROPHIES.map((t) => [t.id, t.thresholds.map((_, i) => [...states.values()].filter((l) => (l.find((x) => x.id === t.id)?.tier ?? 0) > i).length / n)]),
  );

  return { states, events, rarity };
}
