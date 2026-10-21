# Voids & refunds
> When a round can't be settled honestly, nobody wins or loses on it.

A round **voids** when:

1. **No price at the bell.** The close must be sampled within 8 seconds after the bell (`sampleWindowSecs = 8`), on the Hyperliquid clock. A keeper that was down for the bell can't settle on a later price.
2. **A tie.** HYPE closes exactly on the strike.
3. **An abandoned round.** If a round is still unsettled 120 seconds after its bell, **anyone** can call `voidStale(round)`. A dead keeper can't freeze money.

## What a void pays

A void **refunds every holder exactly what they paid** for the shares they still hold, their cost basis. It isn't "half a share each side", which would move money between UP and DOWN players.

If you bailed part of a position before the void, the refund follows: the cost basis leaves with the shares you sold, pro rata, and you get back the basis of what's left.

The test suite covers both a full refund and a refund after a partial bail.
