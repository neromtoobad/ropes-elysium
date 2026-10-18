/**
 * The one place that talks to Elysium.
 *
 * Shared by the executor and the web app. Only the executor holds the key;
 * the web app needs nothing but public reads, so importing this file must
 * never require PRIVATE_KEY — the signer is built lazily, on first write.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, http, erc20Abi, type Hex } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { elysium, RPC_URL, MARKET, COLLATERAL, ASSET as ASSET_ } from "./elysium";
import { readMark } from "./hyperliquid";

export { MARKET, COLLATERAL };

/** Collateral is tUSDC at 6 decimals; probabilities share the same scale. */
export const DECIMALS = 6;
export const ONE = 10n ** BigInt(DECIMALS);

/** The Hyperliquid market and cadence the game runs on. One market, one clock. */
export const ASSET = ASSET_;
export const INTERVAL_SEC = 60;
/**
 * Kept for the code paths that were written for a venue with several
 * cadences. On Elysium the market is ours and opens a window every minute, so
 * there is only ever one.
 */
export const CADENCES = [60] as const;

export const publicClient = createPublicClient({ chain: elysium, transport: http(RPC_URL) });

const pk = (process.env.PRIVATE_KEY ?? "").trim() as Hex;
const account = pk && pk !== "0x" ? privateKeyToAccount(pk, { nonceManager }) : null;

/** The house executor wallet. Pooled — the database says whose money is whose. */
export const HOUSE = (account?.address ?? process.env.HOUSE_ADDRESS ?? "").trim() as `0x${string}`;

const makeWallet = () => createWalletClient({ account: account!, chain: elysium, transport: http(RPC_URL) });
let _wallet: ReturnType<typeof makeWallet> | null = null;
/**
 * The executor's signer. One account, one nonce manager, one sequential
 * writer: every order, open, settle and registry write goes through here and
 * is awaited in turn, so nonces can never race.
 */
export function wallet() {
  if (!account) throw new Error("PRIVATE_KEY missing — only the executor signs");
  if (!_wallet) _wallet = makeWallet();
  return _wallet;
}

/** Collateral balance of the house wallet. */
export async function houseCollateral(): Promise<bigint> {
  return publicClient.readContract({ address: COLLATERAL, abi: erc20Abi, functionName: "balanceOf", args: [HOUSE] });
}

/** Native HYPE, for the "am I about to run out of gas" check. */
export async function houseGas(): Promise<bigint> {
  return publicClient.getBalance({ address: HOUSE });
}

/**
 * The live price the page draws racing the strike line — Hyperliquid's own
 * mid, read directly. The market prices off the SAME read, relayed on-chain.
 */
export async function fetchPrice(): Promise<{ price: number } | null> {
  const m = await readMark(ASSET);
  return { price: m.price };
}

export const toUsd = (raw: bigint) => Number(raw) / Number(ONE);
export const fmtUsd = (raw: bigint) => toUsd(raw).toFixed(4);
export const fmtProb = (raw: bigint) => (Number(raw) / Number(ONE)).toFixed(3);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Snap a raw value down onto a grid step. Below one step this yields 0. */
export const snap = (v: bigint, step: bigint) => (v / step) * step;
