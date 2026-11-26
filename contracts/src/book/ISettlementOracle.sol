// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Where the options book learns the price an expiry settles at.
interface ISettlementOracle {
    /// The settlement price of `underlying` at `expiry` (unix seconds), scaled
    /// 1e8 like every Hyperliquid mark in ROPES. `ready` is true only once the
    /// price is FINAL: the book settles on the first `ready` read and never
    /// reads again, so an oracle must not report `ready` while a price can
    /// still change.
    function settlementPrice(bytes32 underlying, uint64 expiry) external view returns (uint128 price, bool ready);
}
