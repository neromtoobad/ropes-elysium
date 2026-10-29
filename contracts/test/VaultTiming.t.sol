// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RopeMarket} from "../src/RopeMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

/// Reported by email Oct 28: LP shares were priced at the worst-case NAV and
/// settlement only ever releases reserve, so a deposit timed around the bell
/// could be withdrawn for more than it put in (4,119 on 40,000 in one round).
/// Deposits are now priced at the best case, withdrawals at the worst.
contract VaultTimingTest is Test {
    RopeMarket m;
    MockUSDC usd;
    ArenaRegistry reg;

    address constant OP = address(0x0FE);
    address constant LP = address(0x1B);
    address constant LATE = address(0x1A7E);

    uint8 constant UP = 0;
    uint256 constant SIGMA = 193_649_167_310_370;
    uint128 constant K = 95_00000000;
    uint64 t0;

    function setUp() public {
        vm.warp(1_800_000_000);
        t0 = uint64(block.timestamp);
        usd = new MockUSDC();
        m = new RopeMarket(address(usd), bytes32("HYPE"), OP, SIGMA);
        reg = new ArenaRegistry(address(m));
        m.setHook(address(reg));

        for (uint256 i; i < 4; ++i) usd.mint(LP, 10_000e6);
        vm.startPrank(LP);
        usd.approve(address(m), type(uint256).max);
        m.deposit(40_000e6);
        vm.stopPrank();

        usd.mint(OP, 10_000e6);
        vm.prank(OP);
        usd.approve(address(m), type(uint256).max);

        for (uint256 i; i < 4; ++i) usd.mint(LATE, 10_000e6);
        vm.prank(LATE);
        usd.approve(address(m), type(uint256).max);
    }

    function _ms(uint256 t) internal pure returns (uint64) {
        return uint64(t * 1000);
    }

    /// Deposit after the bell, once the close is public and the reserved side
    /// lost, then withdraw straight after settle.
    function test_deposit_between_bell_and_settle_cannot_profit() public {
        vm.prank(OP);
        uint64 id = m.openRound(t0, t0 + 60, K, _ms(t0));
        vm.prank(OP);
        m.buy(id, UP, 4_000e6, 900_000, K, _ms(t0) + 1); // ~7.8k UP shares reserved

        vm.warp(t0 + 61); // bell has rung; Hyperliquid's close (below K) is public
        vm.prank(LATE);
        uint256 shares = m.deposit(40_000e6);

        vm.prank(OP);
        m.settle(id, K - 1_000_000, _ms(t0 + 60) + 300); // DOWN wins: UP reserve released

        vm.prank(LATE);
        uint256 out = m.withdraw(shares);
        assertLe(out, 40_000e6, "a deposit timed around the bell must not profit");
    }

    /// Deposit mid-round, before the bell: the late depositor still can't
    /// gain, and the LP who carried the round keeps the losing side's premium.
    function test_deposit_during_round_does_not_dilute_lp() public {
        uint256 lpBefore = m.depositNav();
        vm.prank(OP);
        uint64 id = m.openRound(t0, t0 + 60, K, _ms(t0));
        vm.prank(OP);
        m.buy(id, UP, 4_000e6, 900_000, K, _ms(t0) + 1);

        vm.prank(LATE);
        uint256 shares = m.deposit(40_000e6);
        vm.warp(t0 + 61);
        vm.prank(OP);
        m.settle(id, K - 1_000_000, _ms(t0 + 60) + 300);

        vm.prank(LATE);
        uint256 out = m.withdraw(shares);
        assertLe(out, 40_000e6, "late depositor gets back at most what they paid");
        assertGe(m.freeBalance(), lpBefore + 4_000e6 - 1, "the LP keeps the whole premium the loser paid");
    }

    /// Both sides bought: a void refunds more than either side's payout. The
    /// reserve must already cover that, so voiding never raises liability.
    function test_void_never_raises_liability() public {
        vm.prank(OP);
        uint64 id = m.openRound(t0, t0 + 60, K, _ms(t0));
        vm.startPrank(OP);
        m.buy(id, UP, 2_000e6, 900_000, K, _ms(t0) + 1);
        m.buy(id, 1, 2_000e6, 900_000, K, _ms(t0) + 2);
        vm.stopPrank();

        uint256 before = m.liability();
        vm.warp(t0 + 60 + 121);
        m.voidStale(id);
        assertLe(m.liability(), before, "a void releases or keeps the reserve, never adds to it");
        assertEq(m.openSlack(), 0, "no open rounds left");
    }

    /// The replacement market carries on the old round numbers, once.
    function test_start_at_continues_numbering_once() public {
        m.startAt(5_100);
        assertEq(m.firstRound(), 5_101);
        vm.prank(OP);
        uint64 id = m.openRound(t0, t0 + 60, K, _ms(t0));
        assertEq(id, 5_101);
        vm.expectRevert(RopeMarket.BadParam.selector);
        m.startAt(9_000);
    }

    function test_start_at_is_owner_only() public {
        vm.prank(LATE);
        vm.expectRevert(RopeMarket.NotOwner.selector);
        m.startAt(5_100);
    }
}
