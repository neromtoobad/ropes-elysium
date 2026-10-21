# Trust model & admin keys
> Who can do what, what they can't do, and what changes before real money.

## Keys

| Key | Address (testnet) | Can | Can't |
|---|---|---|---|
| **Owner** | `0xD6B5Adf4eE823f5B77917022742f2CA0e239CF01` | rotate the operator; set the scoreboard hook; adjust parameters **within fixed bounds** (spread 0.2–10%, round cap ≤ 50%, σ bounds) | move user or vault funds; change a settled round |
| **Operator** (keeper) | `0x1fABaEb15bcdf03f87A2821e46f182A401C9dD60` | relay Hyperliquid prices; open and settle rounds; place buys and sells; update σ (bounded) | settle on a price sampled outside the window; settle before the bell; withdraw the vault |
| **Anyone** | — | redeem their shares; deposit to or withdraw from the vault (free balance only); void a round abandoned for 120 s | trade (operator-only in this version) |

The contracts are **not upgradeable**. The operator's key was generated inside the hosting environment and has never been in the repo. The owner can replace it with `setOperator` if it's ever compromised.

## Custody today (testnet)

Players' stakes sit in **one pooled house wallet** run by the game server, with a Postgres ledger of whose money is whose. The on-chain scoreboard mirrors every round, entry and elimination, so the ledger can be checked against it. **This changes before mainnet:** per-player positions on-chain.

## Price trust

The keeper is trusted for prices until the HyperCore precompile ships. That trust is bounded by the contract's sample windows and checkable through the [audit](/docs/price-source).

## Why trading is operator-only

A market fed by a relay can be picked off by anyone with a faster Hyperliquid feed than the relay. Keeping trading operator-only removes that until prices come straight from HyperCore. Then trading opens to everyone.
