# The house vault
> The liquidity on the other side of every trade, and how it's protected.

`RopeMarket` is the counterparty to every trade. Its liquidity comes from a **house vault**: collateral deposited by LPs in exchange for vault shares.

## How it earns

The vault's edge is the **spread**. Every buy pays fair + 1% and every sell receives fair − 1%, so on average the vault earns the spread on the volume it makes a market for. On mainnet, that spread income funds [$ROPES](/docs/token) buybacks.

## Depositing and withdrawing

- `deposit(assets)` mints vault shares at the vault's conservative value.
- `withdraw(shares)` pays out at the conservative value, **and only from the free balance**.
- The conservative value assumes every open round is lost by the vault. LPs can never withdraw money a round might owe.

## Liability accounting

The contract tracks `liability`: everything the vault currently owes or holds back.

- For an open round: its worst case, whichever side would owe more if it won.
- For a settled round: the unredeemed winnings.
- For a voided round: the unredeemed refunds.

`freeBalance() = balance − liability`. On testnet the vault is seeded with 100,000 tUSDC. Live numbers are on [/transparency](/transparency).
