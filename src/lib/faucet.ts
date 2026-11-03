/**
 * The gas faucet: a sliver of testnet HYPE for wallets that have none.
 *
 * Players kept getting stuck at the first step. tUSDC mints free from the
 * player's own wallet, but that mint needs gas, and the only source of
 * testnet HYPE was Kinetiq's faucet, which many could not claim from. So the
 * team keeps a small reservoir in its own wallet and drips from it.
 *
 * Its own key (FAUCET_KEY on the web service), never the executor's: the
 * executor's nonce belongs to the game loop, and a faucet anyone can call must
 * not be able to stall a round.
 *
 * Bounded three ways: only wallets that hold (nearly) no HYPE, one drip per
 * wallet per week, and a daily total, so a script cycling fresh addresses can
 * drain a day's allowance and nothing more.
 */
import { createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db } from "./db";
import { publicClient } from "./chain";
import { elysium, RPC_URL } from "./elysium";

/** ~200 transactions at Elysium's gas price. */
export const DRIP = parseEther("0.002");
/** A wallet already holding this much has gas; it doesn't need a drip. */
const ALREADY_FUNDED = parseEther("0.0002");
const PER_WALLET_MS = 7 * 86_400_000;
export const DRIPS_PER_DAY = 300;

const raw = (process.env.FAUCET_KEY ?? "").trim();
const key = (raw && !raw.startsWith("0x") ? `0x${raw}` : raw) as Hex;
const account = /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key) : null;
const client = account ? createWalletClient({ account, chain: elysium, transport: http(RPC_URL) }) : null;

export const faucetAddress = account?.address ?? null;

export async function faucetStatus() {
  if (!account) return { open: false, address: null, balance: null, drip: Number(DRIP) / 1e18 };
  const balance = await publicClient.getBalance({ address: account.address }).catch(() => null);
  return {
    open: balance !== null && balance >= DRIP,
    address: account.address,
    balance: balance === null ? null : Number(balance) / 1e18,
    drip: Number(DRIP) / 1e18,
  };
}

/** Send one drip, or say plainly why not. */
export async function drip(to: `0x${string}`): Promise<{ tx: string } | { error: string; status: number }> {
  if (!client || !account) return { error: "the gas faucet isn't set up yet — use the Elysium faucet for now", status: 503 };
  const address = to.toLowerCase();

  const have = await publicClient.getBalance({ address: to });
  if (have >= ALREADY_FUNDED) return { error: "this wallet already has gas", status: 409 };

  const prior = await db.gasDrip.findUnique({ where: { address } });
  if (prior && Date.now() - prior.at.getTime() < PER_WALLET_MS) {
    return { error: "this wallet had gas from us this week — if it's gone, ask in the ROPES chat", status: 429 };
  }
  const today = await db.gasDrip.count({ where: { at: { gte: new Date(Date.now() - 86_400_000) } } });
  if (today >= DRIPS_PER_DAY) return { error: "the gas faucet is out for today — try again tomorrow", status: 429 };

  const tank = await publicClient.getBalance({ address: account.address });
  if (tank < DRIP * 2n) return { error: "the gas faucet is empty right now — the team has been told", status: 503 };

  // Claim the row before sending, so two taps can't both pass the check.
  await db.gasDrip.upsert({ where: { address }, create: { address }, update: { at: new Date(), tx: null } });
  try {
    const hash = await client.sendTransaction({ to, value: DRIP });
    await db.gasDrip.update({ where: { address }, data: { tx: hash } });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 }).catch(() => null);
    return { tx: hash };
  } catch (err) {
    await db.gasDrip.delete({ where: { address } }).catch(() => {});
    return { error: `couldn't send gas: ${String(err).slice(0, 80)}`, status: 502 };
  }
}
