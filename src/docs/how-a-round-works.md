# How a round works
> One minute, from the strike to the bell, and what happens on-chain at each step.

| Time | What happens | On-chain |
|---|---|---|
| **00:00 + ~2 s** | The round opens, struck at the open of Hyperliquid's 1-minute candle for this minute. | `openRound(opensAt, expiresAt, strike, sourceMs)` |
| **00:00 – 00:35** | Entries. Each pick is filled at the contract's live quote. | `buy(round, side, budget, maxPrice, mark, sourceMs)` |
| **any second** | BAIL. The contract buys your shares back at the live bid. | `sell(round, side, shares, minPrice, mark, sourceMs)` |
| **00:55 – 01:00** | No new buys in the last 5 seconds. Selling stays open to the bell. | |
| **01:00 + ~3 s** | The bell. The round settles on the open of the next minute's candle, which also becomes the next round's strike. The scoreboard settles in the same transaction. | `settle(round, close, sourceMs)` → `ArenaRegistry.onRoundSettled` |
| **then** | Winners redeem, and surviving stacks roll into the next minute. | `redeem(round)` |

## What "your climber's height" means

Height is the live value of your position against what you put in, drawn on a log scale so equal relative moves are equal distances on the wall. The number on the BAIL button is exactly what a sale would pay right now: the bid for your side, not the price to buy it.

## Winning, losing, compounding

- A winning share pays **1 tUSDC**. If you bought UP at 0.51, each share cost 0.51 and pays 1. That's about 1.96× on the stake.
- A losing share pays nothing. You can never lose more than your seat.
- If you survive, your whole stack rides the next round. That's how a run compounds: 10 → 19.5 → 38…
- If HYPE closes exactly on the strike, nobody beat the line and the round voids. See [Voids & refunds](/docs/voids).
