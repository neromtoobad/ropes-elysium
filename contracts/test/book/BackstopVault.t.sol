// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console} from "forge-std/console.sol";
import {BookBase} from "./BookBase.sol";
import {BackstopVault} from "../../src/book/BackstopVault.sol";
import {OptionsBook} from "../../src/book/OptionsBook.sol";
import {ERC1155Lite} from "../../src/book/ERC1155Lite.sol";

contract BackstopVaultTest is BookBase {
    BackstopVault vault;
    address constant LP = address(0x1B);
    address constant LP2 = address(0x2B);

    // σ for 80% annualised vol, per √second: 0.8 / √31_536_000
    uint256 constant SIGMA80 = 142457947723562;
    uint256 constant DAY = 86_400;
    uint256 dayCall;
    uint256 dayPut;
    uint64 dayExpiry;

    function setUp() public override {
        super.setUp();
        vault = new BackstopVault(address(book), HYPE, OP, SIGMA80);
        dayExpiry = t0 + uint64(DAY);
        vm.startPrank(OP);
        dayCall = book.createSeries(HYPE, dayExpiry, K, true);
        dayPut = book.createSeries(HYPE, dayExpiry, K, false);
        vm.stopPrank();
        _fund(LP, 100_000e6);
        vm.prank(LP);
        usd.approve(address(vault), type(uint256).max);
        vm.prank(LP);
        vault.deposit(100_000e6);
        _fund(LP2, 50_000e6);
        vm.prank(LP2);
        usd.approve(address(vault), type(uint256).max);
    }

    function _push(uint128 m) internal {
        vm.prank(OP);
        vault.pushMark(m, uint64(block.timestamp) * 1000);
    }

    function _requote(uint256 id) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(OP);
        vault.requote(ids);
    }

    /* -------------------------------------------------------------- pricing */

    /// Reference values from a Python Black–Scholes with math.erf (exact N),
    /// r = 0, rounded to 1e-6 USD. The contract uses A&S 7.1.26 for N, so it
    /// is held to 20 units (2e-5 USD).
    function test_pricing_matches_reference() public view {
        uint256 tol = 20;
        // ATM, 1 day, 80% vol
        assertApproxEqAbs(vault.priceAt(true, 40e8, 40e8, DAY, SIGMA80), 668_162, tol, "ATM call 1d");
        assertApproxEqAbs(vault.priceAt(false, 40e8, 40e8, DAY, SIGMA80), 668_162, tol, "ATM put 1d");
        // OTM call / ITM put
        assertApproxEqAbs(vault.priceAt(true, 40e8, 45e8, DAY, SIGMA80), 1_295, tol, "OTM call");
        assertApproxEqAbs(vault.priceAt(false, 40e8, 45e8, DAY, SIGMA80), 5_001_295, tol, "ITM put");
        // ITM call / OTM put
        assertApproxEqAbs(vault.priceAt(true, 40e8, 35e8, DAY, SIGMA80), 5_000_302, tol, "ITM call");
        assertApproxEqAbs(vault.priceAt(false, 40e8, 35e8, DAY, SIGMA80), 302, tol, "OTM put");
        // ATM, 7 days
        assertApproxEqAbs(vault.priceAt(true, 40e8, 40e8, 7 * DAY, SIGMA80), 1_767_016, tol, "ATM call 7d");
        // deep ITM, 1 hour, 120% vol: intrinsic
        assertApproxEqAbs(vault.priceAt(true, 42_50000000, 40e8, 3600, 213686921585344), 2_500_000, tol, "deep call");
        assertApproxEqAbs(vault.priceAt(false, 42_50000000, 40e8, 3600, 213686921585344), 0, tol, "deep OTM put");
        // 30 days, 60% vol, far OTM call
        assertApproxEqAbs(vault.priceAt(true, 25e8, 40e8, 30 * DAY, 106843460792672), 5_169, tol, "far OTM call");
        assertApproxEqAbs(vault.priceAt(false, 25e8, 40e8, 30 * DAY, 106843460792672), 15_005_169, tol, "far ITM put");
        // 1 year, 300% vol: the cap matters. Capped call = C(K) − C(2K) = 2.082316,
        // the uncapped call would be 34.655424; the put is 34.655424.
        assertApproxEqAbs(vault.priceAt(true, 40e8, 40e8, 365 * DAY, 534217303963360), 2_082_316, 40, "capped call");
        assertApproxEqAbs(vault.priceAt(false, 40e8, 40e8, 365 * DAY, 534217303963360), 34_655_424, 40, "put 1y");
        // at expiry: intrinsic, capped
        assertEq(vault.priceAt(true, 45e8, 40e8, 0, SIGMA80), 5e6);
        assertEq(vault.priceAt(true, 100e8, 40e8, 0, SIGMA80), 40e6);
        assertEq(vault.priceAt(false, 30e8, 40e8, 0, SIGMA80), 10e6);
    }

    function testFuzz_pricing_is_bounded_and_parity_holds(uint256 s, uint256 tau, uint256 sigma) public view {
        s = bound(s, 1e8, 200e8);
        tau = bound(tau, 0, 365 * DAY);
        sigma = bound(sigma, 1e13, 5e15);
        uint256 c = vault.priceAt(true, s, K, tau, sigma);
        uint256 p = vault.priceAt(false, s, K, tau, sigma);
        assertLe(c, 40e6, "call <= max payout");
        assertLe(p, 40e6, "put <= max payout");
        // a European put with r = 0 is never below intrinsic
        uint256 intrinsicPut = K > s ? (K - s) / 100 : 0;
        assertGe(p + 50, intrinsicPut, "put >= intrinsic");
        // the capped call is a call spread, so it is at most the plain call,
        // which parity pins at P + S − K. (It CAN be below intrinsic: with a
        // cap, a deep-in-the-money spread is worth less than its max today.)
        assertLe(c + uint256(K) / 100, p + s / 100 + 50, "capped call <= plain call = P + S - K");
    }

    /* -------------------------------------------------------------- quoting */

    function test_requote_posts_both_sides_around_fair() public {
        _push(40e8);
        (uint256 bid, uint256 ask, uint256 f) = vault.quoteFor(dayCall);
        assertApproxEqAbs(f, 668_162, 20);
        // 1% half spread, bid down / ask up to the $0.001 tick
        assertEq(bid, 661_000);
        assertEq(ask, 675_000);

        _requote(dayCall);
        (uint256 bpx, uint256 bq) = book.bestBid(dayCall);
        (uint256 apx, uint256 aq) = book.bestAsk(dayCall);
        assertEq(bpx, 661_000);
        assertEq(bq, 100);
        assertEq(apx, 675_000);
        assertEq(aq, 100);
        // the ask was written: 100 SHORT, LONG escrowed in the book
        assertEq(book.balanceOf(address(vault), _short(dayCall)), 100);
        assertEq(vault.committed(), 40e6 + 661_000);
        uint256[] memory tr = vault.trackedSeries();
        assertEq(tr.length, 1);
        _solvent();
    }

    function test_requote_replaces_old_quotes() public {
        _push(40e8);
        _requote(dayCall);
        (uint256 oldBid, uint256 oldAsk) = vault.quotes(dayCall);
        vm.warp(block.timestamp + 5);
        _push(41e8);
        _requote(dayCall);
        assertEq(book.getOrder(oldBid).status, 3);
        assertEq(book.getOrder(oldAsk).status, 3);
        (uint256 bpx,) = book.bestBid(dayCall);
        (uint256 b,,) = vault.quoteFor(dayCall);
        assertEq(bpx, b);
        // the old ask's LONG came back and was re-offered: still only 100 written
        assertEq(book.balanceOf(address(vault), _short(dayCall)), 100);
        assertEq(book.openOrders(address(vault), dayCall).length, 2);
        _solvent();
    }

    function test_takers_trade_against_the_vault_and_pairs_net_out() public {
        _push(40e8);
        _requote(dayCall);
        uint256 v0 = usd.balanceOf(address(vault));
        // ALICE lifts the vault's ask
        vm.prank(ALICE);
        (uint256 filled,,) = book.placeMarket(dayCall, true, 100, 700_000);
        assertEq(filled, 100);
        assertEq(usd.balanceOf(address(vault)) - v0, 675_000);
        // BOB writes and hits the vault's bid
        vm.prank(BOB);
        (, filled) = book.mintAndSell(dayCall, 100, 661_000, false);
        assertEq(filled, 100);
        assertEq(book.balanceOf(address(vault), _long(dayCall)), 100);
        assertEq(book.balanceOf(address(vault), _short(dayCall)), 100);
        // next requote burns the pair: net flat, collateral back
        vm.warp(block.timestamp + 1);
        _push(40e8);
        uint256 v1 = usd.balanceOf(address(vault));
        _requote(dayCall);
        // got 40 back from the burn, then wrote 100 again for the new ask (−40) and escrowed the bid
        assertEq(int256(usd.balanceOf(address(vault))) - int256(v1), -int256(uint256(661_000)));
        assertEq(book.balanceOf(address(vault), _short(dayCall)), 100);
        _solvent();
    }

    function test_position_cap_stops_the_short_side() public {
        vault.setParams(100, 100, 150, 1_000_000e6, 10, 60);
        _push(40e8);
        _requote(dayCall);
        vm.prank(ALICE);
        book.placeMarket(dayCall, true, 100, 700_000); // vault now net short 100
        vm.warp(block.timestamp + 1);
        _push(40e8);
        _requote(dayCall);
        (uint256 apx,) = book.bestAsk(dayCall);
        assertEq(apx, 0, "no ask: another 100 would breach maxPosition 150");
        (uint256 bpx,) = book.bestBid(dayCall);
        assertGt(bpx, 0, "the bid still quotes");
    }

    function test_commitment_cap() public {
        vault.setParams(100, 100, 2_000, 10e6, 10, 60); // $10: not enough to write one $40 option
        _push(40e8);
        _requote(dayCall);
        (uint256 apx,) = book.bestAsk(dayCall);
        assertEq(apx, 0);
        (uint256 bpx,) = book.bestBid(dayCall);
        assertEq(bpx, 661_000);
        assertLe(vault.committed(), 10e6);
    }

    function test_stale_mark_is_refused() public {
        _push(40e8);
        vm.warp(block.timestamp + 11);
        uint256[] memory ids = new uint256[](1);
        ids[0] = dayCall;
        vm.prank(OP);
        vm.expectRevert(BackstopVault.StaleMark.selector);
        vault.requote(ids);
        vm.prank(LP2);
        // deposits are fine with nothing tracked yet
        vault.deposit(1_000e6);
        _push(40e8);
        _requote(dayCall);
        vm.warp(block.timestamp + 11);
        vm.prank(LP2);
        vm.expectRevert(BackstopVault.StaleMark.selector);
        vault.deposit(1_000e6);
        vm.prank(LP);
        vm.expectRevert(BackstopVault.StaleMark.selector);
        vault.withdraw(1);
    }

    function test_only_operator_quotes() public {
        _push(40e8);
        uint256[] memory ids = new uint256[](1);
        ids[0] = dayCall;
        vm.prank(ALICE);
        vm.expectRevert(BackstopVault.NotOperator.selector);
        vault.requote(ids);
        vm.prank(ALICE);
        vm.expectRevert(BackstopVault.NotOperator.selector);
        vault.pushMark(41e8, uint64(block.timestamp) * 1000);
        vm.prank(OP);
        vm.expectRevert(BackstopVault.BadMark.selector);
        vault.pushMark(41e8, uint64(block.timestamp + 10) * 1000); // from the future
    }

    function test_cancel_quotes_and_min_tau() public {
        _push(40e8);
        _requote(dayCall);
        uint256[] memory ids = new uint256[](1);
        ids[0] = dayCall;
        vm.prank(OP);
        vault.cancelQuotes(ids);
        assertEq(book.openOrders(address(vault), dayCall).length, 0);
        assertEq(vault.committed(), 40e6); // the written SHORT stays committed
        // inside the last minute: quotes pulled, none posted
        vm.warp(dayExpiry - 30);
        _push(40e8);
        _requote(dayCall);
        assertEq(book.openOrders(address(vault), dayCall).length, 0);
    }

    function test_nobody_can_push_tokens_into_the_vault() public {
        _mint(ALICE, dayCall, 100);
        vm.prank(ALICE);
        vm.expectRevert(ERC1155Lite.ERC1155ReceiverRejected.selector);
        book.safeTransferFrom(ALICE, address(vault), _long(dayCall), 100, "");
    }

    /* ---------------------------------------------------------------- vault */

    function test_nav_deposit_withdraw() public {
        assertEq(vault.nav(), 100_000e6);
        _push(40e8);
        _requote(dayCall);
        // quoting moves money between idle, escrow and positions but not NAV
        // (the written ask is valued at fair: short = 40 − fair, long in the ask = fair)
        assertApproxEqAbs(vault.nav(), 100_000e6, 1);

        vm.prank(ALICE);
        book.placeMarket(dayCall, true, 100, 700_000); // the vault earns half the spread
        uint256 n = vault.nav();
        assertGt(n, 100_000e6);
        assertApproxEqAbs(n - 100_000e6, 675_000 - 668_162, 30);

        vm.prank(LP2);
        uint256 minted = vault.deposit(10_000e6);
        assertApproxEqAbs(minted, (10_000e6 * 100_000e6) / n, 1);
        vm.prank(LP2);
        uint256 out = vault.withdraw(minted);
        assertApproxEqAbs(out, 10_000e6, 2);

        // withdrawals are paid from idle only
        uint256 idle = usd.balanceOf(address(vault));
        uint256 lpShares = vault.shares(LP);
        vm.prank(LP);
        vm.expectRevert(BackstopVault.Insufficient.selector);
        vault.withdraw(lpShares);
        assertLt(idle, vault.nav());
    }

    function test_harvest_after_expiry() public {
        _push(40e8);
        _requote(dayCall);
        vm.prank(ALICE);
        book.placeMarket(dayCall, true, 100, 700_000); // vault short 100 calls
        vm.warp(dayExpiry);
        vm.prank(OP);
        oracle.post(HYPE, dayExpiry, 42e8); // ITM by $2
        vm.warp(dayExpiry + 10 minutes);
        uint256 v0 = usd.balanceOf(address(vault));
        uint256 got = vault.harvest(dayCall);
        // the vault had: 100 SHORT (owes $2 each → gets $38) + 100 LONG returned from its ask ($2)
        // ... minus what ALICE took: ALICE bought 100 of its 100 offered, so the ask is gone,
        // leaving 100 SHORT. Its bid escrow came back too.
        assertEq(got, 38e6);
        assertEq(usd.balanceOf(address(vault)) - v0, 38e6 + 661_000);
        assertEq(vault.trackedSeries().length, 0);
        assertEq(vault.committed(), 0);
        // the LP is up by the premium minus the payout: 0.675 − 2.00 per option
        assertEq(vault.nav(), 100_000e6 + 675_000 - 2e6);
        _solvent();
    }

    function test_params_bounds() public {
        vm.expectRevert(BackstopVault.BadParam.selector);
        vault.setParams(5, 100, 1000, 1, 10, 60);
        vm.expectRevert(BackstopVault.BadParam.selector);
        vault.setParams(100, 2000, 1000, 1, 10, 60);
        vm.expectRevert(BackstopVault.BadParam.selector);
        vault.setParams(100, 100, 1000, 1, 0, 60);
        vm.expectRevert(BackstopVault.BadParam.selector);
        vault.setSigma(1);
        vm.prank(ALICE);
        vm.expectRevert(BackstopVault.NotOwner.selector);
        vault.setParams(100, 100, 1000, 1, 10, 60);
        vm.prank(OP);
        vault.setSigma(2e14);
        assertEq(vault.sigmaWad(), 2e14);
    }

    function test_gas_requote() public {
        _push(40e8);
        uint256[] memory ids = new uint256[](1);
        ids[0] = dayCall;
        vm.cool(address(book));
        vm.cool(address(vault));
        vm.prank(OP);
        vault.requote(ids);
        console.log("vault requote, 1 series, first time (writes + 2 orders)", vm.lastCallGas().gasTotalUsed);
        vm.warp(block.timestamp + 1);
        _push(40_10000000);
        vm.cool(address(book));
        vm.cool(address(vault));
        vm.prank(OP);
        vault.requote(ids);
        console.log("vault requote, 1 series, replace both quotes", vm.lastCallGas().gasTotalUsed);
    }

    function test_put_quotes() public {
        _push(38e8);
        _requote(dayPut);
        (uint256 bid, uint256 ask, uint256 f) = vault.quoteFor(dayPut);
        assertGt(f, 2e6); // ITM by $2
        (uint256 bpx,) = book.bestBid(dayPut);
        (uint256 apx,) = book.bestAsk(dayPut);
        assertEq(bpx, bid);
        assertEq(apx, ask);
        assertLt(bid, f);
        assertGt(ask, f);
    }
}
