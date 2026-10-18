/**
 * Audit the relay: is every strike and every close RopeMarket settled on
 * exactly the price Hyperliquid itself published?
 *
 *   npx tsx scripts/audit.ts [fromBlock] [fromRound]
 *
 * The keeper is trusted to carry Hyperliquid prices onto Elysium until the
 * HyperCore read precompile ships. This is how that trust is checked rather
 * than assumed. A round is struck at the OPEN of Hyperliquid's one-minute
 * candle for its first minute, and settled at the open of the candle that
 * starts at its bell. Both are permanent public Hyperliquid numbers, so for
 * every round this takes the on-chain strike (RoundOpened) and close
 * (RoundSettled) and checks each EQUALS the candle open from Hyperliquid's
 * own candleSnapshot. A relay that invented, rounded or delayed a price fails.
 *
 * (Rounds before the candle-open rule were struck at a book mid, which no
 * public dataset can confirm exactly; pass fromRound to start after them.)
 */
import "dotenv/config";
import { parseAbiItem } from "viem";
import { publicClient, MARKET, ASSET } from "../src/lib/chain";
import { candles, toE8 } from "../src/lib/hyperliquid";

const from = BigInt(process.argv[2] ?? "0");
const fromRound = Number(process.argv[3] ?? "0");
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

const opens = (await logs(opened, from)).filter((o) => Number(o.args.roundId) >= fromRound);
const closes = await logs(settled, from);
console.log(`${opens.length} rounds opened, ${closes.length} settled on ${MARKET} (${ASSET})`);
if (!opens.length) process.exit(0);

const firstMs = Number(opens[0].args.opensAt) * 1000 - 60_000;
const lastMs = Number(opens[opens.length - 1].args.expiresAt) * 1000 + 120_000;
// Hyperliquid serves at most ~5000 candles per call; fetch in day-sized chunks.
const book = new Map<number, string>();
for (let a = firstMs; a < lastMs; a += 24 * 3600_000) {
  for (const c of await candles(ASSET, a, Math.min(a + 24 * 3600_000, lastMs))) book.set(c.t, c.o);
}

const closeOf = new Map(closes.map((c) => [String(c.args.roundId), c.args]));
let ok = 0;
let bad = 0;
let voids = 0;

function check(label: string, priceE8: bigint, minuteMs: number) {
  const o = book.get(minuteMs);
  if (!o) return console.log(`  ? ${label}: no Hyperliquid candle for that minute`);
  const want = toE8(o);
  if (priceE8 === want) ok++;
  else {
    bad++;
    console.log(`  ✗ ${label} ${Number(priceE8) / 1e8} ≠ Hyperliquid's candle open ${o}`);
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

console.log(`\n${ok} of ${ok + bad} strikes and closes EXACTLY equal Hyperliquid's published candle open; ${voids} voided rounds (refunded).`);
process.exit(bad ? 1 : 0);
