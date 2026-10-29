import { NextResponse } from "next/server";
import { getBoards } from "@/lib/boards";

/** The ranked boards: this week's Summit (net) and Longest Climb, plus all-time ranked. */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getBoards());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
