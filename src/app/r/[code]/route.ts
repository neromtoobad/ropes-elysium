import { NextResponse } from "next/server";

/** playropes.xyz/r/<code> — the invite link. Lands on the home page with the
 *  code in the query, where InviteCatcher picks it up.
 *
 *  The Location is RELATIVE on purpose: behind Railway's proxy req.url is the
 *  container's own address (localhost:8080), and an absolute redirect built
 *  from it sent every invite to a page that does not exist. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ref = code.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
  return new NextResponse(null, { status: 307, headers: { Location: `/?ref=${ref}` } });
}
