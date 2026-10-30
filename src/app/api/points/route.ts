import { NextResponse } from "next/server";
import { getPoints, LEAGUES, RULES, SEASON } from "@/lib/points";

export const dynamic = "force-dynamic";

/** The season table: top 100, the rules it was scored by, and the leagues. */
export async function GET() {
  const { at, rows } = await getPoints();
  return NextResponse.json({ season: SEASON, at, rules: RULES, leagues: LEAGUES, total: rows.length, rows: rows.slice(0, 100) });
}
