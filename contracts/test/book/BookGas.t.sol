// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";
import {BookBase} from "./BookBase.sol";

/// Gas for the main paths, as a fresh transaction would see it: storage of
/// the book and the token is cooled before each measured call. Numbers are
/// execution gas of the call (no 21k intrinsic, no calldata).
/// Run: forge test --match-contract BookGas -vv
contract BookGasTest is BookBase {
    uint256 constant P = 1_000_000;

    function _cool() internal {
        vm.cool(address(book));
        vm.cool(address(usd));
    }

    function _log(string memory what) internal view {
        console.log(what, vm.lastCallGas().gasTotalUsed);
    }

    function test_gas_table() public {
        book.setFees(10, 30);

        _cool();
        vm.prank(ALICE);
        book.mint(callId, 1000);
        _log("mint (first write of the series by this user)");

        _cool();
        vm.prank(ALICE);
        book.placeLimit(callId, false, 2 * P, 100, false);
        _log("placeLimit resting sell, new price level");

        _cool();
        vm.prank(ALICE);
        book.placeLimit(callId, false, 2 * P, 100, false);
        _log("placeLimit resting sell, existing level");

        _cool();
        vm.prank(BOB);
        (uint256 bid,) = book.placeLimit(callId, true, P / 2, 100, false);
        _log("placeLimit resting buy, new price level");

        _cool();
        vm.prank(BOB);
        book.cancel(bid);
        _log("cancel (buy, refunds tUSDC)");

        _cool();
        vm.prank(BOB);
        book.placeMarket(callId, true, 100, 2 * P);
        _log("taker buy, fills 1 resting order");

        for (uint256 i; i < 10; ++i) {
            address m = address(uint160(0xBEEF00 + i));
            _fund(m, 10_000e6);
            _mint(m, callId, 100);
            vm.prank(m);
            book.placeLimit(callId, false, 3 * P + i * 10_000, 100, false);
        }
        _cool();
        vm.prank(CAROL);
        book.placeMarket(callId, true, 1000, 4 * P);
        _log("taker buy, fills 10 orders (10 makers, 10 levels)");

        vm.prank(ALICE);
        (uint256 ask,) = book.placeLimit(callId, false, 5 * P, 100, false);
        _cool();
        vm.prank(ALICE);
        book.cancelReplace(ask, 5 * P - 10_000, 100, true);
        _log("cancelReplace (sell)");

        vm.prank(DAVE);
        book.placeLimit(callId, true, P, 100, false);
        _cool();
        vm.prank(BOB);
        book.mintAndSell(callId, 100, P, false);
        _log("mintAndSell (fills a resting bid)");

        _cool();
        vm.prank(ALICE);
        book.burnPair(callId, 100);
        _log("burnPair");

        _settleAt(45_00000000);
        _cool();
        book.settle(callId);
        _log("settle");

        _cool();
        vm.prank(CAROL);
        book.redeem(callId);
        _log("redeem (LONG only)");

        _cool();
        vm.prank(ALICE);
        book.redeem(callId);
        _log("redeem (LONG + SHORT)");
    }

    /// The bound: 32 fills is the most one call can do.
    function test_gas_worst_case_32_fills() public {
        for (uint256 i; i < 32; ++i) {
            address m = address(uint160(0xBEEF00 + i));
            _fund(m, 10_000e6);
            _mint(m, callId, 10);
            vm.prank(m);
            book.placeLimit(callId, false, P + i * 1000, 10, false);
        }
        _cool();
        vm.prank(CAROL);
        book.placeMarket(callId, true, 1000, 2 * P);
        _log("taker buy, fills 32 orders (32 makers, 32 levels)");
    }
}
