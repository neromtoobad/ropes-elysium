// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KeeperOracle} from "../../src/book/KeeperOracle.sol";

contract KeeperOracleTest is Test {
    KeeperOracle o;
    address constant OP = address(0x0FE);
    bytes32 constant HYPE = "HYPE";
    uint64 expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        expiry = uint64(block.timestamp) + 60;
        o = new KeeperOracle(OP);
    }

    function test_post_once_after_expiry_final_after_the_window() public {
        vm.prank(OP);
        vm.expectRevert(KeeperOracle.TooEarly.selector);
        o.post(HYPE, expiry, 40e8);

        vm.warp(expiry);
        vm.prank(address(0xBAD));
        vm.expectRevert(KeeperOracle.NotOperator.selector);
        o.post(HYPE, expiry, 40e8);

        vm.prank(OP);
        vm.expectRevert(KeeperOracle.BadPrice.selector);
        o.post(HYPE, expiry, 0);

        vm.prank(OP);
        o.post(HYPE, expiry, 40e8);
        (uint128 p, bool ready) = o.settlementPrice(HYPE, expiry);
        assertEq(p, 40e8);
        assertFalse(ready);
        (uint128 pp, uint64 postedAt, uint64 finalAt, bool corrected) = o.pending(HYPE, expiry);
        assertEq(pp, 40e8);
        assertEq(postedAt, expiry);
        assertEq(finalAt, expiry + 600);
        assertFalse(corrected);

        vm.prank(OP);
        vm.expectRevert(KeeperOracle.AlreadyPosted.selector);
        o.post(HYPE, expiry, 41e8);

        vm.warp(expiry + 599);
        (, ready) = o.settlementPrice(HYPE, expiry);
        assertFalse(ready);
        vm.warp(expiry + 600);
        (p, ready) = o.settlementPrice(HYPE, expiry);
        assertTrue(ready);
        assertEq(p, 40e8);

        // other keys are independent
        (p, ready) = o.settlementPrice(HYPE, expiry + 60);
        assertEq(p, 0);
        assertFalse(ready);
        (p, ready) = o.settlementPrice("BTC", expiry);
        assertFalse(ready);
    }

    function test_owner_corrects_only_inside_the_window() public {
        vm.warp(expiry);
        vm.expectRevert(KeeperOracle.NotPosted.selector);
        o.correct(HYPE, expiry, 41e8);

        vm.prank(OP);
        o.post(HYPE, expiry, 40e8);

        vm.prank(OP);
        vm.expectRevert(KeeperOracle.NotOwner.selector);
        o.correct(HYPE, expiry, 41e8);

        vm.warp(expiry + 300);
        o.correct(HYPE, expiry, 41e8);
        (uint128 p, bool ready) = o.settlementPrice(HYPE, expiry);
        assertEq(p, 41e8);
        assertFalse(ready);

        // the window is not extended by a correction
        vm.warp(expiry + 600);
        vm.expectRevert(KeeperOracle.WindowClosed.selector);
        o.correct(HYPE, expiry, 42e8);
        (p, ready) = o.settlementPrice(HYPE, expiry);
        assertEq(p, 41e8);
        assertTrue(ready);
    }

    function test_owner_can_post_as_a_fallback() public {
        vm.warp(expiry + 3600);
        o.post(HYPE, expiry, 40e8);
        (uint128 p,) = o.settlementPrice(HYPE, expiry);
        assertEq(p, 40e8);
    }

    function test_roles() public {
        vm.prank(OP);
        vm.expectRevert(KeeperOracle.NotOwner.selector);
        o.setOperator(OP);
        o.setOperator(address(0x1234));
        assertEq(o.operator(), address(0x1234));
        vm.expectRevert(KeeperOracle.BadParam.selector);
        o.setOwner(address(0));
        o.setOwner(OP);
        assertEq(o.owner(), OP);
    }
}
