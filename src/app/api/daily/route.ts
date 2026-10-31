import { NextResponse } from "next/server";
import { getDaily } from "@/lib/daily";

/** Today's Daily Climb board: every player's first run of the UTC day. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const d = await getDaily();
    return NextResponse.json({ ...d, rows: d.rows.slice(0, 50) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
