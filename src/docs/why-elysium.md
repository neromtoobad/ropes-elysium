# Why Elysium
> A one-minute market is only possible on a chain like this one.

Elysium is Kinetiq's L2 for Hyperliquid: an Arbitrum Orbit chain that settles to HyperEVM and uses **HYPE** for gas. Mainnet goes live **Nov 9, 2026**.

## What ROPES needs from a chain

| Need | Why | Elysium |
|---|---|---|
| Fast blocks | Fair value moves every tick near the bell; a trade must land before its quote is stale | ~115 ms blocks (measured on testnet) |
| Cheap writes | Every open, trade and settle is a transaction, every minute | ~0.1 gwei gas; a live minute costs ≈ 0.00003 HYPE |
| Hyperliquid prices | Rounds are on Hyperliquid's own markets | The HyperCore read precompile (≈ 4 weeks after mainnet) |
| A launch path | A token backed by game volume | Ascend, Elysium's launchpad |

On HyperEVM's small blocks, re-quoting an option on every trade isn't practical. On Elysium it costs a fraction of a cent.

## Builder share

Elysium returns 25% of sequencer fees to apps that use the blockspace. A busy wall writes several transactions a minute.
