/**
 * The feedback board.
 *
 * Posting is open to anyone holding a player key — the most useful bug report
 * is often "the deposit didn't work", from someone who therefore has no
 * wallet pinned yet. Earning points is not: a grant lands on a wallet, so it
 * goes to posts made from a key that had one.
 *
 * Player keys are credentials (see /api/ledger), so this table only ever
 * holds their sha256. That is enough to rate-limit, dedupe votes and say
 * "this one is yours" without the key itself ever being stored or served.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { invalidatePoints } from "./points";

export const KINDS = ["bug", "idea", "general"] as const;
export const STATUSES = ["open", "confirmed", "planned", "shipped", "closed"] as const;
export type Kind = (typeof KINDS)[number];

/** Posts per key per rolling 24 hours. A board, not a chat. */
export const POSTS_PER_DAY = 3;
export const TITLE = { min: 4, max: 80 };
export const BODY = { min: 10, max: 1500 };

export const keyHash = (playerKey: string) => createHash("sha256").update(`ropes.feedback:${playerKey}`).digest("hex");

/** The team's key for status, replies and grants. Unset = nobody is admin. */
export function isAdmin(token: unknown) {
  const want = process.env.ADMIN_TOKEN;
  if (!want || typeof token !== "string" || token.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(want));
}

export type Post = {
  id: string;
  kind: string;
  title: string;
  body: string;
  author: string;
  status: string;
  teamNote: string | null;
  pointsAwarded: number;
  votes: number;
  voted: boolean;
  mine: boolean;
  hidden: boolean;
  at: string;
};

export async function listPosts(playerKey: string | null, admin = false): Promise<Post[]> {
  const me = playerKey ? keyHash(playerKey) : null;
  const posts = await db.feedback.findMany({
    where: admin ? {} : { hidden: false },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const mine = me
    ? new Set((await db.feedbackVote.findMany({ where: { voterKey: me, feedbackId: { in: posts.map((p) => p.id) } }, select: { feedbackId: true } })).map((v) => v.feedbackId))
    : new Set<string>();
  return posts.map((p) => ({
    id: p.id,
    kind: p.kind,
    title: p.title,
    body: p.body,
    author: p.authorName,
    status: p.status,
    teamNote: p.teamNote,
    pointsAwarded: p.pointsAwarded,
    votes: p.votes,
    voted: mine.has(p.id),
    mine: me !== null && p.authorKey === me,
    hidden: p.hidden,
    at: p.createdAt.toISOString(),
  }));
}

export async function createPost(playerKey: string, input: { kind: unknown; title: unknown; body: unknown }) {
  const kind = String(input.kind) as Kind;
  if (!KINDS.includes(kind)) throw new Error("pick bug, idea or general");
  const title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  const body = String(input.body ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (title.length < TITLE.min || title.length > TITLE.max) throw new Error(`a title is ${TITLE.min}–${TITLE.max} characters`);
  if (body.length < BODY.min || body.length > BODY.max) throw new Error(`the details are ${BODY.min}–${BODY.max} characters`);

  const authorKey = keyHash(playerKey);
  const recent = await db.feedback.count({ where: { authorKey, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (recent >= POSTS_PER_DAY) throw new Error(`that's ${POSTS_PER_DAY} posts in 24 hours — add to one of yours instead`);

  const player = await db.player.findUnique({ where: { wallet: playerKey }, select: { displayName: true, address: true } });
  const wallet = player?.address?.toLowerCase() ?? null;
  const climber = wallet ? await db.climber.findUnique({ where: { address: wallet }, select: { handle: true } }).catch(() => null) : null;
  const authorName = climber?.handle ? `@${climber.handle}` : player?.displayName ?? "guest";

  const p = await db.feedback.create({ data: { kind, title, body, authorKey, authorWallet: wallet, authorName } });
  return p.id;
}

/** Toggle this key's vote. Votes are free and need no wallet; one per key. */
export async function toggleVote(playerKey: string, id: string) {
  const voterKey = keyHash(playerKey);
  const post = await db.feedback.findUnique({ where: { id }, select: { hidden: true } });
  if (!post || post.hidden) throw new Error("no such post");
  const had = await db.feedbackVote.findUnique({ where: { feedbackId_voterKey: { feedbackId: id, voterKey } } });
  if (had) {
    await db.$transaction([
      db.feedbackVote.delete({ where: { feedbackId_voterKey: { feedbackId: id, voterKey } } }),
      db.feedback.update({ where: { id }, data: { votes: { decrement: 1 } } }),
    ]);
    return false;
  }
  try {
    await db.$transaction([
      db.feedbackVote.create({ data: { feedbackId: id, voterKey } }),
      db.feedback.update({ where: { id }, data: { votes: { increment: 1 } } }),
    ]);
  } catch {
    /* a double-click raced itself; the first vote stands */
  }
  return true;
}

/** The team's controls: status, public reply, hide, and a points grant. */
export async function moderate(id: string, change: { status?: unknown; teamNote?: unknown; hidden?: unknown; award?: unknown; reason?: unknown }) {
  const post = await db.feedback.findUnique({ where: { id } });
  if (!post) throw new Error("no such post");
  const data: { status?: string; teamNote?: string | null; hidden?: boolean; pointsAwarded?: number } = {};
  if (change.status !== undefined) {
    if (!STATUSES.includes(change.status as (typeof STATUSES)[number])) throw new Error("bad status");
    data.status = String(change.status);
  }
  if (change.teamNote !== undefined) data.teamNote = String(change.teamNote).trim().slice(0, 1000) || null;
  if (change.hidden !== undefined) data.hidden = Boolean(change.hidden);

  const award = Math.round(Number(change.award ?? 0));
  if (award) {
    if (!post.authorWallet) throw new Error("this post has no wallet behind it, so there is nowhere for points to land");
    if (award < 0 || award > 1000) throw new Error("a grant is 1–1000 points");
    await db.pointGrant.create({
      data: { address: post.authorWallet, points: award, reason: `feedback:${id}${change.reason ? ` ${String(change.reason).slice(0, 80)}` : ""}` },
    });
    data.pointsAwarded = post.pointsAwarded + award;
    invalidatePoints();
  }
  await db.feedback.update({ where: { id }, data });
}
