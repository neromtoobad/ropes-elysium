# Threat model
> What could go wrong, and what stops it.

| Threat | Mitigation |
|---|---|
| The keeper relays a false price | The price must be sampled within the window; every strike and close must equal Hyperliquid's public candle open, and the [audit](/docs/price-source) checks every one. The owner can rotate the keeper. |
| The keeper settles late on a better price | A close sampled more than 8 s after the bell isn't accepted; the round voids and everyone is refunded. |
| The keeper goes down | Rounds stop opening; any round left open 120 s past its bell can be voided by anyone. Nobody's money is stuck. |
| Latency arbitrage on the quote | Trading is operator-only until prices come from HyperCore; trades carry a fresh mark; stale marks (> 3 s) block trading; no buys in the last 5 s; the spread doubles in the last 10 s. |
| A round drains the vault | Each round can risk at most 25% of the free balance; LPs can't withdraw what open rounds may owe. |
| Gas estimation starves the scoreboard | `settle` requires `HOOK_GAS` left for the hook, or reverts. |
| Nonce races between two keepers | Railway deploys the keeper with no overlap; all writes go through one signer, in sequence. |
| Rounding leaks value | Buy costs round up, sell proceeds round down; refunds never underflow `reserved`. |
| A fake ROPES account or token | Only trust **@PlayRopes** and **ropes.nerom.site**. $ROPES isn't launched yet: any "ROPES token" today is a scam. We never DM first. |

## Not yet covered

- **A professional security review.** This is the first milestone before mainnet.
- **Per-player custody.** Testnet uses a pooled house wallet.
- **Single sequencer.** Elysium launches with one sequencer; this is Elysium's own trust assumption.
