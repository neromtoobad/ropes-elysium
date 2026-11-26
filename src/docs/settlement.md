# Settlement
> Where the expiry price comes from, today and after the precompile.

Every series settles on **Hyperliquid's own price** at its expiry: the open of the one-minute HYPE candle that starts at the expiry second. It's the same rule [Climb](/docs/the-bell) has used since October 18, and it has a public track record on [/transparency](/transparency).

## Today: the keeper relay

Until the HyperCore precompile is live on Elysium, a keeper reads the candle from Hyperliquid and posts it to the settlement oracle contract:

- One price per underlying and expiry, written once.
- The owner has a short correction window (minutes, not hours) to fix a wrong post. After that the price is final.
- Every posted price can be checked against Hyperliquid's public candle history. Our audit script does exactly that and publishes the result.

This is a trust assumption, and we say so. See [Trust model & admin keys](/docs/trust-model).

## About Dec 7: the precompile

Elysium's [HyperCore precompile](/docs/hypercore-precompile) lets a contract read Hyperliquid's oracle price directly. The settlement oracle switches to it, with a freshness check, and the keeper leaves the price path. Same interface, so the book doesn't change.

## If a price is late

If no settlement price arrives, the series stays closed and nothing can be redeemed until it does. Funds are never released at a guessed price. The owner can post the correct candle open, and that post is public and checkable like every other.

## What "settled" means for you

Once the price is in, every LONG and SHORT in that series has a fixed value. Redeem whenever you like: there's no deadline. See [Collateral & payouts](/docs/collateral).
