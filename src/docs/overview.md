# Overview
> One minute of Hyperliquid, on a rope. What ROPES is, what works today, and what doesn't yet.

ROPES is a one-minute prediction game on the **HYPE** price, running on **Elysium**, Kinetiq's Hyperliquid L2.

Every minute a new round opens. You pick **UP** or **DOWN**, and your climber's height on the wall *is* your position's live value, second by second. **BAIL** at any second and the contract buys your position back at the live price. Ride to the bell: if your side is right, your stack multiplies and rolls straight into the next minute. If it's wrong, you fall.

There is no order book. **The contract itself is the market maker.** On every trade it prices the round from the Hyperliquid mark, so you're in from the first second and you can always get out.

## Why this exists

Hyperliquid has prediction markets, but the shortest native recurring one lasts **a day**, and listing a new one takes a 500k HYPE stake. Nothing in the ecosystem trades at the speed of a minute, because a one-minute market is a binary option that has to be re-priced every time the price moves. That only works on a chain with ~100 ms blocks and near-zero gas. That chain is Elysium.

## What works today

On Elysium testnet (chain 99801), at [ropes.nerom.site](https://ropes.nerom.site):

- A round opens every minute, struck at the open of Hyperliquid's own 1-minute candle.
- Buy UP or DOWN, BAIL at any second, settle at the bell, redeem. All on-chain, against `RopeMarket`.
- The price of every trade is computed by the contract: `fair(UP) = Φ(ln(S/K) ÷ σ√τ)` plus a 1% spread.
- A house vault takes the other side, with a per-round risk cap.
- The scoreboard (`ArenaRegistry`) settles inside the same transaction as the money.
- A missed bell voids the round and refunds every player exactly what they paid.
- Free seats with no wallet, or your own wallet with a test-dollar bankroll.
- A public audit: every strike and close equals Hyperliquid's published candle open. See the live check on [/transparency](/transparency).
- 37 contract tests. Sources verified on the Elysium explorer.

## What does not work yet

- **Mainnet and real USDC.** Elysium mainnet goes live **Nov 9, 2026**. ROPES follows once a security review is done.
- **Per-player custody.** On testnet, players' stakes sit in one pooled house wallet run by the game server, with a ledger of who owns what. Per-player on-chain positions come before real money.
- **Reading Hyperliquid directly.** Until the HyperCore precompile ships (about four weeks after mainnet), a keeper relays the price. See [Price source & audit](/docs/price-source).
- **Open trading.** Only the operator can trade today, so nobody can front-run the relay.
- **More markets.** HYPE only for now. BTC, SOL and the 24/7 S&P are next.
- **$ROPES.** The token launches through Ascend after mainnet. See [$ROPES](/docs/token).

## Read next

- [Quickstart](/docs/quickstart): play in two minutes
- [How a round works](/docs/how-a-round-works)
- [Pricing](/docs/pricing)
- [Trust model & admin keys](/docs/trust-model)
