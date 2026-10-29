# Contracts & addresses
> Everything deployed, where it lives, and how to read it.

**Network:** Elysium testnet · chain ID `99801` · RPC `https://testnet-rpc.elysium.kinetiq.xyz` · explorer [elysium.kinetiq.xyz/testnet-explorer](https://elysium.kinetiq.xyz/testnet-explorer). The first market's sources are verified on the explorer; the replacement's verification is pending (the explorer now asks for a partner access code). Its source is `contracts/src/RopeMarket.sol` at commit `01dbbdf`.

| Contract | Address | Role |
|---|---|---|
| `RopeMarket` (HYPE) | [`0xB425550958863472D351F17575B6b8F0C3a525D6`](https://elysium.kinetiq.xyz/testnet-explorer/address/0xB425550958863472D351F17575B6b8F0C3a525D6) | pricing, rounds, trades, settlement, redemption, house vault |
| `ArenaRegistry` | [`0x0D8b61252d631D3483DD10C5725ecf9F7f314262`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x0D8b61252d631D3483DD10C5725ecf9F7f314262) | public scoreboard, settled inside `RopeMarket.settle` |
| `MockUSDC` (tUSDC) | [`0x46397dA50c05AfA43cBfcA712215eD1E02A9F57d`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x46397dA50c05AfA43cBfcA712215eD1E02A9F57d) | test dollars, 6 decimals, open mint (10,000 per call) |

Every round before 5,151 ran on the first market, [`0x62C4b522Bf76422E77CEdA22E94e0540f9422d1D`](https://elysium.kinetiq.xyz/testnet-explorer/address/0x62C4b522Bf76422E77CEdA22E94e0540f9422d1D) (scoreboard [`0xDBd28A7AacD7228edDef44c177C195878DfCa858`](https://elysium.kinetiq.xyz/testnet-explorer/address/0xDBd28A7AacD7228edDef44c177C195878DfCa858)). It was replaced on Oct 29 2026 to fix a vault timing issue reported to us: deposits are now priced at the vault's best case and withdrawals at its worst, so a deposit timed around the bell can't take value from other depositors. Round numbers carry on from 5,151.

## Key functions

```solidity
// pricing (anyone)
function fairUpAt(uint256 s, uint256 k, uint256 tau, uint256 sigma) external pure returns (uint256);
function quote(uint64 id) external view returns (uint256 yesBid, uint256 yesAsk, uint256 fair);

// rounds (operator)
function openRound(uint64 opensAt, uint64 expiresAt, uint128 strikeMark, uint64 sourceMs) external returns (uint64);
function settle(uint64 id, uint128 closeMark, uint64 sourceMs) external;

// trades (operator, this version)
function buy(uint64 id, uint8 side, uint256 budget, uint256 maxPrice, uint128 mark, uint64 sourceMs) external returns (uint256 shares, uint256 cost, uint256 price);
function sell(uint64 id, uint8 side, uint256 shares, uint256 minPrice, uint128 mark, uint64 sourceMs) external returns (uint256 proceeds, uint256 price);

// anyone
function redeem(uint64 id) external returns (uint256);
function voidStale(uint64 id) external;
function deposit(uint256 assets) external returns (uint256 shares);
function withdraw(uint256 shares) external returns (uint256 assets);
```

## Events

`MarkPushed(mark, sourceMs)` · `RoundOpened(roundId, opensAt, expiresAt, strike, cap)` · `Traded(roundId, trader, side, isBuy, shares, price, amount)` · `RoundSettled(roundId, close, winner, voided)` · `Redeemed(roundId, holder, amount)`

## Code

[github.com/neromtoobad/ropes-elysium](https://github.com/neromtoobad/ropes-elysium): contracts in `contracts/src`, 37 tests in `contracts/test` (`forge test`).
