/**
 * Seat a bot, let it ride, and BAIL it a few seconds before the bell — the
 * moment a player most wants out. Proves the sale lands on-chain at the live
 * bid even that late.   npx tsx scripts/late-bail.ts [secondsBeforeBell=8]
 */
import "dotenv/config";
import { db, joinGame } from "../src/executor/game";

const before = Number(process.argv[2] ?? 8);
const name = `late${Math.floor(Math.random() * 900 + 100)}`;
const cur = await db.round.findFirst({ orderBy: { index: "desc" } });
const run = await joinGame(`0x${Date.now().toString(16).padStart(40, "0")}`, name, 0n, cur?.index ?? 0, "UP");
console.log(`seated ${name} (UP)`);
// Wait for it to hold a position in some round, then bail `before`s before that bell.
for (;;) {
  const pos = await db.position.findFirst({ where: { runId: run.id, outcome: null }, include: { round: true } });
  if (pos) {
    const fireAt = pos.round.expiresAt.getTime() - before * 1000;
    console.log(`holding ${pos.contracts} @ ${pos.priceRaw} in round ${pos.round.index}; bailing at T-${before}s`);
    while (Date.now() < fireAt) await new Promise((r) => setTimeout(r, 200));
    await db.run.update({ where: { id: run.id }, data: { bailRequested: true } });
    console.log(`${new Date().toISOString().slice(11, 19)} bail flag raised`);
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await db.$disconnect();
