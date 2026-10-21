# Price source & audit
> Where every strike and close comes from, and how anyone can check them.

## Two prices, two jobs

| Price | Source | Used for |
|---|---|---|
| **Candle open** | the open of Hyperliquid's own 1-minute candle (`candleSnapshot`), the first trade of the minute | every **strike** and every **close** |
| **Live mid** | Hyperliquid's book mid (`allMids`) | pricing every **trade** between bells |

A book mid is the middle of the order book at one instant. It's the right input for a live quote, but nobody can look it up later. A candle open is a permanent, public Hyperliquid number. Settling on it makes every result checkable.

## Why we changed it

The first testnet rounds were struck at the book mid. A full-history audit of those 40 rounds found **18 of 81** strikes and closes outside Hyperliquid's trade candle for that minute, by up to $0.036. Measured at one boundary, the mid sat at 78.7135 for about 10 seconds while the minute's first trade printed 78.706. From round 47 (Oct 18, 2026) every strike and close is the candle open.

## The audit

`scripts/audit.ts` takes every `RoundOpened` (strike) and `RoundSettled` (close) event from `RopeMarket` and checks each one for **exact equality** with Hyperliquid's published candle open:

```bash
npx tsx scripts/audit.ts <fromBlock> 47 -v
```

Since the candle-open rule: **27 of 27 exact** (rounds 47–60, Oct 18). The live check of the latest rounds is on [/transparency](/transparency).

## What the relay is trusted for

Until the [HyperCore precompile](/docs/hypercore-precompile) ships, a keeper reads Hyperliquid's public API and carries the price on-chain with each open, trade and settle. The contract limits what it can do with that:

- A strike must be sampled within 8 s of the open, a close within 8 s after the bell, or the round voids.
- Hyperliquid-side timestamps must only move forward, and can't be from the future.
- Every relayed price is an event (`MarkPushed`, `RoundOpened`, `RoundSettled`), so the audit can replay all of them.
