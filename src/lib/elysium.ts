/**
 * Elysium testnet — Kinetiq's Hyperliquid L2 — and where ROPES lives on it.
 *
 * Safe to import from the browser: no keys here, only public facts. Verified
 * against the live RPC on 18 Oct 2026 (eth_chainId 0x185d9 = 99801).
 *
 * viem has no built-in definition for this chain, and must not be given one by
 * name lookup: "Elysium" is also an unrelated chain (Vulcan Forged's) in some
 * chain lists, which is the classic way to sign for the wrong network.
 */
import { defineChain } from "viem";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";
export const EXPLORER = "https://elysium.kinetiq.xyz/testnet-explorer";

export const elysium = defineChain({
  id: 99801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Elysium Explorer", url: EXPLORER } },
  testnet: true,
});

const addr = (v: string | undefined) => (v ?? "").trim() as `0x${string}`;

/** The market contract, the test dollars it settles in, and the scoreboard. */
export const MARKET = addr(process.env.NEXT_PUBLIC_MARKET);
export const COLLATERAL = addr(process.env.NEXT_PUBLIC_COLLATERAL);
export const REGISTRY = addr(process.env.NEXT_PUBLIC_REGISTRY);

/** The Hyperliquid market the rope is tied to. */
export const ASSET = (process.env.NEXT_PUBLIC_ASSET ?? "HYPE").trim();

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
