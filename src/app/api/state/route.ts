import { NextResponse } from "next/server";
import { getTableState } from "@/lib/state";
import { db } from "@/lib/db";

/** Touch the viewer heartbeat at most every 20s per server, never blocking the read. */
let beatAt = 0;
function beat() {
  if (Date.now() - beatAt < 20_000) return;
  beatAt = Date.now();
  const at = new Date();
  db.heartbeat.upsert({ where: { id: "viewer" }, create: { id: "viewer", at }, update: { at } }).catch(() => {});
}

export const dynamic = "force-dynamic";

export async function GET() {
  beat();
  try {
    return NextResponse.json(await getTableState());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
