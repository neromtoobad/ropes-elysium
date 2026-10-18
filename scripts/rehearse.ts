/**
 * One full round against RopeMarket, through the SAME adapter code the
 * executor runs — no database, no game rules, just the money path:
 *
 *   strike at the open → buy UP → bail half mid-round → settle at the bell → redeem
 *
 *   npx tsx scripts/rehearse.ts            (env: NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_MARKET, …)
 *
 * Prints every transaction hash and the numbers the contract reported, so a
 * run doubles as evidence.
 */
import "dotenv/config";
import { currentMarket, settlement, liveQuote } from "../src/lib/market";
import { buy, sellPosition, redeemAll } from "../src/lib/orders";
import { ONE, fmtUsd, fmtProb, sleep, houseCollateral, ASSET } from "../src/lib/chain";

const t = () => new Date().toISOString().slice(11, 19);

async function main() {
  console.log(`${t()} waiting for the top of a minute to strike a ${ASSET} round…`);
  let market = null;
  while (!market) {
    market = await currentMarket(20);
    if (!market) await sleep(1000);
  }
  console.log(`${t()} round #${market.onchain.roundId} struck at ${market.strike}  quote yesBid ${fmtProb(market.yesBid!)} yesAsk ${fmtProb(market.yesAsk!)}`);

  const start = await houseCollateral();
  const fill = await buy(market, "UP", 10n * ONE);
  console.log(`${t()} BUY UP   ${fmtUsd(fill.contracts)} shares @ ${fmtProb(fill.priceRaw)} for ${fmtUsd(fill.cost)}  tx ${fill.tx}`);

  await sleep(15_000);
  const q = await liveQuote(market.strike, market.expiresAt.getTime() / 1000);
  console.log(`${t()} live: mark ${q?.mark} vs line ${market.strike}  fair(UP) ${q ? fmtProb(q.fair) : "-"}`);
  const sale = await sellPosition(market, "UP", fill.contracts / 2n);
  console.log(`${t()} BAIL ½   sold ${fmtUsd(sale.sold)} shares for ${fmtUsd(sale.proceeds)}  tx ${sale.tx}`);

  const bell = market.expiresAt.getTime();
  while (Date.now() < bell) await sleep(250);
  let s = await settlement(market.marketId);
  while (!s.settled) {
    await sleep(700);
    s = await settlement(market.marketId);
  }
  console.log(`${t()} SETTLED  close ${s.close} vs strike ${s.strike} → ${s.voided ? "VOID" : s.winningOutcome === 0 ? "UP" : "DOWN"} wins`);

  const r = await redeemAll(market.marketId, s.onchain, s.voided, s.winningOutcome);
  console.log(`${t()} REDEEM   ${fmtUsd(r.redeemed)}  tx ${r.txs[0] ?? "(nothing held on the winning side)"}`);
  const end = await houseCollateral();
  console.log(`${t()} net for the round: ${end >= start ? "+" : "−"}${fmtUsd(end >= start ? end - start : start - end)} tUSDC`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
