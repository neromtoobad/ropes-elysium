# The HyperCore precompile
> What changes when Elysium contracts can read Hyperliquid directly.

Kinetiq is shipping a **HyperCore read precompile** in an ArbOS upgrade about **four weeks after Elysium mainnet**. It lets an Elysium contract read Hyperliquid's order books, oracle, mark and spot prices directly, at HyperCore block granularity, attested by the sequencer.

## What it means for ROPES

| Today (keeper) | With the precompile |
|---|---|
| A keeper reads Hyperliquid's API and carries the price on-chain | `RopeMarket` reads the price itself |
| Trust in the relay, bounded by sample windows and the audit | No relay to trust |
| Trading is operator-only to stop relay front-running | **Trading opens to everyone** |
| The keeper strikes and settles | Anyone can strike and settle, with the price read on-chain |

After that, Elysium's CoreWriter keeper lane lets the vault hedge its net exposure on HyperCore, so it can offer deeper rounds without carrying more directional risk.
