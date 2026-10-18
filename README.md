<p align="center">
  <img src="public/logo-full.png" alt="ROPES" width="220" />
</p>

# ROPES on Elysium

**One minute of Hyperliquid, on a rope.**

Every minute, a new round opens on the live Hyperliquid **HYPE** mark. Pick UP or DOWN for the
next sixty seconds. Instead of watching a chart, you watch your climber on the wall: their
height **is** your position's live value, second by second.

- **BAIL** at any second and the contract buys your position back at the live price. You keep
  what it pays.
- If your side is wrong when the bell rings, you fall.
- If you survive, your winnings are already staked in the next minute.

> **Play:** _live URL — added at deploy_ · **Chain:** Elysium testnet (99801), Kinetiq's
> Hyperliquid L2 · Built for the **Ascend Builder Program**. A port of ROPES, the
> Somnia × dreamDEX Event Contracts Hackathon entry.

---

## Why this only works on Elysium

Hyperliquid has prediction markets, but the shortest native recurring one runs for **a day**, and
listing one takes a 500k HYPE stake. Nothing in the ecosystem trades at the speed of a minute.

A one-minute market is a **binary option that has to be re-priced continuously**. Every time the
mark moves, the fair price of UP moves with it, and in the last seconds it moves a lot. ROPES
doesn't wait for a counterparty. **The contract is the market maker.** It quotes both sides from
the Hyperliquid mark on every trade:

```
fair(UP) = Φ( ln(S / K) / (σ · √τ) )

S  the live Hyperliquid mark        K  the strike: the mark at the top of the minute
τ  seconds left in the round        σ  HYPE's volatility per √second, re-measured hourly
                                       from Hyperliquid's own 1-minute candles
```

- **Spread:** it sells UP at fair + 1% and buys it back at fair − 1%. DOWN is the mirror image.
- **Vault:** a house vault takes the other side of every trade and earns the spread.
- **Payout:** a winning share redeems for exactly 1, so buying at p pays 1/p.

Re-quoting on every trade only makes sense on a chain where a block is ~100 ms and a write costs a
fraction of a cent. Kinetiq's own call for Elysium is for oracle-priced market makers ("PropAMMs")
that re-quote several times a second. ROPES is one of those, for one-minute binaries.

## What a minute looks like on-chain

| | |
|---|---|
| **00:00 + ~2 s** | `openRound`, struck at the **open of Hyperliquid's own 1-minute candle**: the minute's first trade |
| **00:01–00:35** | entries: `buy(side, budget)`, which carries a fresh mark, so every fill is priced at the moment it lands |
| **any second** | BAIL: `sell(side, shares)` at the live bid, right up to the bell |
| **01:00 + ~3 s** | `settle` on the open of the candle that starts at the bell. **The same price becomes the next round's strike.** Inside that same transaction the market calls the scoreboard (`ArenaRegistry.onRoundSettled`), so eliminations land in the settlement transaction itself |
| **then** | `redeem`: winners compound into the next minute |

## The trust model, stated plainly

Until Elysium's HyperCore read precompile ships (about four weeks after mainnet, per Kinetiq),
an Elysium contract can't read Hyperliquid directly. So ROPES's keeper relays the mark from
Hyperliquid's public API, and the contract fences in what it will accept.

**What the contract enforces:**

- **Sample windows.** A strike has to be sampled within 8 s of the open, and a close within 8 s
  after the bell, both on the Hyperliquid clock.
- **Late keeper means a refund.** If the keeper missed the bell, it can't settle on a later price.
  The round **voids**, and a void **refunds every holder exactly what they paid**.
- **Stale marks.** Trading stops on a mark more than 3 s old. Buys lock in the last 5 s.
- **Risk cap.** Each round can risk at most 25% of the vault's free balance. LPs can never
  withdraw what an open round might owe.
- **Abandoned rounds.** Anyone can void a round the keeper abandoned.

**How you can audit it:**

- Every strike and close is a published Hyperliquid number: the open of that minute's candle.
  `npx tsx scripts/audit.ts` checks each one for **exact equality** against Hyperliquid's own
  `candleSnapshot`. A relay that invented, rounded or delayed a price fails.
- Every relayed price is also an on-chain event (`MarkPushed`, `RoundOpened`, `RoundSettled`).
- Live quotes between bells use Hyperliquid's book mid, which is what the book says at that moment.
- Trading is operator-only in this version. An open market fed by a relay could be picked off by
  anyone with a faster feed than the relay.

> Why the candle open, not the mid: the first testnet rounds were struck at the `allMids` book mid.
> A full-history audit found 18 of 81 of those prices outside Hyperliquid's trade candle for the
> minute, by up to $0.036. A mid is the middle of the book, not a trade, and nobody can look one up
> later. So rounds now strike and settle on the candle open, which anyone can check exactly.

**The roadmap removes the trust:**

1. Swap the relay for the sequencer-attested HyperCore precompile.
2. Open trading to anyone.
3. Hedge the vault's net exposure on HyperCore through Elysium's CoreWriter keeper lane.

## Proof

