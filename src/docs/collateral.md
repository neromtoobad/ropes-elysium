# Collateral & payouts
> Fully collateralised: every option that can pay is paid for before it trades. No margin calls, no liquidations.

ROPES v1 is **fully collateralised**. Money that an option might have to pay out is locked in the contract from the moment the option exists. Nobody can be liquidated, and no payout depends on someone else topping up.

## Buyers

You pay the premium. That's it. The most you can lose is what you paid.

## Sellers (writers)

To write options you lock their **maximum payout** in USDC. In exchange you get one LONG and one SHORT token per option:

- Sell the LONG on the book and keep the premium.
- Keep the SHORT. At expiry it returns whatever collateral the LONG didn't need.

Before expiry you can hand back a LONG and a SHORT together to unlock the collateral, so you can close a written position by buying the LONG back.

## The maximum payout is the strike

Every ROPES option pays out at most its **strike**, in USDC:

- A **put** can never pay more than its strike anyway (HYPE can't go below zero).
- A **call** is **capped**: it pays the move above the strike, up to the strike itself. A 65 call pays at most 65, which needs HYPE above 130 at expiry. For expiries from five minutes to a day, the cap is far out of reach. It exists so a seller can always lock a fixed amount.

So writing one 65 put or one 65 call locks 65 USDC.

## At expiry

| Holder | Gets |
|---|---|
| LONG (call) | min(price − strike, strike), or 0 if the price is at or below the strike |
| LONG (put) | strike − price, or 0 if the price is at or above the strike |
| SHORT | the strike minus whatever the LONG got |

LONG plus SHORT always add up to exactly the collateral that was locked. The contract checks this in its tests on every path, with fuzzing.

## Redeeming

Once the settlement price is in, anyone holding LONG or SHORT tokens calls **redeem** and the USDC is sent in the same transaction. There's no deadline to redeem.
