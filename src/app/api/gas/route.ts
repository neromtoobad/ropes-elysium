import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { drip, faucetStatus } from "@/lib/faucet";

/** Testnet HYPE for gas, from the team's reservoir. GET: is it open, and the
 *  address to top it up. POST { address }: one drip to a wallet with none. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await faucetStatus());
}

export async function POST(req: Request) {
  const { address } = await req.json().catch(() => ({}));
  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "connect a wallet first" }, { status: 400 });
  }
  const r = await drip(address);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, tx: r.tx });
}
