# The backstop vault
> The maker of last resort: why the book is never empty, and how it prices.

A new options book has a cold-start problem: nobody wants to quote until there's flow, and nobody trades until there are quotes. ROPES solves it with a **backstop vault** that quotes every live series from the first second.

## How it prices

The vault uses Black-Scholes with zero interest, the textbook model for European options:

- the **spot** is Hyperliquid's live HYPE price;
- **volatility** is measured from Hyperliquid's last hour of one-minute candles, with a floor so a quiet hour can't price risk at zero;
- the **time left** is the seconds to expiry.

It quotes **fair value ± 1%** (never tighter than one tick), at a set size per series. The model is the same one that has priced every Climb round since October, and the maths runs in the contract so anyone can check a quote.

## Better prices win

The vault is just another participant in the book. Anyone who quotes inside its prices is ahead of it, because matching is best price first, then first come first served. The more real makers there are, the less the vault trades.

## Limits

- A cap per series and a cap on total exposure, so one series or one direction can't drain it.
- It won't quote on a stale price: if the mark is too old, its quotes are pulled.
- When it sells options, it writes them like any other seller, fully collateralised.

## Who owns it

On testnet the vault is funded with test USDC by the team. On mainnet it will take deposits: depositors share its profit and loss, and 20% of its profit goes to protocol revenue. The vault can lose money. Its edge is the spread, not being right about HYPE.
