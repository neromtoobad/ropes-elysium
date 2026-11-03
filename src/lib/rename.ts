/**
 * Changing your name. A name used to be fixed by the first seat, with no way
 * to change it after.
 *
 * A wallet is one climber on the boards, but each browser is its own player
 * row (see lib/boards), so a rename reaches every row on the same wallet.
 * Names are unique, ignoring case, so nobody can borrow a leader's name.
 */
import { db } from "./db";
import { isPlaceholderName, shownName } from "./names";
import { invalidatePoints } from "./points";

/** The seat shows 12 characters. */
export const NAME_RE = /^[A-Za-z0-9_]{2,12}$/;
const RESERVED = ["ropes", "playropes", "house", "admin", "team", "elysium", "kinetiq"];

export async function rename(playerKey: unknown, raw: unknown): Promise<string> {
  if (typeof playerKey !== "string" || !playerKey) throw new Error("take a seat first");
  const name = String(raw ?? "").trim();
  if (!NAME_RE.test(name)) throw new Error("a name is 2–12 letters, numbers or underscores");
  if (isPlaceholderName(name) || RESERVED.includes(name.toLowerCase())) throw new Error("pick another name");

  const me = await db.player.findUnique({ where: { wallet: playerKey }, select: { id: true, address: true, displayName: true } });
  if (!me) throw new Error("take a seat first");
  if (me.displayName === name) return name;

  const mine = me.address
    ? await db.player.findMany({ where: { address: { equals: me.address, mode: "insensitive" } }, select: { id: true } })
    : [{ id: me.id }];
  const ids = [...new Set([me.id, ...mine.map((p) => p.id)])];

  const taken = await db.player.findFirst({
    where: { displayName: { equals: name, mode: "insensitive" }, id: { notIn: ids } },
    select: { id: true },
  });
  if (taken) throw new Error(`${name} is taken`);

  await db.player.updateMany({ where: { id: { in: ids } }, data: { displayName: name } });
  invalidatePoints();
  return name;
}

/** The name this player key shows today, or null for a key with no seat yet. */
export async function nameOf(playerKey: unknown) {
  if (typeof playerKey !== "string" || !playerKey) return null;
  const p = await db.player.findUnique({ where: { wallet: playerKey }, select: { id: true, displayName: true } });
  return p ? shownName(p) : null;
}
