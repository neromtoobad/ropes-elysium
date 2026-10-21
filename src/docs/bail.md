# BAIL
> Selling your position back to the contract, at any second, up to the bell.

**BAIL** sells your whole position back to `RopeMarket` at the live bid for your side: fair value at this moment, minus half the spread. There's no order book to wait on, so a bail always fills.

## When you can bail

- Any time from your entry until the bell.
- Buying stops 5 seconds before the bell. Selling does not.
- The bail is placed on the game server's next tick, about one second after you tap. The leap animation plays instantly and the money follows.

## What you get

`proceeds = shares × bid` (rounded down), where `bid = fair − half-spread` for UP, or `1 − (fair + half-spread)` for DOWN.

The **KEEP** number on the BAIL button is exactly this: the bid for your side, at the current mark.

## Example from testnet

A seat picked DOWN at 2.18×. HYPE moved against it, and the position was worth 0.94× of the stake. BAIL sold it back on-chain and banked **9.39** of the 10 staked, instead of riding to zero.

## Auto-bail

Set a target multiple and the game bails for you the tick your position's *sellable* value crosses it. The target is a trigger, not a promised price: the sale still goes through at the live bid.
