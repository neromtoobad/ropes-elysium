import { NextResponse } from "next/server";
import { getPoints, LEAGUES, RULES, SEASON } from "@/lib/points";
import { TROPHIES } from "@/lib/trophies";

export const dynamic = "force-dynamic";

/** The season table: top 100, the rules it was scored by, the leagues, and
 *  the trophy catalogue with how rare each tier is. */
export async function GET() {
  const { at, rows, rarity } = await getPoints();
  return NextResponse.json({
    season: SEASON,
    at,
    rules: RULES,
    leagues: LEAGUES,
    trophies: TROPHIES.map((t) => ({ ...t, rarity: rarity[t.id] })),
    total: rows.length,
    rows: rows.slice(0, 100),
  });
}
