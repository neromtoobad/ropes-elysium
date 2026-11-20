import { NextResponse } from "next/server";
import { candles } from "@/lib/hyperliquid";
import { ASSET } from "@/lib/elysium";

/** The last two hours of Hyperliquid one-minute closes, for the trade chart. Cached 20 s. */
export const dynamic = "force-dynamic";

let cache: { at: number; data: { t: number; c: number }[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > 20_000) {
      const end = Date.now();
      const rows = await candles(ASSET, end - 120 * 60_000, end);
      cache = { at: end, data: rows.map((r) => ({ t: r.t, c: Number(r.c) })) };
    }
    return NextResponse.json({ asset: ASSET, candles: cache.data });
  } catch (err) {
    if (cache) return NextResponse.json({ asset: ASSET, candles: cache.data, stale: true });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
