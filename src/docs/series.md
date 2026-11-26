# Series & expiries
> Every minute is an expiry. How series are created, which strikes exist, and when they close.

A **series** is one option: an underlying, a strike, an expiry, call or put. "HYPE 66.00 call, 15:30 UTC" is one series. Each series has its own order book.

## Expiries

Series roll on a fixed UTC grid, so everyone always knows when the next one closes.

| Expiry | A new series every | Strike step | Where |
|---|---|---|---|
| 1 minute | minute | 0.05 | [Climb](/docs/how-a-round-works), up or down |
| 5 minutes | 5 minutes | 0.05 | the book |
| 15 minutes | 15 minutes | 0.10 | the book |
| 1 hour | hour | 0.25 | the book |
| 1 day | day, at 08:00 UTC | 1.00 | the book |

Example: at 14:07 UTC, the live 15-minute series expire at 14:15, and the next ones open as soon as those close.

## Strikes

When a series opens, the operator creates strikes on the grid around the current Hyperliquid price: the strike nearest the price, then five steps above and five below. If HYPE moves a long way during a long expiry, new strikes are added on the same grid so there's always one near the price.

## Trading stops at expiry

At the expiry second, the book for that series closes:

- No new orders or fills.
- Open orders can be cancelled and refunded, by you or by anyone on your behalf.
- The series waits for its settlement price. See [Settlement](/docs/settlement).

## Why so many expiries

Short expiries are the reason ROPES exists. A 5-minute option is a precise tool for a precise view, and on Elysium a book can keep up with it. Longer expiries let you protect a position or earn on HYPE you hold.
