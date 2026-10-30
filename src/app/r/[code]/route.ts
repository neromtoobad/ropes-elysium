import { NextResponse } from "next/server";

/** playropes.xyz/r/<code> — the invite link. Lands on the home page with the
 *  code in the query, where InviteCatcher picks it up. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL("/", req.url);
  url.searchParams.set("ref", code.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase());
  return NextResponse.redirect(url, 307);
}
