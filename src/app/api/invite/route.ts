import { NextResponse } from "next/server";
import { claimInvite, walletOf } from "@/lib/climber";

/**
 * Attach a new wallet to the invite it arrived on. The browser keeps the
 * code from the link and calls this until it gets a final answer: `pending`
 * means there is no wallet behind this player key yet (no deposit), so try
 * again later; anything else means stop.
 */
export async function POST(req: Request) {
  const { playerKey, code } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || !code) return NextResponse.json({ ok: false, reason: "no code" });
  const wallet = await walletOf(playerKey);
  if (!wallet) return NextResponse.json({ ok: false, pending: true });
  return NextResponse.json(await claimInvite(wallet, code));
}
