import { NextResponse } from "next/server";
import { rename } from "@/lib/rename";

/** Change your name: 2–12 letters, numbers or underscores, not someone else's. */
export async function POST(req: Request) {
  const { playerKey, name } = await req.json().catch(() => ({}));
  try {
    return NextResponse.json({ name: await rename(playerKey, name) });
  } catch (err) {
    return NextResponse.json({ error: String(err).replace("Error: ", "") }, { status: 400 });
  }
}
