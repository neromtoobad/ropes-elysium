# ROPES options book (v1, testnet)

Fully collateralised European options on Hyperliquid assets, traded on an
onchain limit order book on Elysium. v1 lists HYPE only.

```
contracts/src/book/
  OptionsBook.sol        series, ERC-1155 positions, write/unwrite, the order book, fees, settlement
  ERC1155Lite.sol        minimal ERC-1155 (+ ERC-165) the book inherits
  TickBitmap.sol         4-level bitmap of non-empty price levels (best bid/ask in O(1))
  ISettlementOracle.sol  what the book reads at expiry
  KeeperOracle.sol       v1 oracle: keeper posts once, owner may correct for 10 minutes
  BlackScholes.sol       r = 0 Black–Scholes (capped call priced as a call spread)
  BackstopVault.sol      LP vault quoting model bid/ask on the book (phase 2)
contracts/script/DeployBook.s.sol
contracts/test/book/     forge tests (unit, fuzz, invariant, gas)
```

Nothing in `RopeMarket.sol`, `ArenaRegistry.sol`, `MockUSDC.sol` or their tests
was changed. No new dependencies; the only vendored code reused is the Solady
`FixedPointMathLib` already in `contracts/src/vendor/`.

## Design

**Option token + writer** (the Opyn / Premia model). A *series* is
`(underlying, expiry, strike, isCall)`. Anyone can *write* a series: `mint`
locks the max payout in tUSDC and returns one LONG and one SHORT token per
option. LONG is the option; SHORT is the claim on whatever collateral the LONG
does not take. The book is then a plain **LONG-token vs tUSDC** limit order
book. At expiry the oracle gives the settlement price and holders `redeem`:
LONG gets the payoff, SHORT gets max payout − payoff.

A LONG+SHORT pair is worth exactly the max payout whatever happens, so
`burnPair` returns the pair's collateral **at any time** (before or after
expiry, settled or not, paused or not). This is deliberately looser than "before
expiry" in the brief: it can only ever return what the pair is worth.

**Payoff** (per option; S = settlement, K = strike, both 1e8):

| | payoff | max |
|---|---|---|
| call | `min(max(S − K, 0), K)` (capped) | K |
| put  | `max(K − S, 0)` | K |

So one option always needs exactly K of collateral, call or put.

## Units

| quantity | unit | notes |
|---|---|---|
| collateral | tUSDC, 6 dp | |
| strike | uint64, 1e8 | must be a multiple of 1e4 ($0.0001) |
| qty | hundredths of an option | `QTY_ONE = 100` is 1 option = 1 unit of the underlying |
| price | tUSDC (6 dp) per **one** option | multiple of `TICK = 1000` ($0.001), `0 < price ≤ K/100` |
| notional | `price × qty / 100` | exact: `tick × 10 × qty` |
| collateral per qty unit | `K / 1e4` | e.g. K = $40 → 400 000 (= $0.40 per 0.01 option) |
| payoff per qty unit | `floor(intrinsic / 1e4)` | fixed once at settlement |
| token ids | LONG = `seriesId << 1`, SHORT = `(seriesId << 1) \| 1` | series ids are 1, 2, 3 … |

Strike → collateral: `K (1e8) / 100` is dollars in 6 dp per option, and
`/ 100` again per qty unit, hence `K / 1e4`. Requiring `K % 1e4 == 0` makes
that exact. The settlement payoff is floored to $0.0001 per option (rounding
goes to SHORT); because LONG and SHORT payouts are computed from the same
per-unit number, `long × payoffUnit + short × (unit − payoffUnit)` sums to the
collateral exactly, however the tokens were split between holders.

Series constraints (`createSeries`): underlying on the allow-list (HYPE at
deploy), expiry in the future and a whole minute, strike a positive multiple of
1e4, max payout ≥ one tick and `maxPayout / TICK < 2^32` (strikes up to ~$4.29M).

## The order book

- **Price-time priority.** One FIFO queue (doubly linked list of orders) per
  price level; a fill always takes the head of the best level.
