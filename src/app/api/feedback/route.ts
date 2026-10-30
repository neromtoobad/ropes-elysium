import { NextResponse } from "next/server";
import { createPost, isAdmin, listPosts, moderate, toggleVote } from "@/lib/feedback";

export const dynamic = "force-dynamic";

/**
 * The feedback board, one route. POST throughout because the player key rides
 * along (it is a credential — see /api/ledger):
 *
 *   {action:"list", playerKey?, admin?}          the board
 *   {action:"post", playerKey, kind, title, body}
 *   {action:"vote", playerKey, id}               toggles
 *   {action:"moderate", admin, id, status?, teamNote?, hidden?, award?, reason?}
 */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  const key = typeof b.playerKey === "string" && b.playerKey ? b.playerKey : null;
  const fail = (err: unknown, status = 400) => NextResponse.json({ error: String(err).replace("Error: ", "") }, { status });

  try {
    switch (b.action) {
      case "list": {
        const admin = isAdmin(b.admin);
        return NextResponse.json({ admin, posts: await listPosts(key, admin) });
      }
      case "post":
        if (!key) return fail("no player key", 401);
        return NextResponse.json({ id: await createPost(key, b) });
      case "vote":
        if (!key) return fail("no player key", 401);
        return NextResponse.json({ voted: await toggleVote(key, String(b.id)) });
      case "moderate":
        if (!isAdmin(b.admin)) return fail("not the team", 403);
        await moderate(String(b.id), b);
        return NextResponse.json({ ok: true });
      default:
        return fail("unknown action");
    }
  } catch (err) {
    return fail(err);
  }
}