**Elysium testnet (chain 99801)** — sources verified on the explorer:

| | |
|---|---|
| RopeMarket (HYPE) | [`0x62C4b522Bf76422E77CEdA22E94e0540f9422d1D`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x62C4b522Bf76422E77CEdA22E94e0540f9422d1D) |
| ArenaRegistry | [`0xDBd28A7AacD7228edDef44c177C195878DfCa858`](https://elysium.kinetiq.xyz/testnet-explorer/address/0xDBd28A7AacD7228edDef44c177C195878DfCa858) |
| tUSDC (test dollars) | [`0x46397dA50c05AfA43cBfcA712215eD1E02A9F57d`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x46397dA50c05AfA43cBfcA712215eD1E02A9F57d) |

The house vault is seeded with 100,000 tUSDC, so each round may risk up to 25,000.
The **owner** (deployer, kept offline) and the **operator** (the keeper) are separate keys: the
keeper's key was generated inside the hosting environment and has never left it, and the owner
can rotate it with `setOperator` if it is ever compromised. Operator:
[`0x1fABaEb15bcdf03f87A2821e46f182A401C9dD60`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x1fABaEb15bcdf03f87A2821e46f182A401C9dD60).

Local rehearsal at live HYPE prices, 18 Oct 2026, through the same code the executor runs
(`scripts/rehearse.ts`):

```
05:41:05 round #1 struck at 78.4645  quote yesBid 0.406 yesAsk 0.426
05:41:10 BUY UP   23.4835 shares @ 0.426 for 10.0000
05:41:26 live: mark 78.4525 vs line 78.4645  fair(UP) 0.360
05:41:30 BAIL ½   sold 11.7417 shares for 4.1298
05:42:04 SETTLED  close 78.4255 vs strike 78.4645 → DOWN wins
```

The fair price the contract computed is the textbook value: d = −0.354 gives Φ = 0.362.
`forge test`: **37 tests**, including Φ against reference values to within 2 parts per million,
refunds that follow a partial BAIL, and a settle that refuses to run if it would starve the
scoreboard of gas.

## What carried over from Somnia, and what had to change

| Somnia × dreamDEX | Elysium |
|---|---|
| dreamDEX's order book of 1-minute BTC event contracts | **RopeMarket**, our own oracle-quoted market (no venue existed) |
| An empty book for the first 5–10 s of every window | The contract always quotes, so you're in from the first second |
| Settled by Somnia's reactivity precompile | Settled by the market itself, scoreboard in the same transaction |
| A void paid 0.5 per share | A void refunds what you paid |
| BTC | The **Hyperliquid HYPE mark** (multi-asset: BTC and the 24/7 `xyz:SP500` HIP-3 market are one deploy away) |

The game itself is unchanged: the wall, eight climbers, tables, the bell, auto-bail, the bankroll
and the share card.

## The token (for the Ascend launch)

`$ROPE` launches through Ascend after Elysium mainnet:

- **Holders earn from the vault.** Spread income from the house vault goes to $ROPE buybacks.
  The vault's edge is the spread, so volume drives the buybacks.
- **Seasons and skins.** Seasonal leaderboards and climber skins.
- **Holders pick the next rope.** Which Hyperliquid market gets one next: BTC, SOL, the
  weekend S&P.

ROPES is a game with many small, repeat players, which suits a "PVE coin" that trades on usage.
On testnet the token is roadmap only: the game runs on mock tUSDC.

---

## Run it

```bash
npm install
cp .env.example .env              # a THROWAWAY key with a little Elysium testnet HYPE for gas
forge test                        # 37 contract tests
DEPLOY_PK=$PRIVATE_KEY SIGMA_WAD=$(…) forge script contracts/script/Deploy.s.sol \
  --rpc-url elysium_testnet --broadcast
npx prisma db push                # the ledger
npm run dev                       # the wall on :3000
npm run executor                  # the game loop + Hyperliquid relay
npx tsx scripts/rehearse.ts       # one round, end to end, with every tx printed
npx tsx scripts/audit.ts          # every strike and close == Hyperliquid's candle open
npm run doctor                    # does the money add up?
```

## Stack

Next 15 · React 19 · Tailwind 4 · TypeScript · viem 2 · Prisma 6 + Postgres · Foundry ·
Solidity 0.8.28 · Solady `FixedPointMathLib` (lnWad, expWad, sqrt) · Hyperliquid info API

```
contracts/src/RopeMarket.sol     the market: pricing, rounds, caps, settle, redeem, vault
contracts/src/ArenaRegistry.sol  the public scoreboard, settled from inside RopeMarket.settle
contracts/src/MockUSDC.sol       test dollars, open mint
src/lib/hyperliquid.ts           marks and σ from Hyperliquid
src/lib/market.ts, orders.ts     the executor's adapter to RopeMarket
src/executor/                    the tick loop and game rules
src/app/                         the wall, the climber, sound, API routes
```

## AI tools

The eight climbers and both logos were generated with Higgsfield (`nano_banana_pro`) for the
Somnia version. A pipeline then cut them into sprites automatically, splitting pose sheets on
column-density valleys.