- **Best bid / ask: a 4-level tick bitmap** (`TickBitmap.sol`). Level 0 has a
  bit per tick; each higher level has a bit per non-empty child word; the root
  is one word. Best price = 4 SLOADs walking down; insert/remove ≤ 4 words;
  "next level" for depth views ≤ 8 SLOADs. Chosen over a sorted level list
  because a sorted list costs O(levels) per insert (or a caller-supplied hint)
  and anyone can spam levels to make everyone else's inserts expensive; chosen
  over a 1- or 2-level bitmap because those either scan empty words or cap the
  tick range at 65 536 ticks (≈ $65 at a $0.001 tick).
- **Escrow.** A resting buy holds `notional + makerFee` in tUSDC; a resting
  sell holds the LONG (in the book's own ERC-1155 balance).
- **Matching loop bound.** At most `MAX_FILLS = 32` resting orders are touched
  per call (self-trade cancels count). If the bound stops a *limit* order while
  it still crosses, the unfilled remainder is **not placed** (it is never rested
  into a crossed book, and never charged); `TakerTrade` reports it
  (`filledQty < qty`, `restingOrderId == 0`) and the caller can resend.
- **Self-trade prevention:** if the best resting order is the taker's own, it
  is cancelled (reason `CANCEL_SELF_TRADE`) and refunded, never filled.
- **Post-only** orders revert with `PostOnlyWouldCross` if they would trade.
- `minQty` (default 10 = 0.1 option, owner-settable 1..10 000) stops a level
  being stuffed with dust that costs takers a fill each.

## Fees

`makerFeeBps` and `takerFeeBps` on the premium notional, in tUSDC, each capped
at `MAX_FEE_BPS = 500`. A buyer pays `notional + fee`, a seller receives
`notional − fee`. A resting order keeps the maker rate in force when it was
placed (its escrow was sized on it); a rate change applies to new orders and to
all taker fills from then on.

Rounding: the taker fee is `floor(fillNotional × bps / 1e4)` per fill. The
maker fee on a fill is the *change in the order's escrowed fee*,
`fee(remaining) − fee(remaining − q)`, so over an order's life the maker fees
sum to exactly what it escrowed for the filled part and a resting bid's escrow
is always exactly `notional(rem) + fee(notional(rem))`. Fees accrue in the
contract (`accruedFees`) and anyone can sweep them to `feeRecipient` with
`withdrawFees`.

## Settlement

`ISettlementOracle.settlementPrice(underlying, expiry) → (price 1e8, ready)`.
`KeeperOracle`: the operator (or owner, as a fallback) posts the open of the
Hyperliquid one-minute candle that starts at the expiry, **once**, at or after
the expiry. The owner may `correct` it for `CORRECTION_WINDOW = 10 minutes`
after the first post (the window is not extended by a correction). `ready` is
true only after the window closes, and from then on the price never changes.
The book settles on the first `ready` read and never reads again, so the
correction window is also the delay between expiry and redemption.

Trading (`placeLimit`, `placeMarket`, `cancelReplace`, `mint`, `mintAndSell`,
`buyAndBurn`) stops at `block.timestamp >= expiry`. After the price is ready,
anyone can `settle(series)`; `redeem` also settles lazily. After expiry **anyone**
may cancel any open order; the refund always goes to the order's owner.

## External functions

OptionsBook — admin (owner): `setOwner`, `setOperator`, `setFeeRecipient`,
`setFees(maker, taker)`, `setMinQty`, `setUnderlying(bytes32, bool)`,
`setPaused(bool)`. Operator: `createSeries(underlying, expiry, strike, isCall) → id`.

Users:

| function | what | paused? |
|---|---|---|
| `mint(series, qty)` | pull `qty × K/1e4`, receive qty LONG + qty SHORT | blocked |
| `burnPair(series, qty)` | return qty LONG + qty SHORT for their collateral, any time | works |
| `placeLimit(series, isBuy, price, qty, postOnly) → (orderId, filled)` | take, then rest the rest | blocked |
| `placeMarket(series, isBuy, qty, limitPrice) → (filled, notional, fee)` | IOC with a slippage limit | blocked |
| `cancel(orderId)`, `cancelMany(ids)` | owner any time; anyone after expiry | works |
| `cancelReplace(orderId, newPrice, newQty, postOnly) → (newId, filled)` | same side, escrow netted, back of queue | blocked |
| `mintAndSell(series, qty, price, postOnly) → (orderId, filled)` | write and sell to open, one net transfer | blocked |
| `buyAndBurn(series, qty, maxPrice) → (filled, netPaid)` | buy LONG IOC and burn with own SHORT (close a short) | blocked |
| `settle(series)` | fix price/payoff from the oracle | works |
| `redeem(series) → amount` | burn all own LONG + SHORT of a settled series and pay | works |
| `withdrawFees()` | sweep fees to `feeRecipient` | works |
| `claim()` | collect payouts whose push failed (see below) | works |

ERC-1155: `balanceOf`, `balanceOfBatch`, `setApprovalForAll`,
`isApprovedForAll`, `safeTransferFrom`, `safeBatchTransferFrom`,
`supportsInterface` (0x01ffc9a7, 0xd9b67a26). Transfers to the book itself are
refused (`NoTransferToBook`).

Views: `seriesId(underlying, expiry, strike, isCall)`, `getSeries(id)`,
`liveSeries()`, `seriesCount`, `longId(id)`, `shortId(id)`, `maxPayout(id)`,
`collateralFor(id, qty)`, `bestBid(id)`, `bestAsk(id)` → (price, aggregate qty),
`depth(id, n)` → top n levels each side, `levelOrders(id, isBuy, price, max)`,
`getOrder(orderId)` (owner, side, price, qty, origQty, filledQty, maker bps,
status, escrow), `openOrders(user, id)`, `requiredBalance()`,
`takerQuote(price, qty, isBuy)`, `escrowedUsdc`, `totalLocked`, `accruedFees`,
`totalUnclaimed`, `unclaimed(user)`.

KeeperOracle: `post(underlying, expiry, price)` (operator/owner),
`correct(...)` (owner, inside the window), `settlementPrice`, `pending`
(price, postedAt, finalAt, corrected), `setOwner`, `setOperator`.

BackstopVault: `pushMark(mark, sourceMs)`, `requote(ids)`,
`pushAndRequote(mark, sourceMs, ids)` (operator); `cancelQuotes(ids)`
(operator/owner); `setSigma` (operator/owner); `setParams(halfSpreadBps,
quoteQty, maxPosition, maxCommitted, maxStaleSecs, minTauSecs)`, `setOwner`,
`setOperator` (owner); `deposit(assets)`, `withdraw(shares)`, `harvest(id)`
(anyone); views `fair(id)`, `quoteFor(id)`, `priceAt(isCall, S, K, τ, σ)`,
`nav()`, `committed()`, `trackedSeries()`, `quotes(id)`.

## Events (for the indexer)

`SeriesCreated(seriesId, underlying, expiry, strike, isCall, longId, shortId)`,
`Minted(seriesId, writer, qty, collateral)`, `PairBurned(seriesId, holder, qty, collateral)`,
`OrderPlaced(orderId, seriesId, owner, isBuy, price, qty, makerFeeBps)`,
`OrderFilled(seriesId, makerOrderId, maker, taker, takerIsBuy, price, qty, makerFee, takerFee)`,
`OrderCancelled(orderId, seriesId, owner, remainingQty, reason)` — reason
0 user, 1 self-trade, 2 replaced, 3 cancelled by someone else after expiry,
`TakerTrade(seriesId, taker, isBuy, limitPrice, qty, filledQty, notional, takerFee, restingOrderId)` (one per taker call),
`SeriesSettled(seriesId, settlementPrice, payoffPerOption)`,
`Redeemed(seriesId, holder, longQty, shortQty, amount)`,
`FeesWithdrawn(to, amount)`, `PaymentDeferred(to, amount)`, `Claimed(to, amount)`,
admin: `OwnerSet`, `OperatorSet`, `FeeRecipientSet`, `FeesSet`, `MinQtySet`,
`UnderlyingSet`, `PausedSet`; plus the standard ERC-1155 `TransferSingle`,
`TransferBatch`, `ApprovalForAll` for every position movement (mints from 0,
burns to 0, sell escrow to/from the book address).
KeeperOracle: `PricePosted(underlying, expiry, price, finalAt)`,
`PriceCorrected(underlying, expiry, old, new)`.
BackstopVault: `MarkPushed`, `SigmaSet`, `ParamsSet`,
`Quoted(seriesId, fair, bid, bidQty, ask, askQty)`, `Harvested`, `Deposit`, `Withdraw`.

## Invariants (all fuzzed in `BookInvariant.t.sol`)

1. `tUSDC.balanceOf(book) == escrowedUsdc + totalLocked + accruedFees + totalUnclaimed`
   — with **equality**, after every call.
2. `escrowedUsdc == Σ open buy orders' (notional(rem) + makerFee(rem))`.
3. `book's LONG balance == Σ open sell orders' remaining qty`; the book never holds SHORT.
4. `longSupply / shortSupply == Σ holders' balances` (incl. the book's escrow);
   before settlement `longSupply == shortSupply`.
5. `totalLocked == Σ series (long × payoffUnit + short × (unit − payoffUnit))`
   for settled series and `Σ supply × unit` for open ones, and `payoffUnit ≤ unit`.
6. The book is never crossed (`bestBid < bestAsk` whenever both exist).
7. Σ payouts (redeem + burnPair + buyAndBurn) ≤ Σ collateral locked, and after a
   full wind-down (cancel all, settle, everyone redeems) they are **equal**,
   `totalLocked == escrowedUsdc == 0`, and only fees (+ unclaimed) remain.

The handler drives 15 actions (mint, limit ×2 weight, IOC, mintAndSell,
buyAndBurn, cancel, cancelReplace, burnPair, ERC-1155 transfers, fee changes,
fee sweeps, expire-and-settle at prices including exactly K, past the call cap
and deep put, redeem, cancel-after-expiry by a stranger) with
`fail-on-revert = true`: 64 runs × 120 calls, 0 reverts.

Safety mechanics: checks-effects-interactions throughout — every trading call
does all state changes first and then settles in one place (`_finish`): one net
tUSDC transfer with the caller, maker payouts, then the receiver hook.
`nonReentrant` on every external path that moves tokens (a re-entering
receiver hook is tested). The oracle is immutable in the book. The owner cannot
move user funds; it can pause new business, set capped fees, and allow
underlyings.

## Gas

Execution gas of the call (no 21k intrinsic, no calldata), with the book's and
the token's storage cooled first — what a fresh transaction pays.
Fees on (10 / 30 bps). From `forge test --match-contract BookGas -vv`:

| path | gas |
|---|---|
| `mint` (first write of the series by this user) | 189 816 |
| `placeLimit` resting sell, **new** price level (first level in the series: sets all 4 bitmap words) | 303 188 |
| `placeLimit` resting sell, existing level | 133 475 |
| `placeLimit` resting buy, new price level | 308 734 |
| `cancel` (buy, refunds tUSDC) | 97 352 |
| taker buy filling **1** resting order | 173 065 |
| taker buy filling **10** orders (10 makers, 10 levels) | 643 676 |
| taker buy filling **32** orders (the bound; 32 makers, 32 levels) | 1 797 677 |
| `cancelReplace` (sell) | 179 073 |
| `mintAndSell` (fills a resting bid) | 205 347 |
| `burnPair` | 78 959 |
| `settle` | 42 996 |
| `redeem` (LONG only / LONG + SHORT) | 71 537 / 80 185 |
| vault `requote`, 1 series, first time (write + 2 orders) | 847 281 |
| vault `requote`, 1 series, replace both quotes | 558 586 |

`forge test --gas-report` (book tests, all cases, warm and cold mixed):
placeLimit median 184 856 / max 1 041 376; placeMarket median 160 275 / max
1 797 677; cancel median 97 352; mint median 121 404; redeem median 71 545;
burnPair 78 959; settle median 32 593.

A new level close to existing ones costs much less than the first-ever level
(only the level-0 word is new). The per-order cost is dominated by new storage:
the order (2 slots), the level slot, and the per-user open-order list (used by
`openOrders`).

## BackstopVault (phase 2)

An ordinary book participant (no special access, same fees and priority).
The operator relays the Hyperliquid mark (1e8, monotonic by Hyperliquid time,
like RopeMarket) and σ (wad per √second, same bounds as `RopeMarket.setSigma`).
`requote(ids)` for each series: cancels the vault's previous quotes, burns any
LONG+SHORT pairs it holds, prices with Black–Scholes (r = 0) at the mark, and
posts `bid = floor_tick(fair − h)`, `ask = ceil_tick(fair + h)` (ask capped at
the max payout), `h = max(fair × halfSpreadBps, one tick)` (default 1%), size
`quoteQty` (default 1 option). The ask sells LONG it already holds first and
mints only the rest. Caps: net position per series ≤ `maxPosition`; tUSDC
committed (writer collateral for its SHORT + its bid escrow) ≤ `maxCommitted`;
mark older than `maxStaleSecs` (default 10 s) is refused; no quotes in the last
`minTauSecs` (60 s) before expiry. `harvest(id)` after expiry pulls quotes,
settles, redeems and untracks. LPs deposit/withdraw at NAV (idle + bid escrow +
positions at model value, settled series at payoff), withdrawals paid from idle
only, fresh mark required when anything is tracked. The vault accepts ERC-1155
only from the book on transfers it started itself, so nobody can push tokens
into it.

Pricing: the book's call is capped at K, which is a K/2K call spread, so the
vault values it as `C(K) − C(2K)`, not `min(C(K), K)`; the put is `C − S + K`.
`N(·)` is the A&S 7.1.26 erf RopeMarket uses. Tests compare against a Python
reference (exact `math.erf`) within 2e-5 USD, including a 1-year 300%-vol case
where the cap matters (capped call 2.08 vs uncapped 34.66).

## Known limitations / review points

- **Contract size.** OptionsBook runtime is 24 243 bytes, 333 bytes under the
  EIP-170 limit (24 576) at optimizer runs 200. It deploys (checked on anvil),
  but the next feature needs room: moving `depth` / `levelOrders` /
  `liveSeries` into a separate lens is the obvious split.
- **Oracle trust.** v1 settlement is a keeper post + 10-minute owner
  correction window. There is no automatic fallback if no price is ever
  posted (the owner can post late; pairs can always be burned, but a LONG-only
  or SHORT-only holder waits for a price).
- **Unplaced remainder.** A limit order stopped by the 32-fill bound while still
  marketable does not rest; the caller must resend (reported in `TakerTrade`).
- **Receiver hook.** LONG delivered to a resting *buy* when it fills, and LONG
  returned from a cancelled *sell*, are credited without `onERC1155Received`
  (a contract maker must cope with balances arriving without a callback).
  User transfers, mints, and LONG bought as a taker run the hook (once per call,
  with the aggregate qty, after all state changes).
- **Push with pull fallback.** Maker payouts and expiry-cancel refunds to a third
  party are pushed with a low-level call; if the transfer fails (e.g. a
  blocklisted address on a real stablecoin) the amount goes to `unclaimed` and
  `claim()` collects it. tUSDC never fails, but this keeps one bad maker from
  blocking every taker once real USDC is used.
- **Fee rounding** is floor everywhere (in the payer's favour); tiny orders can
  pay zero fee (hence `minQty`).
- **Settlement rounding** floors the payoff to $0.0001 per option, in SHORT's favour.
- `liveSeries()` scans every series ever created; fine for a view, but an indexer
  should use `SeriesCreated`.
- **Vault:** resting quotes do not expire on their own — the keeper must requote
  or `cancelQuotes` when the mark moves or the feed stalls, or quotes can be
  picked off. `requote` costs ~0.55–0.85M gas per series (two Black–Scholes
  evaluations for the capped call, cancels, mint, two orders), so batch a few
  series per transaction. NAV uses the model price, so deposits/withdrawals are
  only as fair as the mark and σ; there is no deposit/withdraw spread. The
  "committed" cap counts writer collateral and bid escrow, not LONG already
  bought (that is bounded by `maxPosition` per series and `MAX_SERIES = 32`).
- European, cash-settled, no early exercise, no portfolio margin, no partial
  collateral — by design for v1.
- Not audited.

## Deploy

```
COLLATERAL=0x… OPERATOR=0x… FEE_RECIPIENT=0x… [MAKER_FEE_BPS=… TAKER_FEE_BPS=… DEPLOY_VAULT=true SIGMA_WAD=…] \
forge script contracts/script/DeployBook.s.sol --rpc-url <rpc> --broadcast --account <keystore>
```

The broadcaster becomes the owner of all three contracts; OPERATOR is set as the
keeper on the oracle, the book and the vault. The script reads no key material;
signing is whatever the forge CLI is given. Smoke-tested only against a local
anvil (deploy, create series, `mintAndSell`, solvency check). It has not been run
against any live network.
