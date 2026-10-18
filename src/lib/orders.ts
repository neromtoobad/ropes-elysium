/**
 * Placing, selling and redeeming against RopeMarket.
 *
 * Every write carries the freshest Hyperliquid mark the executor has, so a
 * fill is always priced at the mark of the moment it lands — never at a mark
 * relayed earlier. The amounts recorded are the ones the contract's own
 * `Traded`/`Redeemed` events report: the chain's truth, not what we asked for.
 */
import { parseEventLogs, erc20Abi, maxUint256 } from "viem";
import { publicClient, wallet, ONE, HOUSE, MARKET, COLLATERAL, ASSET } from "./chain";
import { revertName, type LiveMarket, type Onchain } from "./market";
import { ropeAbi } from "./ropeAbi";
import { readMark } from "./hyperliquid";

/**
 * Refuse to enter above this probability. At 0.99 a player risks their whole
 * stack for a 1% gain — strictly bad, and it happens often on a 1m window that
 * has already made its mind up. Sitting the round out preserves the stack.
 */
export const MAX_ENTRY_PRICE_PCT = 90n;

export type Side = "UP" | "DOWN";

export interface Fill {
  contracts: bigint;
  cost: bigint;
  /** Price actually paid per share, raw. 0 when nothing filled. */
  priceRaw: bigint;
  tx?: string;
  /** Set when we declined the entry because the side was above the price cap. */
  tooExpensive?: boolean;
}

const sideIdx = (s: Side) => (s === "UP" ? 0 : 1);
const log = (...a: unknown[]) => console.log("      orders", ...a);

let approved = false;
/** The market pulls stakes from the house wallet; approve it once. */
export async function ensureApproval() {
  if (approved) return;
  const allowance = await publicClient.readContract({
    address: COLLATERAL, abi: erc20Abi, functionName: "allowance", args: [HOUSE, MARKET],
  });
  if (allowance < 10n ** 30n) {
    const hash = await wallet().writeContract({
      address: COLLATERAL, abi: erc20Abi, functionName: "approve", args: [MARKET, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`approved the market to pull stakes  tx ${hash.slice(0, 10)}…`);
  }
  approved = true;
}

/**
 * Spend `budget` on `side`. Shares = budget / price, so a winning position
 * redeems at budget/price — the 1/p growth the whole game is built on.
 *
 * A quote above the entry cap, or a round already at its risk cap, returns a
 * zero fill rather than throwing; the caller decides whether that sits the
 * group out.
 */
export async function buy(market: LiveMarket, side: Side, budget: bigint): Promise<Fill> {
  await ensureApproval();
  const m = await readMark(ASSET);
  const maxPrice = (ONE * MAX_ENTRY_PRICE_PCT) / 100n;
  try {
    const hash = await wallet().writeContract({
      address: MARKET,
      abi: ropeAbi,
      functionName: "buy",
      args: [market.onchain.roundId, sideIdx(side), budget, maxPrice, m.raw, m.sourceMs],
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") return { contracts: 0n, cost: 0n, priceRaw: 0n, tx: hash };
    const [ev] = parseEventLogs({ abi: ropeAbi, logs: rc.logs, eventName: "Traded" });
    if (!ev) return { contracts: 0n, cost: 0n, priceRaw: 0n, tx: hash };
    return { contracts: ev.args.shares, cost: ev.args.amount, priceRaw: ev.args.price, tx: hash };
  } catch (err) {
    const why = revertName(err);
    if (why?.startsWith("PriceLimit")) {
      const price = BigInt(why.slice(11, -1) || "0");
      return { contracts: 0n, cost: 0n, priceRaw: price, tooExpensive: true };
    }
    if (why === "OverCap()" || why === "BuyLocked()" || why === "StaleMark()") {
      log(`buy ${side} refused: ${why}`);
      return { contracts: 0n, cost: 0n, priceRaw: 0n };
    }
    throw err;
  }
}

/**
 * Sell a held position back at the live bid — the money behind BAIL.
 *
 * A bail is an exit, not a negotiation: no floor price. The market always
 * quotes, so there is always a bid; it is fair value at the mark of this very
 * transaction, minus half the spread.
 */
export async function sellPosition(
  market: LiveMarket,
  side: Side,
  contracts: bigint,
): Promise<{ sold: bigint; proceeds: bigint; tx?: string }> {
  const m = await readMark(ASSET);
  try {
    const hash = await wallet().writeContract({
      address: MARKET,
      abi: ropeAbi,
      functionName: "sell",
      args: [market.onchain.roundId, sideIdx(side), contracts, 0n, m.raw, m.sourceMs],
    });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") return { sold: 0n, proceeds: 0n };
    const [ev] = parseEventLogs({ abi: ropeAbi, logs: rc.logs, eventName: "Traded" });
    return { sold: ev?.args.shares ?? 0n, proceeds: ev?.args.amount ?? 0n, tx: hash };
  } catch (err) {
    const why = revertName(err);
    // The bell beat us to it; settlement resolves the player instead.
    if (why === "TooLate()" || why === "NotTrading()" || why === "NothingToSell()") return { sold: 0n, proceeds: 0n };
    throw err;
  }
}

/**
 * Redeem everything the house holds in a settled round, in ONE transaction.
 * A win pays 1 per share, a void 0.5 per share per side. Attribution back to
 * individual runs is the ledger's job.
 */
export async function redeemAll(
  _marketId: `0x${string}`,
  oc: Onchain,
  voided: boolean,
  winningOutcome: 0 | 1 | null,
): Promise<{ redeemed: bigint; txs: string[] }> {
  const [up, down] = await publicClient.readContract({
    address: MARKET, abi: ropeAbi, functionName: "sharesOf", args: [oc.roundId, HOUSE],
  });
  // Only losing shares (or none): a redeem would succeed and pay nothing. Skip the gas.
  const payable = voided ? up + down : winningOutcome === 0 ? up : winningOutcome === 1 ? down : 0n;
  if (payable === 0n) return { redeemed: 0n, txs: [] };
  const hash = await wallet().writeContract({
    address: MARKET, abi: ropeAbi, functionName: "redeem", args: [oc.roundId],
  });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`redeem reverted ${hash}`);
  const [ev] = parseEventLogs({ abi: ropeAbi, logs: rc.logs, eventName: "Redeemed" });
  return { redeemed: ev?.args.amount ?? 0n, txs: [hash] };
}
