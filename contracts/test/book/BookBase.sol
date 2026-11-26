// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OptionsBook} from "../../src/book/OptionsBook.sol";
import {KeeperOracle} from "../../src/book/KeeperOracle.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

abstract contract BookBase is Test {
    OptionsBook book;
    KeeperOracle oracle;
    MockUSDC usd;

    address constant OP = address(0x0FE);
    address constant FEES = address(0xFEE5);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant CAROL = address(0xCA201);
    address constant DAVE = address(0xDA7E);

    bytes32 constant HYPE = "HYPE";
    uint64 constant K = 40_00000000; // $40.00, 1e8
    uint256 constant UNIT = 400_000; // collateral per 0.01 option at K = $40
    uint256 constant ONE = 100; // qty of one option

    uint64 t0;
    uint64 expiry;
    uint256 callId;
    uint256 putId;

    function setUp() public virtual {
        vm.warp(1_800_000_000); // a whole minute
        t0 = uint64(block.timestamp);
        expiry = t0 + 1 hours;
        usd = new MockUSDC();
        oracle = new KeeperOracle(OP);
        book = new OptionsBook(address(usd), address(oracle), OP, FEES);
        vm.startPrank(OP);
        callId = book.createSeries(HYPE, expiry, K, true);
        putId = book.createSeries(HYPE, expiry, K, false);
        vm.stopPrank();
        address[4] memory users = [ALICE, BOB, CAROL, DAVE];
        for (uint256 i; i < users.length; ++i) {
            _fund(users[i], 100_000e6);
        }
    }

    function _fund(address who, uint256 amount) internal {
        for (uint256 minted; minted < amount; minted += 10_000e6) {
            usd.mint(who, 10_000e6);
        }
        vm.prank(who);
        usd.approve(address(book), type(uint256).max);
    }

    function _long(uint256 id) internal pure returns (uint256) {
        return id << 1;
    }

    function _short(uint256 id) internal pure returns (uint256) {
        return (id << 1) | 1;
    }

    function _mint(address who, uint256 id, uint256 qty) internal {
        vm.prank(who);
        book.mint(id, qty);
    }

    function _limit(address who, uint256 id, bool isBuy, uint256 price, uint256 qty)
        internal
        returns (uint256 oid, uint256 filled)
    {
        vm.prank(who);
        (oid, filled) = book.placeLimit(id, isBuy, price, qty, false);
    }

    function _sell(address who, uint256 id, uint256 price, uint256 qty) internal returns (uint256 oid) {
        _mint(who, id, qty);
        (oid,) = _limit(who, id, false, price, qty);
    }

    function _settleAt(uint128 price) internal {
        vm.warp(expiry);
        vm.prank(OP);
        oracle.post(HYPE, expiry, price);
        vm.warp(expiry + oracle.CORRECTION_WINDOW());
    }

    function _solvent() internal view {
        assertEq(usd.balanceOf(address(book)), book.requiredBalance(), "balance == escrow + locked + fees + unclaimed");
    }
}
