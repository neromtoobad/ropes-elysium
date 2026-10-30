import { NextResponse } from "next/server";
import { getPoints, leagueOf } from "@/lib/points";
import { ensureClimber, walletOf } from "@/lib/climber";

export const dynamic = "force-dynamic";

/** One climber's card: points, league, rank, handle and invite link. POST
 *  because the player key is a credential (see /api/ledger). */
export async function POST(req: Request) {
  const { playerKey } = await req.json().catch(() => ({ playerKey: null }));
  const wallet = await walletOf(playerKey);
  if (!wallet) return NextResponse.json({ wallet: null });

  const [c, { rows, fromInvites, invitedCount, trophies }] = await Promise.all([ensureClimber(wallet), getPoints()]);
  const row = rows.find((r) => r.wallet === wallet) ?? null;
  const points = row?.points ?? 0;
  const league = leagueOf(points);
  return NextResponse.json({
    wallet,
    handle: c.handle,
    inviteCode: c.inviteCode,
    invitedBy: Boolean(c.referredBy),
    points,
    day: row?.day ?? 0,
    rank: row?.rank ?? null,
    prevRank: row?.prevRank ?? null,
    of: rows.length,
    league: { name: league.name, min: league.min, next: league.next },
    invited: invitedCount.get(wallet) ?? 0,
    fromInvites: Math.round(fromInvites.get(wallet) ?? 0),
    trophies: trophies.get(wallet) ?? [],
  });
}
