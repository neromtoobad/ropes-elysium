# What an option is
> Calls, puts, strikes and expiries, in plain words.

An option is a contract that pays out depending on where a price ends up at a set time.

- A **call** pays if HYPE finishes **above** its strike. It pays the difference: strike 65, HYPE at 66 at expiry, the call pays 1.
- A **put** pays if HYPE finishes **below** its strike. Strike 65, HYPE at 64, the put pays 1.
- The **strike** is the line. The **expiry** is the moment the price is read.
- The **premium** is what the option costs. It's the price you see on the book.

One ROPES option is on **1 HYPE**. You can trade fractions down to 0.01 of an option.

## Buying

When you buy, you pay the premium and that's the most you can ever lose. If the option finishes out of the money, it pays nothing and you lose the premium. If it finishes in the money, you get the payout.

**Break-even** is where the payout covers what you paid:

- For a call: strike + premium.
- For a put: strike − premium.

## Selling

When you sell (also called writing), you receive the premium up front and lock collateral to cover the most the option could pay. If it finishes out of the money, you keep the premium and get your collateral back. If it finishes in the money, the payout comes out of your collateral. See [Collateral & payouts](/docs/collateral).

## Three ways people use them

| Goal | Trade | Example |
|---|---|---|
| **Protect** a position | Buy a put | Long HYPE on Hyperliquid? A 1-hour put below the price pays if HYPE drops. |
| **Earn** on what you hold | Sell a call | Holding HYPE you'd sell higher anyway? Sell a call above the price and keep the premium. |
| **Bet** on a move | Buy a call or put | Think HYPE climbs in the next 15 minutes? Buy a call. The most you can lose is what you paid. |

## What moves the price of an option

- **Distance to the strike.** The further in the money, the more it's worth.
- **Time left.** More time means more chance to move, so more value. Value drains away as expiry gets close.
- **Volatility.** The more HYPE is swinging, the more options are worth. ROPES measures it from Hyperliquid's last hour of one-minute candles.

The trade screen shows each option's **delta** (how much its price moves per 1 of HYPE) and its **chance** of finishing in the money, according to the model.

## European, cash-settled

ROPES options can only pay out at expiry (European style), and they pay in USDC, never in HYPE (cash-settled). Nothing is delivered, and nobody can exercise early.
