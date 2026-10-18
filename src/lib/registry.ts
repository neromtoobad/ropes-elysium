/**
 * The executor's writes to the on-chain ArenaRegistry.
 *
 * The registry is a MIRROR, never the source of truth — the Postgres ledger is. So every
 * call here is best-effort: a failed registry write logs and returns false, and
 * the game carries on. Losing the public log is bad; stalling the table because
 * of it would be worse.
 *
 * These writes are deliberately awaited inside the game loop rather than
 * queued in the background. The executor signs everything — orders, opens,
 * settles and these — from one account with one nonce manager; a concurrent
 * writer here would race it and produce "nonce too low". One sequential
 * writer, no races — which is also why `enterMany` exists, so a round costs a
 * few transactions instead of one per player.
 */
import { keccak256, toHex, encodeFunctionData, parseAbi } from "viem";
import { publicClient, wallet } from "./chain";

const abi = parseAbi([
  "function openRound(address pool, uint64 nonce, bytes32 marketId) returns (bytes32)",
  "function enterMany(address pool, uint64 nonce, uint8 side, bytes32[] runIds, uint128[] contracts, uint128[] remainders, uint128[] stacksBefore)",
  "function bankRun(bytes32 runId, uint128 finalStack)",
  "function rounds(bytes32) view returns (bytes32 marketId, uint64 nonce, bool open, bool settled, bool voided, uint8 winner)",
  "function roundKey(address pool, uint64 nonce) view returns (bytes32)",
]);

const ADDRESS = (process.env.REGISTRY ?? "").trim() as `0x${string}`;
/** The registry is optional: with REGISTRY unset the game runs exactly as before. */
export const enabled = Boolean(ADDRESS);


/** Our run ids are cuids; the contract keys by bytes32. */
export const runKey = (runId: string) => keccak256(toHex(runId));

const log = (...a: unknown[]) => console.log("      registry", ...a);

async function send(fn: string, args: readonly unknown[]): Promise<boolean> {
  if (!enabled) return false;
  try {
    const hash = await wallet().sendTransaction({
      to: ADDRESS,
      data: encodeFunctionData({ abi, functionName: fn as never, args: args as never }),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      log(`${fn} reverted`, hash);
      return false;
    }
    return true;
  } catch (err) {
    // Never let the mirror stall the game.
    log(`${fn} failed:`, String(err).slice(0, 140));
    return false;
  }
}

export async function openRound(pool: `0x${string}`, nonce: bigint, marketId: `0x${string}`) {
  if (!enabled) return false;
  return send("openRound", [pool, nonce, marketId]);
}

export interface EntryRow {
  runId: string;
  contracts: bigint;
  remainder: bigint;
  stackBefore: bigint;
}

/** One transaction for a whole side, matching how orders are already batched. */
export async function enterMany(
  pool: `0x${string}`,
  nonce: bigint,
  side: "UP" | "DOWN",
  rows: EntryRow[],
) {
  if (!enabled || rows.length === 0) return false;
  return send("enterMany", [
    pool,
    nonce,
    side === "UP" ? 0 : 1,
    rows.map((r) => runKey(r.runId)),
    rows.map((r) => r.contracts),
    rows.map((r) => r.remainder),
    rows.map((r) => r.stackBefore),
  ]);
}

export async function bankRun(runId: string, finalStack: bigint) {
  if (!enabled) return false;
  return send("bankRun", [runKey(runId), finalStack]);
}

/** Did the market's settle transaction settle this round too? Used to prove it did. */
export async function roundState(pool: `0x${string}`, nonce: bigint) {
  if (!enabled) return null;
  const pub = publicClient;
  const key = await pub.readContract({ address: ADDRESS, abi, functionName: "roundKey", args: [pool, nonce] });
  const r = await pub.readContract({ address: ADDRESS, abi, functionName: "rounds", args: [key] });
  return { marketId: r[0], open: r[2], settled: r[3], voided: r[4], winner: r[5] };
}

export const address = ADDRESS;
