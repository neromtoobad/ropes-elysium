// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RopeMarket} from "../src/RopeMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

contract RopeMarketTest is Test {
    RopeMarket m;
    MockUSDC usd;
    ArenaRegistry reg;

    address constant OP = address(0x0FE);
    address constant LP = address(0x1B);
    address constant STRANGER = address(0xDEAD);

    uint256 constant ONE = 1e6;
    uint8 constant UP = 0;
    uint8 constant DOWN = 1;

    // HYPE-ish: 0.15% one-minute move → σ per √s = 0.0015/√60
    uint256 constant SIGMA = 193_649_167_310_370; // 1.936e14 wad
    uint128 constant K = 95_00000000; // $95.00, 1e8

    uint64 t0;

    function setUp() public {
        vm.warp(1_800_000_000);
        t0 = uint64(block.timestamp);
        usd = new MockUSDC();
        m = new RopeMarket(address(usd), bytes32("HYPE"), OP, SIGMA);
        reg = new ArenaRegistry(address(m));
        m.setHook(address(reg));

        // Seed the house vault: 40k → each round may risk 10k.
        for (uint256 i; i < 4; ++i) usd.mint(LP, 10_000e6);
        vm.startPrank(LP);
        usd.approve(address(m), type(uint256).max);
        m.deposit(40_000e6);
        vm.stopPrank();

        for (uint256 i; i < 2; ++i) usd.mint(OP, 10_000e6);
        vm.prank(OP);
        usd.approve(address(m), type(uint256).max);
    }

    function _ms(uint256 t) internal pure returns (uint64) {
        return uint64(t * 1000);
    }

    function _open() internal returns (uint64 id) {
        vm.prank(OP);
        id = m.openRound(t0, t0 + 60, K, _ms(t0));
    }

    /* -------------------------------------------------------------- pricing */

    function _near(uint256 a, uint256 b, uint256 tol, string memory why) internal pure {
        assertApproxEqAbs(a, b, tol, why);
    }

    function test_phi_matches_reference_values() public view {
        // tau = 1, sigma = ln(S/K) ⇒ d = 1  ⇒ Φ(1) = 0.841345
        uint256 s = 101_00000000;
        uint256 k = 100_00000000;
        uint256 lnr = 9_950_330_853_168_083; // ln(1.01), wad
        _near(m.fairUpAt(s, k, 1, lnr), 841_345, 2, "phi(1)");
        // d = 2: Φ(2) = 0.977250
        _near(m.fairUpAt(s, k, 1, lnr / 2), 977_250, 2, "phi(2)");
        // d = 0.5: Φ(0.5) = 0.691462
        _near(m.fairUpAt(s, k, 1, lnr * 2), 691_462, 2, "phi(0.5)");
        // mirror: S < K, d = -1 ⇒ 0.158655
        _near(m.fairUpAt(k, s, 1, lnr), 158_655, 2, "phi(-1)");
        // at the strike: a coin
        assertEq(m.fairUpAt(k, k, 60, SIGMA), 500_000);
        // the bell: no time left, it is just a comparison
        assertEq(m.fairUpAt(s, k, 0, SIGMA), ONE);
        assertEq(m.fairUpAt(k, s, 0, SIGMA), 0);
        // far in the money: pinned, not overflowing
        assertEq(m.fairUpAt(200_00000000, k, 60, SIGMA), ONE);
    }

    function test_quote_at_the_open_is_a_coin_with_a_spread() public {
        uint64 id = _open();
        (uint256 bid, uint256 ask, uint256 fair) = m.quote(id);
        assertEq(fair, 500_000);
        assertEq(ask, 510_000);
        assertEq(bid, 490_000);
        (uint256 downBuy, uint256 downSell) = m.priceOf(id, DOWN);
        assertEq(downBuy, 510_000);
        assertEq(downSell, 490_000);
    }

    function test_quote_moves_with_the_mark() public {
        uint64 id = _open();
        vm.warp(t0 + 30);
        vm.prank(OP);
        m.pushMark(95_14250000, _ms(t0 + 30)); // +0.15% with 30s left
        (,, uint256 fair) = m.quote(id);
        // d = ln(1.0015)/(σ√30) ≈ 1.414 ⇒ Φ ≈ 0.9213
        _near(fair, 921_300, 1_500, "half a minute, one sigma-minute up");
    }

    function test_spread_doubles_late() public {
        uint64 id = _open();
        vm.warp(t0 + 55);
        vm.prank(OP);
        m.pushMark(K, _ms(t0 + 55));
        (uint256 bid, uint256 ask,) = m.quote(id);
        assertEq(ask - bid, 40_000);
    }

    /* ------------------------------------------------------------ the loop */

    function test_buy_win_redeem_pays_one_over_p() public {
        uint64 id = _open();
        vm.prank(OP);
        (uint256 shares, uint256 cost, uint256 price) = m.buy(id, UP, 10e6, 900_000, K, _ms(t0) + 1);
        assertEq(price, 510_000);
        assertEq(shares, (10e6 * ONE) / 510_000); // 19.607843 shares
        assertLe(cost, 10e6);

        vm.warp(t0 + 60);
        vm.prank(OP);
        m.settle(id, K + 1_000_000, _ms(t0 + 60) + 300);
        assertEq(m.roundStatus(id), 2);

        uint256 before = usd.balanceOf(OP);
        vm.prank(OP);
        uint256 paid = m.redeem(id);
        assertEq(paid, shares);
        assertEq(usd.balanceOf(OP) - before, shares);
        assertEq(m.liability(), 0, "nothing owed once redeemed");
    }

    function test_loser_redeems_nothing() public {
        uint64 id = _open();
        vm.prank(OP);
        m.buy(id, DOWN, 10e6, 900_000, K, _ms(t0) + 1);
        vm.warp(t0 + 60);
        vm.prank(OP);
        m.settle(id, K + 1, _ms(t0 + 60));
        vm.prank(OP);
        assertEq(m.redeem(id), 0);
    }

    function test_bail_sells_at_the_live_bid() public {
        uint64 id = _open();
        vm.prank(OP);
        (uint256 shares,,) = m.buy(id, UP, 10e6, 900_000, K, _ms(t0) + 1);

        // The price runs against us; we jump.
        vm.warp(t0 + 20);
        uint128 down = 94_90000000; // −0.105%
        (,, uint256 fairBefore) = m.quote(id);
        assertEq(fairBefore, 500_000);
        vm.prank(OP);
        (uint256 proceeds, uint256 price) = m.sell(id, UP, shares, 0, down, _ms(t0 + 20));
        (,, uint256 fairNow) = m.quote(id);
        assertEq(price, fairNow - 10_000, "sold at fair minus half the spread");
        assertEq(proceeds, (shares * price) / ONE);
        assertLt(proceeds, 10e6, "bailing a losing ride keeps part of the stake");
        (uint256 up,) = m.sharesOf(id, OP);
        assertEq(up, 0);
    }

    function test_settles_the_scoreboard_in_the_same_transaction() public {
        uint64 id = _open();
        bytes32 runId = keccak256("ada");
        reg.openRound(address(m), id, bytes32(uint256(id)));
        reg.enter(address(m), id, runId, UP, 19_607_843, 0, 10e6);

        vm.warp(t0 + 60);
        vm.prank(OP);
        m.settle(id, K - 1, _ms(t0 + 60)); // DOWN wins
        assertEq(reg.statusOf(runId), 2, "eliminated by the market's own settle");
        (,,, bool settled,, uint8 winner) = reg.rounds(reg.roundKey(address(m), id));
        assertTrue(settled);
        assertEq(winner, DOWN);
    }

    /* ---------------------------------------------------------- the guards */

    function test_only_the_operator_trades_and_relays() public {
        uint64 id = _open();
        vm.startPrank(STRANGER);
        vm.expectRevert(RopeMarket.NotOperator.selector);
        m.buy(id, UP, 1e6, 900_000, K, _ms(t0) + 1);
        vm.expectRevert(RopeMarket.NotOperator.selector);
        m.pushMark(K, _ms(t0) + 5);
        vm.expectRevert(RopeMarket.NotOperator.selector);
        m.openRound(t0, t0 + 60, K, _ms(t0));
        vm.stopPrank();
    }

    function test_strike_must_be_sampled_at_the_open() public {
        vm.prank(OP);
        vm.expectRevert(RopeMarket.BadMark.selector);
        m.openRound(t0, t0 + 60, K, _ms(t0) - 6_000); // 6s stale
    }

    function test_no_buying_in_the_last_seconds() public {
        uint64 id = _open();
        vm.warp(t0 + 56);
        vm.prank(OP);
        vm.expectRevert(RopeMarket.BuyLocked.selector);
        m.buy(id, UP, 1e6, 900_000, K, _ms(t0 + 56));
    }

    function test_stale_mark_blocks_trading() public {
        uint64 id = _open();
        vm.warp(t0 + 10);
        vm.prank(OP);
        vm.expectRevert(RopeMarket.StaleMark.selector);
        // carries an OLDER mark, which is ignored — so the stored one is 10s old
        m.buy(id, UP, 1e6, 900_000, K, _ms(t0) - 1);
    }

    function test_price_limit_respected() public {
        uint64 id = _open();
        vm.prank(OP);
        vm.expectRevert(abi.encodeWithSelector(RopeMarket.PriceLimit.selector, 510_000));
        m.buy(id, UP, 1e6, 500_000, K, _ms(t0) + 1);
    }

    function test_round_cap_bounds_the_vault_loss() public {
        uint64 id = _open();
        (,,,,,,,, uint128 cap,,) = m.rounds(id);
        assertEq(cap, 10_000e6);
        vm.prank(OP);
        vm.expectRevert(RopeMarket.OverCap.selector);
        m.buy(id, UP, 6_000e6, 900_000, K, _ms(t0) + 1); // 11.7k shares > 10k cap
    }

    function test_late_close_voids_and_refunds_the_premium() public {
        uint64 id = _open();
        vm.prank(OP);
        (, uint256 cost,) = m.buy(id, UP, 10e6, 900_000, K, _ms(t0) + 1);
        vm.warp(t0 + 90);
        vm.prank(OP);
        m.settle(id, K + 5, _ms(t0 + 90)); // sampled 30s after the bell: not the bell's price
        assertEq(m.roundStatus(id), 3, "voided, not settled on a late price");
        vm.prank(OP);
        assertEq(m.redeem(id), cost, "a void refunds exactly what was paid");
        assertEq(m.liability(), 0);
    }

    function test_void_refund_follows_a_partial_bail() public {
        uint64 id = _open();
        vm.prank(OP);
        (uint256 shares, uint256 cost,) = m.buy(id, DOWN, 10e6, 900_000, K, _ms(t0) + 1);
        vm.warp(t0 + 20);
        vm.prank(OP);
        m.sell(id, DOWN, shares / 4, 0, K, _ms(t0 + 20));
        (, uint256 left) = m.costOf(id, OP);
        assertApproxEqAbs(left, (cost * 3) / 4, 1, "a quarter of the basis left with a quarter of the shares");
        vm.warp(t0 + 60);
        vm.prank(OP);
        m.settle(id, K, _ms(t0 + 60)); // closed ON the line: nobody beat it
        assertEq(m.roundStatus(id), 3);
        vm.prank(OP);
        assertEq(m.redeem(id), left);
    }

    function test_settle_refuses_to_starve_the_scoreboard() public {
        uint64 id = _open();
        vm.warp(t0 + 60);
        vm.prank(OP);
        vm.expectRevert(RopeMarket.HookGas.selector);
        m.settle{gas: 400_000}(id, K + 1, _ms(t0 + 60));
        // with the budget, it settles
        vm.prank(OP);
        m.settle(id, K + 1, _ms(t0 + 60));
        assertEq(m.roundStatus(id), 2);
    }

    function test_anyone_can_void_a_round_the_keeper_abandoned() public {
        uint64 id = _open();
        vm.warp(t0 + 60 + 121);
        vm.prank(STRANGER);
        m.voidStale(id);
        assertEq(m.roundStatus(id), 3);
    }

    function test_cannot_settle_before_the_bell() public {
        uint64 id = _open();
        vm.warp(t0 + 59);
        vm.prank(OP);
        vm.expectRevert(RopeMarket.TooEarly.selector);
        m.settle(id, K + 1, _ms(t0 + 59));
    }

    function test_lp_cannot_withdraw_what_a_round_may_owe() public {
        uint64 id = _open();
        vm.prank(OP);
        m.buy(id, UP, 1_000e6, 900_000, K, _ms(t0) + 1);
        uint256 lpAll = m.lpShares(LP);
        vm.prank(LP);
        uint256 out = m.withdraw(lpAll);
        // free = 40k + 1k premium − 1960.78 reserved
        assertEq(out, 41_000e6 - m.liability());
        assertGe(usd.balanceOf(address(m)), m.liability(), "solvent for the worst case");
    }

    /* --------------------------------------------------------------- fuzz */

    /// The vault always holds enough for the round's worst case, and buying
    /// then selling at an unchanged mark never makes money, at any size or time.
    function testFuzz_round_trip_never_profits(uint96 budget, uint8 secs) public {
        uint64 id = _open();
        uint256 b = bound(budget, 1e6, 3_000e6);
        uint256 dt = bound(secs, 1, 54);

        vm.prank(OP);
        (uint256 shares, uint256 cost,) = m.buy(id, UP, b, ONE, K, _ms(t0) + 1);
        assertGe(usd.balanceOf(address(m)), m.liability());

        vm.warp(t0 + dt);
        // the round trip is taken at the SAME mark it was bought at, a moment later
        vm.prank(OP);
        m.pushMark(K, _ms(t0 + dt));
        vm.prank(OP);
        (uint256 proceeds,) = m.sell(id, UP, shares, 0, K, _ms(t0 + dt));
        assertLe(proceeds, cost, "no free money on a flat round trip");
    }
}
