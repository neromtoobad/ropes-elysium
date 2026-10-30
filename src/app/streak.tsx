"use client";

/**
 * The daily streak, on the client: the hook every page shares, the flame,
 * and the little chip in the header that nags until today is claimed.
 * The rules live in lib/streak; this only reads and claims.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { safeLocal } from "./shared";

export type Streak = {
  wallet: string | null;
  rules: { perDay: number; cap: number; milestones: { days: number; bonus: number }[]; freezeEvery: number; maxFreezes: number };
  claimed?: boolean;
  current?: number;
  best?: number;
  freezes?: number;
  claimedToday?: boolean;
  wouldFreeze?: number;
  next?: { streak: number; points: number; bonus: number } | null;
  history?: { day: string; streak: number; points: number; bonus: number; frozeBefore: number }[];
};

async function post(body: object): Promise<Streak | null> {
  const r = await fetch("/api/streak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return r?.ok ? r.json() : null;
}

/** Reads the streak for this browser's player key, and claims today. */
export function useStreak() {
  const [s, setS] = useState<Streak | null>(null);
  useEffect(() => {
    const playerKey = safeLocal.get("lc.playerKey");
    if (!playerKey) return;
    post({ playerKey }).then((j) => j && setS(j));
    // A claim anywhere on the page (the panel) updates everyone (the chip).
    const on = (e: Event) => setS((e as CustomEvent<Streak>).detail);
    window.addEventListener("ropes:streak", on);
    return () => window.removeEventListener("ropes:streak", on);
  }, []);
  const claim = useCallback(async () => {
    const playerKey = safeLocal.get("lc.playerKey");
    if (!playerKey) return null;
    const j = await post({ playerKey, claim: true });
    if (j) window.dispatchEvent(new CustomEvent("ropes:streak", { detail: j }));
    return j;
  }, []);
  return { streak: s, claim };
}

/** A flame, drawn to match the sticker art. `lit` false is a cold ember. */
export function Flame({ size = 40, lit = true }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 50 60" aria-hidden="true">
      <path
        d="M25 3 C30 14 42 20 42 36 C42 49 34 57 25 57 C16 57 8 49 8 37 C8 28 13 23 16 17 C17 24 20 27 23 28 C21 19 22 10 25 3 Z"
        fill={lit ? "#ff8a1f" : "#4a4458"}
        stroke="#2b1b12"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M25 26 C28 32 34 36 34 44 C34 50 30 54 25 54 C20 54 16 50 16 45 C16 39 20 36 22 32 C23 36 25 37 26 37 C25 33 24 30 25 26 Z" fill={lit ? "#ffd34d" : "#6a6478"} />
      {lit && <path d="M17 30 C16 34 15 37 16 41" stroke="#fff3c4" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.8" />}
    </svg>
  );
}

/** Header chip: your streak, with a dot while today is still unclaimed. */
export function StreakChip() {
  const { streak } = useStreak();
  if (!streak?.wallet) return null;
  const open = !streak.claimedToday;
  return (
    <Link
      href="/points#streak"
      title={open ? "Check in today to keep your streak" : "Streak claimed today"}
      className="gametab relative flex shrink-0 items-center gap-1"
      style={open ? { borderColor: "#ff8a1f", color: "#ffb35c" } : undefined}
    >
      <Flame size={14} lit={(streak.current ?? 0) > 0} />
      <span className="tabular">{streak.current ?? 0}</span>
      {open && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-[#ff8a1f]" />}
    </Link>
  );
}
