import { NextResponse } from "next/server";
import { assetCtx, sigmaWad } from "@/lib/hyperliquid";
import { ASSET } from "@/lib/elysium";

/**
 * A light price feed for the new site: Hyperliquid's mark, the 24h change and
 * the vault's own volatility (annualised). Deliberately separate from
 * /api/state, which wakes the keeper out of idle mode; browsing the home page
 * should not burn keeper gas.
 */
export const dynamic = "force-dynamic";

let px: { at: number; mark: number; oracle: number; prevDay: number } | null = null;
let vol: { at: number; sigma: number } | null = null;

export async function GET() {
  try {
    if (!px || Date.now() - px.at > 2_000) px = { at: Date.now(), ...(await assetCtx(ASSET)) };
    if (!vol || Date.now() - vol.at > 600_000) {
      const perRootSecond = Number(await sigmaWad(ASSET)) / 1e18;
      vol = { at: Date.now(), sigma: perRootSecond * Math.sqrt(365 * 86_400) };
    }
    return NextResponse.json({
      asset: ASSET,
      price: px.mark,
      oracle: px.oracle,
      change24h: px.prevDay ? (px.mark - px.prevDay) / px.prevDay : 0,
      sigma: vol.sigma,
      at: px.at,
    });
  } catch (err) {
    if (px && vol) return NextResponse.json({ asset: ASSET, price: px.mark, oracle: px.oracle, change24h: (px.mark - px.prevDay) / px.prevDay, sigma: vol.sigma, at: px.at, stale: true });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
