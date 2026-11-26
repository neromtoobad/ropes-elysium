// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BookBase} from "./BookBase.sol";
import {OptionsBook} from "../../src/book/OptionsBook.sol";
import {ERC1155Lite} from "../../src/book/ERC1155Lite.sol";

/// A contract that can hold ERC-1155 and, when it receives LONG, tries to
/// re-enter the book.
contract Reenterer {
    OptionsBook public book;
    bool public reentered;
    bool public tried;

    constructor(OptionsBook b) {
        book = b;
    }

    function approve(address token) external {
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", address(book), type(uint256).max));
        require(ok);
    }

    function buy(uint256 id, uint256 price, uint256 qty) external {
        book.placeLimit(id, true, price, qty, false);
    }

    function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external returns (bytes4) {
        if (msg.sender == address(book) && !tried) {
            tried = true;
            try book.placeMarket(id >> 1, true, 10, 40_000_000) {
                reentered = true;
            } catch {}
        }
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }
}

/// Holds nothing, implements no hooks.
contract NoHooks {}

contract OptionsBookTest is BookBase {
    uint256 constant P = 1_500_000; // $1.50 per option

    /* --------------------------------------------------------------- series */

    function test_create_series_and_dedupe() public {
        assertEq(book.seriesId(HYPE, expiry, K, true), callId);
        assertEq(book.seriesId(HYPE, expiry, K, false), putId);
        assertEq(book.seriesId(HYPE, expiry, K + 1e4, true), 0);
        OptionsBook.Series memory s = book.getSeries(callId);
        assertEq(s.underlying, HYPE);
        assertEq(s.expiry, expiry);
        assertEq(s.strike, K);
        assertTrue(s.isCall);
        assertEq(s.state, 1);
        assertEq(book.maxPayout(callId), 40e6);
        assertEq(book.longId(callId), callId << 1);
        assertEq(book.shortId(callId), (callId << 1) | 1);

        vm.prank(OP);
        vm.expectRevert(OptionsBook.SeriesExists.selector);
        book.createSeries(HYPE, expiry, K, true);

        vm.expectRevert(OptionsBook.NotOperator.selector);
        book.createSeries(HYPE, expiry, K + 1e4, true);

        vm.startPrank(OP);
        vm.expectRevert(OptionsBook.BadParam.selector); // not a whole minute
        book.createSeries(HYPE, expiry + 1, K, true);
        vm.expectRevert(OptionsBook.BadParam.selector); // strike not a multiple of $0.0001
        book.createSeries(HYPE, expiry, K + 1, true);
        vm.expectRevert(OptionsBook.BadParam.selector); // in the past
        book.createSeries(HYPE, t0, K, true);
        vm.expectRevert(OptionsBook.UnderlyingNotAllowed.selector);
        book.createSeries("BTC", expiry, K, true);
        vm.stopPrank();
    }

    function test_live_series_drops_expired() public {
        vm.prank(OP);
        uint256 later = book.createSeries(HYPE, expiry + 1 days, K, true);
        uint256[] memory live = book.liveSeries();
        assertEq(live.length, 3);
        vm.warp(expiry);
        live = book.liveSeries();
        assertEq(live.length, 1);
        assertEq(live[0], later);
    }

    /* ---------------------------------------------------------- write/burn */

    function test_mint_locks_max_payout_and_burn_pair_returns_it() public {
        uint256 b0 = usd.balanceOf(ALICE);
        _mint(ALICE, callId, 150); // 1.5 options × $40
        assertEq(b0 - usd.balanceOf(ALICE), 60e6);
        assertEq(book.balanceOf(ALICE, _long(callId)), 150);
        assertEq(book.balanceOf(ALICE, _short(callId)), 150);
        assertEq(book.totalLocked(), 60e6);
        assertEq(book.collateralFor(callId, 150), 60e6);

        // a put is collateralised by its strike too
        _mint(ALICE, putId, 100);
        assertEq(b0 - usd.balanceOf(ALICE), 100e6);

        vm.prank(ALICE);
        book.burnPair(callId, 50);
        assertEq(b0 - usd.balanceOf(ALICE), 80e6);
        assertEq(book.balanceOf(ALICE, _long(callId)), 100);
        assertEq(book.getSeries(callId).longSupply, 100);
        assertEq(book.getSeries(callId).shortSupply, 100);
        _solvent();

        // a pair needs both legs
        vm.prank(ALICE);
        book.safeTransferFrom(ALICE, BOB, _long(callId), 100, "");
        vm.prank(ALICE);
        vm.expectRevert(ERC1155Lite.ERC1155InsufficientBalance.selector);
        book.burnPair(callId, 1);
    }

    function test_burn_pair_works_after_expiry_and_after_settlement() public {
        _mint(ALICE, callId, 200);
        vm.warp(expiry + 5);
        vm.prank(ALICE);
        book.burnPair(callId, 100);
        _settleAt(45_00000000);
        book.settle(callId);
        uint256 b = usd.balanceOf(ALICE);
        vm.prank(ALICE);
        book.burnPair(callId, 100);
        assertEq(usd.balanceOf(ALICE) - b, 40e6);
        assertEq(book.totalLocked(), 0);
        _solvent();
    }

    function test_mint_rejects_dust_and_expired() public {
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.BadQty.selector);
        book.mint(callId, 9); // below minQty
        vm.warp(expiry);
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.Expired.selector);
        book.mint(callId, 100);
    }

    /* -------------------------------------------------------- resting orders */

    function test_buy_rests_and_escrows() public {
        uint256 b0 = usd.balanceOf(ALICE);
        (uint256 oid, uint256 filled) = _limit(ALICE, callId, true, P, 200);
        assertEq(filled, 0);
        assertEq(oid, 1);
        assertEq(b0 - usd.balanceOf(ALICE), 3e6); // 2 options × $1.50
        (uint256 px, uint256 q) = book.bestBid(callId);
        assertEq(px, P);
        assertEq(q, 200);
        uint256[] memory open = book.openOrders(ALICE, callId);
        assertEq(open.length, 1);
        assertEq(open[0], oid);
        OptionsBook.OrderView memory v = book.getOrder(oid);
        assertEq(v.owner, ALICE);
        assertTrue(v.isBuy);
        assertEq(v.price, P);
        assertEq(v.qty, 200);
        assertEq(v.status, 1);
        assertEq(v.escrow, 3e6);
        assertEq(book.escrowedUsdc(), 3e6);
        _solvent();
    }

    function test_sell_rests_and_escrows_long() public {
        uint256 oid = _sell(BOB, callId, P, 100);
        assertEq(book.balanceOf(BOB, _long(callId)), 0);
        assertEq(book.balanceOf(address(book), _long(callId)), 100);
        assertEq(book.balanceOf(BOB, _short(callId)), 100);
        (uint256 px, uint256 q) = book.bestAsk(callId);
        assertEq(px, P);
        assertEq(q, 100);
        assertEq(book.getOrder(oid).escrow, 100);
    }

    function test_sell_needs_long() public {
        vm.prank(BOB);
        vm.expectRevert(OptionsBook.InsufficientLong.selector);
        book.placeLimit(callId, false, P, 100, false);
    }

    function test_price_rules() public {
        vm.startPrank(ALICE);
        vm.expectRevert(OptionsBook.BadPrice.selector);
        book.placeLimit(callId, true, 0, 100, false);
        vm.expectRevert(OptionsBook.BadPrice.selector);
        book.placeLimit(callId, true, P + 1, 100, false); // off tick
        vm.expectRevert(OptionsBook.BadPrice.selector);
        book.placeLimit(callId, true, 40e6 + 1000, 100, false); // above the max payout
        book.placeLimit(callId, true, 40e6, 100, false); // exactly the max payout is fine
        book.placeLimit(callId, true, 1000, 100, false); // one tick is fine
        vm.stopPrank();
    }

    /* ---------------------------------------------------------------- fills */

    function test_full_fill_pays_the_maker_price() public {
        uint256 oid = _sell(BOB, callId, P, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        uint256 b0 = usd.balanceOf(BOB);
        (uint256 aoid, uint256 filled) = _limit(ALICE, callId, true, 1_600_000, 100);
        assertEq(filled, 100);
        assertEq(aoid, 0); // nothing rested
        assertEq(a0 - usd.balanceOf(ALICE), 1_500_000);
        assertEq(usd.balanceOf(BOB) - b0, 1_500_000);
        assertEq(book.balanceOf(ALICE, _long(callId)), 100);
        assertEq(book.balanceOf(address(book), _long(callId)), 0);
        assertEq(book.getOrder(oid).status, 2);
        assertEq(book.openOrders(BOB, callId).length, 0);
        (uint256 px,) = book.bestAsk(callId);
        assertEq(px, 0);
        _solvent();
    }

    function test_partial_fill_leaves_the_rest_resting() public {
        uint256 oid = _sell(BOB, callId, P, 300);
        _limit(ALICE, callId, true, P, 100);
        OptionsBook.OrderView memory v = book.getOrder(oid);
        assertEq(v.qty, 200);
        assertEq(v.filledQty, 100);
        assertEq(v.status, 1);
        (, uint256 q) = book.bestAsk(callId);
        assertEq(q, 200);

        // a taker sell partially fills a resting bid
        (uint256 bid,) = _limit(CAROL, callId, true, 1_000_000, 500);
        _mint(DAVE, callId, 200);
        uint256 d0 = usd.balanceOf(DAVE);
        (uint256 doid, uint256 filled) = _limit(DAVE, callId, false, 1_000_000, 200);
        assertEq(filled, 200);
        assertEq(doid, 0);
        assertEq(usd.balanceOf(DAVE) - d0, 2e6);
        assertEq(book.balanceOf(CAROL, _long(callId)), 200);
        assertEq(book.getOrder(bid).qty, 300);
        assertEq(book.getOrder(bid).escrow, 3e6);
        _solvent();
    }

    function test_sweeps_levels_best_first_and_rests_the_rest() public {
        _sell(BOB, callId, 1_000_000, 100);
        _sell(CAROL, callId, 1_100_000, 100);
        _sell(DAVE, callId, 1_200_000, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        (uint256 oid, uint256 filled) = _limit(ALICE, callId, true, 1_150_000, 250);
        assertEq(filled, 200);
        assertGt(oid, 0);
        // 1 × $1.00 + 1 × $1.10 filled, 0.5 × $1.15 escrowed
        assertEq(a0 - usd.balanceOf(ALICE), 1_000_000 + 1_100_000 + 575_000);
        (uint256 bpx, uint256 bq) = book.bestBid(callId);
        assertEq(bpx, 1_150_000);
        assertEq(bq, 50);
        (uint256 apx,) = book.bestAsk(callId);
        assertEq(apx, 1_200_000);

        (uint256[] memory bp, uint256[] memory bqs, uint256[] memory ap, uint256[] memory aqs) = book.depth(callId, 5);
        assertEq(bp.length, 1);
        assertEq(bqs[0], 50);
        assertEq(ap.length, 1);
        assertEq(ap[0], 1_200_000);
        assertEq(aqs[0], 100);
        _solvent();
    }

    function test_fifo_at_one_level() public {
        uint256 first = _sell(BOB, callId, P, 100);
        uint256 second = _sell(CAROL, callId, P, 100);
        uint256[] memory q = book.levelOrders(callId, false, P, 10);
        assertEq(q.length, 2);
        assertEq(q[0], first);
        assertEq(q[1], second);

        uint256 b0 = usd.balanceOf(BOB);
        uint256 c0 = usd.balanceOf(CAROL);
        _limit(ALICE, callId, true, P, 150);
        assertEq(usd.balanceOf(BOB) - b0, 1_500_000); // first in, filled first, fully
        assertEq(usd.balanceOf(CAROL) - c0, 750_000);
        assertEq(book.getOrder(first).status, 2);
        assertEq(book.getOrder(second).qty, 50);
        q = book.levelOrders(callId, false, P, 10);
        assertEq(q.length, 1);
        assertEq(q[0], second);
    }

    function test_depth_orders_levels() public {
        _limit(ALICE, callId, true, 1_000_000, 100);
        _limit(ALICE, callId, true, 1_300_000, 100);
        _limit(BOB, callId, true, 1_300_000, 50);
        _limit(ALICE, callId, true, 900_000, 100);
        _sell(CAROL, callId, 2_000_000, 100);
        _sell(CAROL, callId, 1_800_000, 100);
        (uint256[] memory bp, uint256[] memory bq, uint256[] memory ap,) = book.depth(callId, 2);
        assertEq(bp.length, 2);
        assertEq(bp[0], 1_300_000);
        assertEq(bq[0], 150);
        assertEq(bp[1], 1_000_000);
        assertEq(ap[0], 1_800_000);
        assertEq(ap[1], 2_000_000);
    }

    /* -------------------------------------------------------------- cancels */

    function test_cancel_refunds() public {
        uint256 a0 = usd.balanceOf(ALICE);
        (uint256 bid,) = _limit(ALICE, callId, true, P, 200);
        uint256 ask = _sell(BOB, callId, 2_000_000, 100);

        vm.prank(BOB);
        vm.expectRevert(OptionsBook.NotOrderOwner.selector);
        book.cancel(bid);

        vm.prank(ALICE);
        book.cancel(bid);
        assertEq(usd.balanceOf(ALICE), a0);
        assertEq(book.getOrder(bid).status, 3);
        (uint256 px,) = book.bestBid(callId);
        assertEq(px, 0);

        vm.prank(BOB);
        book.cancel(ask);
        assertEq(book.balanceOf(BOB, _long(callId)), 100);

        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.OrderNotOpen.selector);
        book.cancel(bid);
        assertEq(book.escrowedUsdc(), 0);
        _solvent();
    }

    function test_cancel_middle_of_queue_keeps_fifo() public {
        uint256 a = _sell(BOB, callId, P, 100);
        uint256 b = _sell(CAROL, callId, P, 100);
        uint256 c = _sell(DAVE, callId, P, 100);
        vm.prank(CAROL);
        book.cancel(b);
        uint256[] memory q = book.levelOrders(callId, false, P, 10);
        assertEq(q.length, 2);
        assertEq(q[0], a);
        assertEq(q[1], c);
        vm.prank(BOB);
        book.cancel(a);
        vm.prank(DAVE);
        book.cancel(c);
        (uint256 px,) = book.bestAsk(callId);
        assertEq(px, 0);
        // the level is reusable
        uint256 d = _sell(BOB, callId, P, 100);
        q = book.levelOrders(callId, false, P, 10);
        assertEq(q.length, 1);
        assertEq(q[0], d);
    }

    function test_cancel_replace_nets_escrow_and_loses_priority() public {
        _limit(BOB, callId, true, 1_200_000, 100);
        (uint256 oid,) = _limit(ALICE, callId, true, 1_000_000, 100); // escrow $1.00
        uint256 a0 = usd.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 nid, uint256 filled) = book.cancelReplace(oid, 1_200_000, 50, true); // escrow $0.60
        assertEq(filled, 0);
        assertEq(usd.balanceOf(ALICE) - a0, 400_000);
        assertEq(book.getOrder(oid).status, 3);
        assertEq(book.getOrder(nid).status, 1);
        uint256[] memory q = book.levelOrders(callId, true, 1_200_000, 10);
        assertEq(q.length, 2);
        assertEq(book.getOrder(q[0]).owner, BOB);
        assertEq(q[1], nid);
        uint256[] memory open = book.openOrders(ALICE, callId);
        assertEq(open.length, 1);
        assertEq(open[0], nid);

        vm.prank(BOB);
        vm.expectRevert(OptionsBook.NotOrderOwner.selector);
        book.cancelReplace(nid, 1_000_000, 50, false);
        _solvent();
    }

    function test_cancel_replace_sell_side() public {
        uint256 oid = _sell(BOB, callId, 2_000_000, 100);
        vm.prank(BOB);
        (uint256 nid,) = book.cancelReplace(oid, 1_900_000, 80, false);
        assertEq(book.balanceOf(BOB, _long(callId)), 20);
        assertEq(book.balanceOf(address(book), _long(callId)), 80);
        assertEq(book.getOrder(nid).price, 1_900_000);
    }

    function test_post_only_rejects_a_crossing_order() public {
        _sell(BOB, callId, P, 100);
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.PostOnlyWouldCross.selector);
        book.placeLimit(callId, true, P, 100, true);
        vm.prank(ALICE);
        (uint256 oid,) = book.placeLimit(callId, true, P - 1000, 100, true);
        assertGt(oid, 0);
    }

    function test_ioc_fills_what_it_can_and_rests_nothing() public {
        _sell(BOB, callId, P, 100);
        _sell(CAROL, callId, 1_700_000, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 filled, uint256 notional, uint256 fee) = book.placeMarket(callId, true, 300, 1_600_000);
        assertEq(filled, 100);
        assertEq(notional, 1_500_000);
        assertEq(fee, 0);
        assertEq(a0 - usd.balanceOf(ALICE), 1_500_000);
        (uint256 bpx,) = book.bestBid(callId);
        assertEq(bpx, 0);
        assertEq(book.openOrders(ALICE, callId).length, 0);

        // an IOC sell into nothing
        _mint(DAVE, callId, 100);
        vm.prank(DAVE);
        (filled,,) = book.placeMarket(callId, false, 100, 1000);
        assertEq(filled, 0);
        assertEq(book.balanceOf(DAVE, _long(callId)), 100);
        _solvent();
    }

    function test_self_trade_cancels_the_resting_order() public {
        uint256 own = _sell(ALICE, callId, P, 100);
        uint256 bobs = _sell(BOB, callId, 1_600_000, 100);
        uint256 b0 = usd.balanceOf(BOB);
        (uint256 oid, uint256 filled) = _limit(ALICE, callId, true, 1_600_000, 200);
        assertEq(book.getOrder(own).status, 3); // cancelled, not filled
        assertEq(book.getOrder(bobs).status, 2);
        assertEq(filled, 100);
        assertEq(usd.balanceOf(BOB) - b0, 1_600_000);
        // her LONG came back and she bought BOB's: 200
        assertEq(book.balanceOf(ALICE, _long(callId)), 200);
        // the rest of her buy rests at 1.60
        assertGt(oid, 0);
        (uint256 bpx, uint256 bq) = book.bestBid(callId);
        assertEq(bpx, 1_600_000);
        assertEq(bq, 100);
        _solvent();
    }

    function test_self_trade_on_a_sell_refunds_the_bid_escrow() public {
        (uint256 own,) = _limit(ALICE, callId, true, P, 100);
        _mint(ALICE, callId, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        vm.prank(ALICE);
        (uint256 filled,,) = book.placeMarket(callId, false, 100, P);
        assertEq(filled, 0);
        assertEq(book.getOrder(own).status, 3);
        assertEq(usd.balanceOf(ALICE) - a0, 1_500_000);
        _solvent();
    }

    function test_matching_loop_is_bounded() public {
        _mint(BOB, callId, 400);
        vm.startPrank(BOB);
        for (uint256 i; i < 40; ++i) {
            book.placeLimit(callId, false, 1_000_000, 10, false);
        }
        vm.stopPrank();
        uint256 a0 = usd.balanceOf(ALICE);
        (uint256 oid, uint256 filled) = _limit(ALICE, callId, true, 1_000_000, 400);
        assertEq(filled, 320); // 32 orders × 10
        assertEq(oid, 0); // the rest still crosses: not placed, not charged
        assertEq(a0 - usd.balanceOf(ALICE), 3_200_000);
        (uint256 bpx,) = book.bestBid(callId);
        assertEq(bpx, 0);
        (, filled) = _limit(ALICE, callId, true, 1_000_000, 80);
        assertEq(filled, 80);
        _solvent();
    }

    /* ----------------------------------------------------------------- fees */

    function test_fees_on_both_sides() public {
        book.setFees(10, 30); // 0.10% maker, 0.30% taker
        _sell(BOB, callId, 2_000_000, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        uint256 b0 = usd.balanceOf(BOB);
        _limit(ALICE, callId, true, 2_000_000, 100);
        assertEq(a0 - usd.balanceOf(ALICE), 2_006_000); // + taker 0.30%
        assertEq(usd.balanceOf(BOB) - b0, 1_998_000); // − maker 0.10%
        assertEq(book.accruedFees(), 8_000);

        // a resting buy escrows its maker fee; a taker sell pays its own
        (uint256 bid,) = _limit(CAROL, callId, true, 1_000_000, 100);
        assertEq(book.getOrder(bid).escrow, 1_001_000);
        _mint(DAVE, callId, 100);
        uint256 d0 = usd.balanceOf(DAVE);
        _limit(DAVE, callId, false, 1_000_000, 100);
        assertEq(usd.balanceOf(DAVE) - d0, 997_000);
        assertEq(book.accruedFees(), 8_000 + 1_000 + 3_000);
        _solvent();

        uint256 f = book.withdrawFees();
        assertEq(f, 12_000);
        assertEq(usd.balanceOf(FEES), 12_000);
        assertEq(book.accruedFees(), 0);
        _solvent();
    }

    function test_resting_order_keeps_its_maker_rate() public {
        book.setFees(10, 0);
        (uint256 bid,) = _limit(ALICE, callId, true, 1_000_000, 100);
        book.setFees(500, 0);
        _mint(BOB, callId, 100);
        _limit(BOB, callId, false, 1_000_000, 100);
        assertEq(book.accruedFees(), 1_000); // 0.10%, not 5%
        assertEq(book.getOrder(bid).status, 2);
        _solvent();
    }

    function test_partial_fills_never_overdraw_the_maker_fee() public {
        book.setFees(33, 47);
        (uint256 bid,) = _limit(ALICE, callId, true, 1_237_000, 997);
        uint256 escrow0 = book.getOrder(bid).escrow;
        _mint(BOB, callId, 997);
        uint256 sold;
        uint256[5] memory chunks = [uint256(13), 101, 250, 33, 600];
        for (uint256 i; i < chunks.length && sold < 997; ++i) {
            uint256 q = chunks[i] > 997 - sold ? 997 - sold : chunks[i];
            if (q < 10) break;
            _limit(BOB, callId, false, 1_237_000, q);
            sold += q;
            _solvent();
        }
        OptionsBook.OrderView memory v = book.getOrder(bid);
        // what is left in escrow is exactly the formula on the remaining qty
        uint256 n = (1_237_000 * v.qty) / 100;
        assertEq(v.escrow, n + (n * 33) / 10_000);
        assertLe(escrow0 - v.escrow, escrow0);
        _solvent();
    }

    function test_fee_caps_and_admin() public {
        vm.expectRevert(OptionsBook.BadParam.selector);
        book.setFees(501, 0);
        vm.expectRevert(OptionsBook.BadParam.selector);
        book.setFees(0, 501);
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.NotOwner.selector);
        book.setFees(1, 1);
        book.setFees(500, 500);
        vm.expectRevert(OptionsBook.BadParam.selector);
        book.setFeeRecipient(address(0));
    }

    /* ----------------------------------------------------------- settlement */

    function _position(uint256 id, uint256 qty) internal {
        // ALICE writes and sells to BOB: ALICE holds SHORT, BOB holds LONG.
        _mint(ALICE, id, qty);
        _limit(ALICE, id, false, 1_000_000, qty);
        _limit(BOB, id, true, 1_000_000, qty);
        assertEq(book.balanceOf(BOB, _long(id)), qty);
        assertEq(book.balanceOf(ALICE, _short(id)), qty);
    }

    function _redeemBoth(uint256 id) internal returns (uint256 toLong, uint256 toShort) {
        vm.prank(BOB);
        toLong = book.redeem(id);
        vm.prank(ALICE);
        toShort = book.redeem(id);
        assertEq(toLong + toShort, 0 + book.collateralFor(id, 100), "payouts sum to the collateral");
        assertEq(book.totalLocked(), 0);
        assertEq(book.balanceOf(BOB, _long(id)), 0);
        assertEq(book.balanceOf(ALICE, _short(id)), 0);
        _solvent();
    }

    function test_call_settles_in_the_money() public {
        _position(callId, 100);
        _settleAt(45_00000000);
        (uint256 l, uint256 s) = _redeemBoth(callId);
        assertEq(l, 5e6);
        assertEq(s, 35e6);
        assertEq(book.getSeries(callId).settlementPrice, 45_00000000);
    }

    function test_call_settles_out_of_and_at_the_money() public {
        _position(callId, 100);
        _settleAt(35_00000000);
        (uint256 l, uint256 s) = _redeemBoth(callId);
        assertEq(l, 0);
        assertEq(s, 40e6);
    }

    function test_call_at_the_strike_pays_nothing() public {
        _position(callId, 100);
        _settleAt(K);
        (uint256 l, uint256 s) = _redeemBoth(callId);
        assertEq(l, 0);
        assertEq(s, 40e6);
    }

    function test_call_payoff_is_capped_at_the_strike() public {
        _position(callId, 100);
        _settleAt(100_00000000); // S − K = 60 > K = 40
        (uint256 l, uint256 s) = _redeemBoth(callId);
        assertEq(l, 40e6);
        assertEq(s, 0);
    }

    function test_put_settles_in_out_and_at() public {
        _position(putId, 100);
        _settleAt(30_00000000);
        (uint256 l, uint256 s) = _redeemBoth(putId);
        assertEq(l, 10e6);
        assertEq(s, 30e6);
    }

    function test_put_out_of_the_money() public {
        _position(putId, 100);
        _settleAt(50_00000000);
        (uint256 l, uint256 s) = _redeemBoth(putId);
        assertEq(l, 0);
        assertEq(s, 40e6);
    }

    function test_put_at_the_strike() public {
        _position(putId, 100);
        _settleAt(K);
        (uint256 l, uint256 s) = _redeemBoth(putId);
        assertEq(l, 0);
        assertEq(s, 40e6);
    }

    function test_settlement_rounding_goes_to_short_and_sums_exactly() public {
        _position(callId, 100);
        _settleAt(45_00009999); // intrinsic $5.00009999
        (uint256 l, uint256 s) = _redeemBoth(callId);
        assertEq(l, 5e6); // floored to $0.0001 per option
        assertEq(s, 35e6);
    }

    function test_settle_needs_a_final_price() public {
        _position(callId, 100);
        vm.expectRevert(OptionsBook.NotExpired.selector);
        book.settle(callId);
        vm.warp(expiry);
        vm.expectRevert(OptionsBook.PriceNotReady.selector);
        book.settle(callId);
        vm.prank(OP);
        oracle.post(HYPE, expiry, 45_00000000);
        // posted but still inside the correction window
        vm.expectRevert(OptionsBook.PriceNotReady.selector);
        book.settle(callId);
        vm.prank(BOB);
        vm.expectRevert(OptionsBook.PriceNotReady.selector);
        book.redeem(callId);
        // the owner corrects inside the window; the book uses the corrected price
        oracle.correct(HYPE, expiry, 46_00000000);
        vm.warp(expiry + oracle.CORRECTION_WINDOW());
        book.settle(callId);
        assertEq(book.getSeries(callId).payoffUnit, 60_000);
        vm.expectRevert(OptionsBook.AlreadySettled.selector);
        book.settle(callId);
        (uint256 l,) = _redeemBoth(callId);
        assertEq(l, 6e6);
    }

    function test_redeem_settles_lazily_and_is_idempotent() public {
        _position(callId, 100);
        _settleAt(41_00000000);
        vm.prank(BOB);
        assertEq(book.redeem(callId), 1e6);
        vm.prank(BOB);
        assertEq(book.redeem(callId), 0);
        vm.prank(CAROL);
        assertEq(book.redeem(callId), 0);
    }

    function test_holder_of_both_legs_gets_the_max_payout() public {
        _mint(ALICE, callId, 100);
        _settleAt(43_00000000);
        vm.prank(ALICE);
        assertEq(book.redeem(callId), 40e6);
    }

    /* ------------------------------------------------------------ at expiry */

    function test_trading_stops_at_expiry() public {
        _sell(BOB, callId, P, 100);
        vm.warp(expiry);
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.Expired.selector);
        book.placeLimit(callId, true, P, 100, false);
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.Expired.selector);
        book.placeMarket(callId, true, 100, P);
        vm.prank(BOB);
        vm.expectRevert(OptionsBook.Expired.selector);
        book.mintAndSell(callId, 100, P, false);
    }

    function test_anyone_cancels_after_expiry_funds_go_to_the_owner() public {
        (uint256 bid,) = _limit(ALICE, callId, true, P, 200);
        uint256 ask = _sell(BOB, callId, 2_000_000, 100);
        uint256 a0 = usd.balanceOf(ALICE);
        uint256 c0 = usd.balanceOf(CAROL);
        vm.warp(expiry);
        uint256[] memory ids = new uint256[](2);
        ids[0] = bid;
        ids[1] = ask;
        vm.prank(CAROL);
        book.cancelMany(ids);
        assertEq(usd.balanceOf(ALICE) - a0, 3e6);
        assertEq(usd.balanceOf(CAROL), c0);
        assertEq(book.balanceOf(BOB, _long(callId)), 100);
        assertEq(book.getOrder(ask).status, 3);
        // BOB redeems his returned pair
        vm.prank(OP);
        oracle.post(HYPE, expiry, 44_00000000);
        vm.warp(expiry + 10 minutes);
        vm.prank(BOB);
        assertEq(book.redeem(callId), 40e6);
        _solvent();
    }

    /* ---------------------------------------------------------------- pause */

    function test_pause_blocks_new_business_only() public {
        (uint256 bid,) = _limit(ALICE, callId, true, P, 100);
        _mint(BOB, callId, 200);
        book.setPaused(true);

        vm.startPrank(BOB);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.mint(callId, 100);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.placeLimit(callId, false, P, 100, false);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.placeMarket(callId, false, 100, P);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.mintAndSell(callId, 100, P, false);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.buyAndBurn(callId, 100, P);
        // burning pairs still works
        book.burnPair(callId, 100);
        vm.stopPrank();

        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.Paused.selector);
        book.cancelReplace(bid, P, 100, false);
        vm.prank(ALICE);
        book.cancel(bid);

        // settlement and redemption still work
        _settleAt(42_00000000);
        vm.prank(BOB);
        assertEq(book.redeem(callId), 40e6);
        book.withdrawFees();

        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.NotOwner.selector);
        book.setPaused(false);
        book.setPaused(false);
        assertFalse(book.paused());
    }

    /* ---------------------------------------------------------- convenience */

    function test_mint_and_sell_then_buy_and_burn() public {
        _limit(ALICE, callId, true, 2_000_000, 100);
        uint256 b0 = usd.balanceOf(BOB);
        vm.prank(BOB);
        (uint256 oid, uint256 filled) = book.mintAndSell(callId, 100, 1_900_000, false);
        assertEq(filled, 100);
        assertEq(oid, 0);
        assertEq(b0 - usd.balanceOf(BOB), 40e6 - 2e6); // collateral less the premium, one transfer
        assertEq(book.balanceOf(BOB, _short(callId)), 100);
        assertEq(book.balanceOf(BOB, _long(callId)), 0);
        assertEq(book.balanceOf(ALICE, _long(callId)), 100);

        // rest the remainder
        vm.prank(BOB);
        (oid,) = book.mintAndSell(callId, 50, 2_500_000, true);
        assertGt(oid, 0);
        assertEq(book.balanceOf(address(book), _long(callId)), 50);

        // CAROL writes and offers; BOB closes 100 of his short against it
        _sell(CAROL, callId, 3_000_000, 100);
        b0 = usd.balanceOf(BOB);
        vm.prank(BOB);
        (uint256 got, uint256 netPaid) = book.buyAndBurn(callId, 100, 3_000_000);
        assertEq(got, 100);
        assertEq(netPaid, 0);
        assertEq(usd.balanceOf(BOB) - b0, 40e6 - 3e6);
        assertEq(book.balanceOf(BOB, _short(callId)), 50);
        OptionsBook.Series memory s = book.getSeries(callId);
        assertEq(s.longSupply, s.shortSupply);
        assertEq(s.longSupply, 150); // 100 + 50 + 100 written, 100 burned
        _solvent();
    }

    /* -------------------------------------------------------------- ERC-1155 */

    function test_erc1155_transfers_and_approvals() public {
        _mint(ALICE, callId, 100);
        assertTrue(book.supportsInterface(0xd9b67a26));
        assertTrue(book.supportsInterface(0x01ffc9a7));
        assertFalse(book.supportsInterface(0xffffffff));

        vm.prank(BOB);
        vm.expectRevert(ERC1155Lite.ERC1155NotApproved.selector);
        book.safeTransferFrom(ALICE, BOB, _long(callId), 10, "");

        vm.prank(ALICE);
        book.setApprovalForAll(BOB, true);
        assertTrue(book.isApprovedForAll(ALICE, BOB));
        vm.prank(BOB);
        book.safeTransferFrom(ALICE, CAROL, _long(callId), 10, "");
        assertEq(book.balanceOf(CAROL, _long(callId)), 10);

        uint256[] memory ids = new uint256[](2);
        uint256[] memory vals = new uint256[](2);
        ids[0] = _long(callId);
        ids[1] = _short(callId);
        vals[0] = 20;
        vals[1] = 30;
        vm.prank(ALICE);
        book.safeBatchTransferFrom(ALICE, DAVE, ids, vals, "");
        address[] memory who = new address[](2);
        who[0] = DAVE;
        who[1] = DAVE;
        uint256[] memory bals = book.balanceOfBatch(who, ids);
        assertEq(bals[0], 20);
        assertEq(bals[1], 30);

        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.NoTransferToBook.selector);
        book.safeTransferFrom(ALICE, address(book), _long(callId), 1, "");

        NoHooks nh = new NoHooks();
        vm.prank(ALICE);
        vm.expectRevert(ERC1155Lite.ERC1155ReceiverRejected.selector);
        book.safeTransferFrom(ALICE, address(nh), _long(callId), 1, "");

        vm.prank(ALICE);
        vm.expectRevert(ERC1155Lite.ERC1155ZeroAddress.selector);
        book.safeTransferFrom(ALICE, address(0), _long(callId), 1, "");

        vm.prank(ALICE);
        vm.expectRevert(ERC1155Lite.ERC1155InsufficientBalance.selector);
        book.safeTransferFrom(ALICE, BOB, _long(callId), 1000, "");
    }

    function test_contract_without_hooks_cannot_mint_or_buy() public {
        NoHooks nh = new NoHooks();
        usd.mint(address(nh), 1000e6);
        vm.prank(address(nh));
        usd.approve(address(book), type(uint256).max);
        vm.prank(address(nh));
        vm.expectRevert(ERC1155Lite.ERC1155ReceiverRejected.selector);
        book.mint(callId, 100);
    }

    function test_receiver_hook_cannot_reenter() public {
        Reenterer r = new Reenterer(book);
        usd.mint(address(r), 1000e6);
        r.approve(address(usd));
        _sell(BOB, callId, P, 100);
        _sell(BOB, callId, P, 100);
        r.buy(callId, P, 100);
        assertTrue(r.tried());
        assertFalse(r.reentered());
        assertEq(book.balanceOf(address(r), _long(callId)), 100);
        _solvent();
    }

    /* -------------------------------------------------------------- admin */

    function test_admin_roles() public {
        vm.prank(ALICE);
        vm.expectRevert(OptionsBook.NotOwner.selector);
        book.setOperator(ALICE);
        book.setOperator(ALICE);
        assertEq(book.operator(), ALICE);
        book.setMinQty(1);
        vm.prank(BOB);
        book.mint(callId, 1);
        vm.expectRevert(OptionsBook.BadParam.selector);
        book.setMinQty(0);
        book.setUnderlying("BTC", true);
        vm.prank(ALICE);
        book.createSeries("BTC", expiry, 100_000_00000000, true);
        vm.expectRevert(OptionsBook.BadParam.selector);
        book.setOwner(address(0));
        book.setOwner(BOB);
        vm.expectRevert(OptionsBook.NotOwner.selector);
        book.setPaused(true);
    }
}
