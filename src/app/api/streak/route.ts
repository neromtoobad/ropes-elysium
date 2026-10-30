import { NextResponse } from "next/server";
import { walletOf } from "@/lib/climber";
import { invalidatePoints } from "@/lib/points";
import { claim, daysOf, standing, STREAK } from "@/lib/streak";

export const dynamic = "force-dynamic";

/**
 * The daily streak. {playerKey} reads it; {playerKey, claim:true} checks in
 * for today (UTC) and returns the new standing. POST because the player key
 * is a credential (see /api/ledger).
 */
export async function POST(req: Request) {
  const { playerKey, claim: doClaim } = await req.json().catch(() => ({}));
  const wallet = await walletOf(playerKey);
  if (!wallet) return NextResponse.json({ wallet: null, rules: STREAK });
  let claimed = false;
  if (doClaim) {
    await claim(wallet);
    invalidatePoints();
    claimed = true;
  }
  const s = standing(await daysOf(wallet));
  return NextResponse.json({
    wallet,
    rules: STREAK,
    claimed,
    ...s,
    // The last two weeks only: enough for the strip, not the whole history.
    history: s.history.slice(-14),
  });
}
