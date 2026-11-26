# The order book
> How orders are placed, matched and cancelled, entirely inside the contract.

Each series has one limit order book. It trades the option against USDC: bids are people who want to buy the option, asks are people who want to sell it.

## Orders

- **Limit**: you name a price. Whatever can fill against the book right now fills, and the rest rests on the book at your price until it fills or you cancel.
- **Post-only**: a limit order that must rest. If it would fill immediately, it's rejected instead, so you always make and never take.
- **Market**: fills right away against the best prices, with a price limit you set so a thin book can't fill you somewhere silly. Anything that can't fill inside your limit is refunded.
- **Cancel** and **cancel-replace** (move an order's price or size) are one transaction each.

Prices are the premium per option, in steps of **0.001 USDC**. Sizes go down to **0.01** of an option.

## Matching

- **Best price first.** A buy fills against the lowest ask, a sell against the highest bid.
- **Then first come, first served.** At the same price, the order that rested first fills first.
- **No trading with yourself.** If your new order would hit one of your own resting orders, that resting order is cancelled instead.
- **Bounded.** One transaction fills at most 32 resting orders, so gas stays predictable. A bigger order fills the rest in the next transaction.

## What happens to your money while an order rests

- A resting **buy** holds the premium (plus the most it could pay in fees) aside until it fills or is cancelled.
- A resting **sell** holds the options you're selling aside. If you're selling to open, the collateral is locked first. See [Collateral & payouts](/docs/collateral).

Cancelling gives everything back in the same transaction.

## Fees

Makers (orders that rest) and takers (orders that fill against the book) pay a small fee on the premium. The exact levels are set before mainnet and shown on the ticket before you sign. All fees go to the protocol's revenue, which funds $ROPES and KNTQ buybacks. See [$ROPES](/docs/token).

## The vault is always there

Every live series has the [backstop vault](/docs/backstop-vault) quoting a bid and an ask around fair value. Anyone who quotes a better price is ahead of it in the queue, because the book only cares about price and time.

## Positions are tokens

When you buy an option you hold a LONG token for that series. When you write one you also hold a SHORT token. Both follow the ERC-1155 standard, so other apps on Elysium (vaults, lenders, games) can hold, show or use them.
