# The bell & settlement
> How a round ends, and why the closing price is also the next round's strike.

At the top of every minute the round that just ended settles, and a new one opens.

## One price, two jobs

The **close** of round N is the **open of Hyperliquid's 1-minute candle** that starts at the bell. That same price is the **strike** of round N+1. One read serves both, so the two can never disagree, and neither can be sampled late.

## Winner

- `close > strike`: UP wins.
- `close < strike`: DOWN wins.
- `close == strike`: nobody beat the line. The round voids and everyone is refunded. See [Voids & refunds](/docs/voids).

## Same-transaction scoreboard

`settle()` calls `ArenaRegistry.onRoundSettled()` inside the same transaction. The public scoreboard can't land on a different price, or in a different block, from the result that caused it.

The hook gets a fixed gas budget (`HOOK_GAS = 1,500,000`). If a caller tries to settle with less gas than that, `settle` reverts (`HookGas`). Gas estimation therefore can't find a limit where the money settles and the scoreboard silently doesn't. A hook that fails *with* its full budget can never block the money.

## Redeem

After settlement, winning shares redeem for 1 tUSDC each (`redeem(round)`). Surviving runs roll their stack into the next round.
