# Overview
> The onchain options exchange for Hyperliquid. What ROPES is, what works today, and what doesn't yet.

ROPES is an **options exchange for HYPE**, built on **Elysium**, Kinetiq's Hyperliquid L2. You buy or sell calls and puts that expire anywhere from five minutes to one day out, and get paid on Hyperliquid's own price at expiry.

Everything that touches money happens inside the contracts: the order book matches, the collateral is locked, and every expiry settles there. Nobody runs a matching engine on a server.

## Two products, one book

- **ROPES Book**: the options exchange. Pick an expiry and a strike, then buy or sell with a limit or market order. Every series has a [backstop vault](/docs/backstop-vault) quoting both sides, so the book is never empty.
- **Climb**: the one-minute game. Up or down on HYPE every minute, with a climber on a rope showing your position live. Climb has been running on Elysium testnet since October 18, 2026. See [How a round works](/docs/how-a-round-works).

## Why this exists

Options are how traders protect a position, earn on what they already hold, or take a quick view without risking more than they paid. Hyperliquid has the deepest perp markets onchain but no native options. The options venues that exist match orders on their own servers.

A fully onchain book needs fast blocks, cheap gas, and a trustworthy Hyperliquid price inside the chain. Elysium has all three: 100 ms blocks, gas in HYPE, and a [HyperCore precompile](/docs/hypercore-precompile) that reads Hyperliquid's oracle directly.

## What works today

On Elysium testnet (chain 99801), at [playropes.xyz](https://playropes.xyz):

- **Climb** runs every minute. More than 13,000 one-minute options have settled onchain, and every strike and close matches Hyperliquid's published candle open ([live check](/transparency)).
- **The trade screen** shows live HYPE options priced by the vault's model on the real Hyperliquid price, with the payoff of any order before you place it.
- **Prices are computed in the contract**: the same Black-Scholes model the vault quotes from is public and checkable.

## What's coming

- **Dec 1, 2026**: the order book opens on testnet, with 5-minute, 15-minute, 1-hour and 1-day HYPE series.
- **About Dec 7**: expiries settle from the HyperCore oracle through the Elysium precompile, so no keeper sits in the price path.
- **After an outside audit**: mainnet with real USDC, with caps at first.
- **Then**: more markets (BTC, SOL, the 24/7 S&P), chosen by holder vote.

ROPES takes no real money until the audit is done.

## Read next

- [What an option is](/docs/options-101)
- [Series & expiries](/docs/series)
- [The order book](/docs/the-book)
- [Collateral & payouts](/docs/collateral)
