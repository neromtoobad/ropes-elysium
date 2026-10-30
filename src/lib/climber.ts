/**
 * The climber behind a wallet: handle and invite link.
 *
 * Every write here is keyed off a player key whose wallet was pinned by a
 * verified deposit (lib/payments) — the browser never gets to name an
 * address. No wallet yet, no climber: points, handles and invites are all
 * ranked-only, and ranked starts with a deposit.
 */
import { randomInt } from "node:crypto";
import { db } from "./db";
import { invalidatePoints } from "./points";

/** No 0/O, 1/I/L: a code read off a screenshot should survive the reading. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** An invite may be claimed while the wallet is this new, and not after:
 *  otherwise any two old players could tag each other for a free 10%. */
export const INVITE_WINDOW_SEATS = 3;

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** The wallet a player key is allowed to speak for, or null. */
export async function walletOf(playerKey: unknown) {
  if (typeof playerKey !== "string" || !playerKey) return null;
  const p = await db.player.findUnique({ where: { wallet: playerKey }, select: { address: true } });
  return p?.address?.toLowerCase() ?? null;
}

export async function ensureClimber(address: string) {
  const a = address.toLowerCase();
  const existing = await db.climber.findUnique({ where: { address: a } });
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    try {
      return await db.climber.create({ data: { address: a, inviteCode: newCode() } });
    } catch (err) {
      // Either the code collided (try another) or a parallel request created
      // this climber first (return theirs).
      const raced = await db.climber.findUnique({ where: { address: a } });
      if (raced) return raced;
      if (i === 4) throw err;
    }
  }
  throw new Error("could not mint an invite code");
}

/** Claim, change or clear (empty string) the X handle. Self-claimed. */
export async function setHandle(address: string, raw: string) {
  const handle = raw.trim().replace(/^@/, "");
  if (handle && !HANDLE_RE.test(handle)) throw new Error("an X handle is 1–15 letters, numbers or underscores");
  const c = await ensureClimber(address);
  const lower = handle.toLowerCase() || null;
  if (lower) {
    const owner = await db.climber.findUnique({ where: { handle: lower }, select: { address: true } });
    if (owner && owner.address !== c.address) throw new Error(`@${lower} is already on another wallet`);
  }
  await db.climber.update({ where: { address: c.address }, data: { handle: lower } });
  invalidatePoints();
  return lower;
}

/** Attach this wallet to the wallet whose invite it arrived on. Once, early,
 *  never to yourself. Returns why not, so the browser can stop retrying. */
export async function claimInvite(address: string, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  const inviter = await db.climber.findUnique({ where: { inviteCode: code } });
  if (!inviter) return { ok: false, reason: "no such invite" } as const;
  const me = await ensureClimber(address);
  if (me.referredBy) return { ok: false, reason: "already invited" } as const;
  if (inviter.address === me.address) return { ok: false, reason: "that's your own invite" } as const;
  // A two-wallet loop would pay each side for the other. Refuse the second leg.
  if (inviter.referredBy === me.address) return { ok: false, reason: "you invited them" } as const;
  const seats = await db.run.count({ where: { payoutAddress: { equals: me.address, mode: "insensitive" } } });
  if (seats > INVITE_WINDOW_SEATS) return { ok: false, reason: "invites only count for new wallets" } as const;
  await db.climber.update({ where: { address: me.address }, data: { referredBy: inviter.address, referredAt: new Date() } });
  invalidatePoints();
  return { ok: true, inviter: inviter.handle ?? null } as const;
}
