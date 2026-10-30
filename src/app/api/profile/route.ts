import { NextResponse } from "next/server";
import { setHandle, walletOf } from "@/lib/climber";

/** Claim or clear an X handle for the boards. Ranked wallets only. */
export async function POST(req: Request) {
  const { playerKey, handle } = await req.json().catch(() => ({}));
  const wallet = await walletOf(playerKey);
  if (!wallet) return NextResponse.json({ error: "connect a wallet and take a ranked seat first" }, { status: 403 });
  try {
    return NextResponse.json({ handle: await setHandle(wallet, String(handle ?? "")) });
  } catch (err) {
    return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 400 });
  }
}
