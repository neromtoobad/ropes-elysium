/**
 * Audit the relay: does every strike and every close RopeMarket settled on
 * match what Hyperliquid itself printed at that moment?
 *
 *   npx tsx scripts/audit.ts [fromBlock]
 *
 * The keeper is trusted to carry the Hyperliquid mark onto Elysium until the
 * HyperCore read precompile ships. This is how that trust is checked rather
 * than assumed: for each round it takes the on-chain strike (RoundOpened) and
 * close (RoundSettled), finds the Hyperliquid one-minute candle covering the
 * moment each was sampled, and checks the price sits inside that candle's
 * low–high range. A relay that invented or delayed prices fails here.
 *
 * (Mid prices can sit a hair outside a TRADE candle's range in a quiet
 * minute, since a mid is not a trade — so the check allows one tick of slack
 * and reports the distance.)
 */
import "dotenv/config";
import { parseAbiItem } from "viem";
import { publicClient, MARKET, ASSET } from "../src/lib/chain";
import { candles } from "../src/lib/hyperliquid";

const from = BigInt(process.argv[2] ?? "0");
const opened = parseAbiItem("event RoundOpened(uint64 indexed roundId, uint64 opensAt, uint64 expiresAt, uint128 strike, uint128 cap)");
const settled = parseAbiItem("event RoundSettled(uint64 indexed roundId, uint128 close, uint8 winner, bool voided)");

async function logs<T>(event: T, fromBlock: bigint) {
  const head = await publicClient.getBlockNumber();
  const out: any[] = [];
  const STEP = 50_000n;
  for (let a = fromBlock; a <= head; a += STEP) {
    const b = a + STEP - 1n > head ? head : a + STEP - 1n;
    out.push(...(await publicClient.getLogs({ address: MARKET, event: event as any, fromBlock: a, toBlock: b })));
  }
  return out;
}

const opens = await logs(opened, from);
const closes = await logs(settled, from);
console.log(`${opens.length} rounds opened, ${closes.length} settled on ${MARKET} (${ASSET})`);
if (!opens.length) process.exit(0);

const firstMs = Number(opens[0].args.opensAt) * 1000 - 60_000;
const lastMs = Number(opens[opens.length - 1].args.expiresAt) * 1000 + 120_000;
// Hyperliquid serves at most ~5000 candles per call; fetch in day-sized chunks.
const book = new Map<number, { l: number; h: number }>();
for (let a = firstMs; a < lastMs; a += 24 * 3600_000) {
  for (const c of await candles(ASSET, a, Math.min(a + 24 * 3600_000, lastMs))) {
    book.set(c.t, { l: Number(c.l), h: Number(c.h) });
  }
}

const closeOf = new Map(closes.map((c) => [String(c.args.roundId), c.args]));
let ok = 0;
let bad = 0;
let voids = 0;
let worst = 0;

function check(label: string, priceE8: bigint, atMs: number) {
  const p = Number(priceE8) / 1e8;
  // The minute in which the sample was taken (strike: the open minute;
  // close: the minute starting at the bell).
  const c = book.get(Math.floor(atMs / 60_000) * 60_000);
  if (!c) return console.log(`  ? ${label} ${p}: no Hyperliquid candle`);
  const tick = p >= 1000 ? 0.1 : p >= 10 ? 0.001 : 0.00001;
  const off = p < c.l ? c.l - p : p > c.h ? p - c.h : 0;
  worst = Math.max(worst, off);
  if (off <= tick * 1.000001) ok++; // one tick, with room for float rounding
  else {
    bad++;
    console.log(`  ✗ ${label} ${p} outside the candle [${c.l}, ${c.h}] by ${off}`);
  }
}

for (const o of opens) {
  const id = String(o.args.roundId);
  check(`round ${id} strike`, o.args.strike, Number(o.args.opensAt) * 1000);
  const s = closeOf.get(id);
  if (!s) continue;
  if (s.voided) {
    voids++;
    continue;
  }
  check(`round ${id} close `, s.close, Number(o.args.expiresAt) * 1000);
}

console.log(`\n${ok} prices inside Hyperliquid's own candle, ${bad} outside, ${voids} voided rounds (refunded).`);
console.log(`largest distance outside a candle: ${worst}`);
process.exit(bad ? 1 : 0);
