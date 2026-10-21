# Pricing
> How the contract quotes UP and DOWN on every trade, and why there's always a price.

ROPES doesn't match buyers with sellers. `RopeMarket` is the market maker: it quotes both sides itself, from the Hyperliquid mark, at the moment each trade lands.

## The formula

```
fair(UP) = Φ( ln(S / K) ÷ (σ · √τ) )
```

| Symbol | Meaning |
|---|---|
| `S` | the latest Hyperliquid mark, carried in with the trade |
| `K` | the strike: the open of Hyperliquid's 1-minute candle for this round |
| `τ` | seconds left until the bell |
| `σ` | HYPE's volatility of ln(price) per √second |
| `Φ` | the standard normal CDF |

This is the fair price of a binary option: the probability that HYPE finishes above the strike, given where it is now and how much time is left. A DOWN share is worth `1 − fair(UP)`.

## The quote

| | UP | DOWN |
|---|---|---|
| **Buy at** | `fair + 1%` | `1 − (fair − 1%)` |
| **Sell (BAIL) at** | `fair − 1%` | `1 − (fair + 1%)` |

- The half-spread is **1%** (`halfSpread = 10000`, in units of 1e6).
- It **doubles in the last 10 seconds** (`lateSecs = 10`), when prices swing fastest.
- Quotes are clamped to [0, 1]. A side that has lost all its value sells for 0.
- The game won't enter a side priced above **0.90**. At that price you risk the whole stack to make 11%.

## Volatility

`σ` is measured from the last ~65 one-minute Hyperliquid closes, floored at 0.04% a minute so a quiet hour can't price the next minute as a certainty. The keeper re-measures it every hour and pushes it on-chain when it moves more than 10%. The contract only accepts `σ` between `1e13` and `5e15` (wad per √second), roughly a 0.008% to 3.9% one-minute move.

## How it's computed on-chain

`fairUpAt(s, k, tau, sigma)` is a public pure function, so anyone can check a quote:

- `ln(S/K)` uses Solady's `lnWad`.
- `√τ` uses Solady's `sqrt`.
- `Φ` uses the Abramowitz & Stegun 7.1.26 approximation of `erf` (max error 1.5e-7, below one probability unit of 1e-6) with Solady's `expWad`.

The test suite checks `Φ` against reference values (Φ(1) = 0.841345, Φ(2) = 0.977250, Φ(0.5) = 0.691462) to within 2 units of 1e-6.

## Why this needs Elysium

A one-minute binary moves fast: one $0.01 tick on HYPE can move fair value by 10 points near the bell. Pricing it fairly means re-quoting on every trade, which is only practical on a chain with ~115 ms blocks and gas around 0.1 gwei.
