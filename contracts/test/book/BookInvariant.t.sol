// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {OptionsBook} from "../../src/book/OptionsBook.sol";
import {KeeperOracle} from "../../src/book/KeeperOracle.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

/// Drives the book with random but valid traffic from a few actors.
contract BookHandler is Test {
    OptionsBook public book;
    KeeperOracle public oracle;
    MockUSDC public usd;
    address public owner;
    address public op;
    uint64 public expiry;
    uint256[] public series;
    address[] public actors;

    bool public settled;
    uint256 public calls;
    uint256 public paidOut; // tUSDC paid by redeem + burnPair
    uint256 public collateralIn; // tUSDC locked by mints

    constructor(OptionsBook b, KeeperOracle o, MockUSDC u, address _owner, address _op, uint64 _expiry, uint256[] memory s)
    {
        book = b;
        oracle = o;
        usd = u;
        owner = _owner;
        op = _op;
        expiry = _expiry;
        series = s;
        for (uint256 i; i < 4; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            for (uint256 m; m < 50; ++m) {
                usd.mint(a, 10_000e6);
            }
            vm.prank(a);
            usd.approve(address(book), type(uint256).max);
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function seriesCount() external view returns (uint256) {
        return series.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _series(uint256 seed) internal view returns (uint256) {
        return series[seed % series.length];
    }

    /// Prices clustered in a narrow band so orders cross often.
    function _price(uint256 seed) internal pure returns (uint256) {
        return (900 + (seed % 40) * 5) * 1000; // $0.90 .. $1.095
    }

    function _qty(uint256 seed) internal pure returns (uint256) {
        return 10 + (seed % 300);
    }

    function _collateral(uint256 id, uint256 qty) internal view returns (uint256) {
        return book.collateralFor(id, qty);
    }

    modifier count() {
        ++calls;
        _;
    }

    /* ----------------------------------------------------------- trading */

    function mint(uint256 a, uint256 s, uint256 q) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 qty = _qty(q);
        collateralIn += _collateral(id, qty);
        vm.prank(who);
        book.mint(id, qty);
    }

    function limit(uint256 a, uint256 s, bool isBuy, uint256 p, uint256 q, bool postOnly) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 qty = _qty(q);
        uint256 price = _price(p);
        if (!isBuy) _ensureLong(who, id, qty);
        vm.prank(who);
        try book.placeLimit(id, isBuy, price, qty, postOnly) {}
        catch (bytes memory err) {
            // the only acceptable failure is a post-only order that would cross
            require(postOnly && bytes4(err) == OptionsBook.PostOnlyWouldCross.selector, "unexpected placeLimit revert");
        }
    }

    function market(uint256 a, uint256 s, bool isBuy, uint256 p, uint256 q) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 qty = _qty(q);
        if (!isBuy) _ensureLong(who, id, qty);
        vm.prank(who);
        book.placeMarket(id, isBuy, qty, _price(p));
    }

    function mintAndSell(uint256 a, uint256 s, uint256 p, uint256 q) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 qty = _qty(q);
        collateralIn += _collateral(id, qty);
        vm.prank(who);
        book.mintAndSell(id, qty, _price(p), false);
    }

    function buyAndBurn(uint256 a, uint256 s, uint256 p, uint256 q) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 shortBal = book.balanceOf(who, (id << 1) | 1);
        if (shortBal < 10) return;
        uint256 qty = 10 + (q % (shortBal - 9));
        vm.prank(who);
        (uint256 filled,) = book.buyAndBurn(id, qty, _price(p));
        paidOut += _collateral(id, filled); // the burned pairs' collateral left the book
    }

    function cancel(uint256 a, uint256 s, uint256 k) external count {
        address who = _actor(a);
        uint256 id = _series(s);
        uint256[] memory open = book.openOrders(who, id);
        if (open.length == 0) return;
        vm.prank(who);
        book.cancel(open[k % open.length]);
    }

    function cancelReplace(uint256 a, uint256 s, uint256 k, uint256 p, uint256 q) external count {
        if (settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256[] memory open = book.openOrders(who, id);
        if (open.length == 0) return;
        uint256 oid = open[k % open.length];
        OptionsBook.OrderView memory v = book.getOrder(oid);
        uint256 qty = _qty(q);
        if (!v.isBuy) _ensureLong(who, id, qty > v.qty ? qty - v.qty : 0);
        vm.prank(who);
        book.cancelReplace(oid, _price(p), qty, false);
    }

    function burnPair(uint256 a, uint256 s, uint256 q) external count {
        address who = _actor(a);
        uint256 id = _series(s);
        uint256 l = book.balanceOf(who, id << 1);
        uint256 sh = book.balanceOf(who, (id << 1) | 1);
        uint256 m = l < sh ? l : sh;
        if (m == 0) return;
        uint256 qty = 1 + (q % m);
        vm.prank(who);
        paidOut += book.burnPair(id, qty);
    }

    function transfer(uint256 a, uint256 b, uint256 s, bool isLong, uint256 q) external count {
        address from = _actor(a);
        address to = _actor(b);
        uint256 id = _series(s);
        uint256 tid = isLong ? id << 1 : (id << 1) | 1;
        uint256 bal = book.balanceOf(from, tid);
        if (bal == 0) return;
        vm.prank(from);
        book.safeTransferFrom(from, to, tid, 1 + (q % bal), "");
    }

    function setFees(uint256 m, uint256 t) external count {
        vm.prank(owner);
        book.setFees(uint16(m % 501), uint16(t % 501));
    }

    function withdrawFees() external count {
        book.withdrawFees();
    }

    /* -------------------------------------------------------- settlement */

    /// After enough traffic: expire, post a price, settle every series.
    function expireAndSettle(uint256 priceSeed) external count {
        if (settled || calls < 40) return;
        settled = true;
        vm.warp(expiry);
        uint128 price = _settlePrice(priceSeed);
        vm.prank(op);
        oracle.post("HYPE", expiry, price);
        vm.warp(expiry + oracle.CORRECTION_WINDOW());
        for (uint256 i; i < series.length; ++i) {
            book.settle(series[i]);
        }
    }

    function redeem(uint256 a, uint256 s) external count {
        if (!settled) return;
        vm.prank(_actor(a));
        paidOut += book.redeem(_series(s));
    }

    /// Anyone may cancel after expiry; funds go to the owner.
    function cancelExpired(uint256 a, uint256 s, uint256 k) external count {
        if (!settled) return;
        address who = _actor(a);
        uint256 id = _series(s);
        uint256[] memory open = book.openOrders(who, id);
        if (open.length == 0) return;
        vm.prank(address(0xC0FFEE));
        book.cancel(open[k % open.length]);
    }

    function _settlePrice(uint256 seed) internal pure returns (uint128) {
        uint256 kind = seed % 5;
        if (kind == 0) return 40_00000000; // exactly the strike
        if (kind == 1) return 100_00000000; // past the call cap
        if (kind == 2) return 1_00000000; // deep for the put
        return uint128(1_00000000 + ((seed >> 8) % 120_00000000)); // anywhere in $1 .. $121
    }

    /* ------------------------------------------------------------ helpers */

    function _ensureLong(address who, uint256 id, uint256 qty) internal {
        uint256 have = book.balanceOf(who, id << 1);
        if (have >= qty) return;
        uint256 need = qty - have;
        if (need < 10) need = 10;
        collateralIn += _collateral(id, need);
        vm.prank(who);
        book.mint(id, need);
    }

    /// Wind everything down: cancel every order, settle, redeem everyone.
    function windDown(uint256 priceSeed) external {
        if (!settled) {
            settled = true;
            vm.warp(expiry);
            vm.prank(op);
            oracle.post("HYPE", expiry, _settlePrice(priceSeed));
            vm.warp(expiry + oracle.CORRECTION_WINDOW());
        }
        for (uint256 j; j < series.length; ++j) {
            uint256 id = series[j];
            for (uint256 i; i < actors.length; ++i) {
                uint256[] memory open = book.openOrders(actors[i], id);
                for (uint256 k; k < open.length; ++k) {
                    book.cancel(open[k]);
                }
            }
            if (book.getSeries(id).state == 1) book.settle(id);
            for (uint256 i; i < actors.length; ++i) {
                vm.prank(actors[i]);
                paidOut += book.redeem(id);
            }
        }
    }
}

contract BookInvariantTest is StdInvariant, Test {
    OptionsBook book;
    KeeperOracle oracle;
    MockUSDC usd;
    BookHandler h;
    address constant OP = address(0x0FE);
    address constant FEES = address(0xFEE5);
    uint64 expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        expiry = uint64(block.timestamp) + 1 hours;
        usd = new MockUSDC();
        oracle = new KeeperOracle(OP);
        book = new OptionsBook(address(usd), address(oracle), OP, FEES);
        uint256[] memory ids = new uint256[](3);
        vm.startPrank(OP);
        ids[0] = book.createSeries("HYPE", expiry, 40_00000000, true);
        ids[1] = book.createSeries("HYPE", expiry, 40_00000000, false);
        ids[2] = book.createSeries("HYPE", expiry, 1_23450000, true); // a cheap strike: max payout $1.2345
        vm.stopPrank();
        h = new BookHandler(book, oracle, usd, address(this), OP, expiry, ids);
        book.setOwner(address(this));
        oracle.setOwner(address(this));

        bytes4[] memory sel = new bytes4[](15);
        sel[0] = BookHandler.mint.selector;
        sel[1] = BookHandler.limit.selector;
        sel[2] = BookHandler.limit.selector; // weighted
        sel[3] = BookHandler.market.selector;
        sel[4] = BookHandler.mintAndSell.selector;
        sel[5] = BookHandler.buyAndBurn.selector;
        sel[6] = BookHandler.cancel.selector;
        sel[7] = BookHandler.cancelReplace.selector;
        sel[8] = BookHandler.burnPair.selector;
        sel[9] = BookHandler.transfer.selector;
        sel[10] = BookHandler.setFees.selector;
        sel[11] = BookHandler.withdrawFees.selector;
        sel[12] = BookHandler.expireAndSettle.selector;
        sel[13] = BookHandler.redeem.selector;
        sel[14] = BookHandler.cancelExpired.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
        targetContract(address(h));
    }

    /// The core solvency invariant, with equality: every tUSDC the book holds
    /// is spoken for, and every claim on it is backed.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_balance_equals_obligations() public view {
        assertEq(usd.balanceOf(address(book)), book.requiredBalance());
        assertGe(usd.balanceOf(address(book)), book.escrowedUsdc() + book.totalLocked() + book.accruedFees());
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_escrow_and_collateral_match_their_parts() public view {
        uint256 escrow;
        uint256 locked;
        for (uint256 j; j < h.seriesCount(); ++j) {
            uint256 id = h.series(j);
            uint256 longInBook;
            for (uint256 i; i < h.actorCount(); ++i) {
                uint256[] memory open = book.openOrders(h.actors(i), id);
                for (uint256 k; k < open.length; ++k) {
                    OptionsBook.OrderView memory v = book.getOrder(open[k]);
                    assertEq(v.status, 1);
                    if (v.isBuy) escrow += v.escrow;
                    else longInBook += v.qty;
                }
            }
            assertEq(book.balanceOf(address(book), id << 1), longInBook, "book LONG == open sell qty");
            assertEq(book.balanceOf(address(book), (id << 1) | 1), 0, "book never holds SHORT");

            OptionsBook.Series memory s = book.getSeries(id);
            uint256 longHeld = longInBook;
            uint256 shortHeld;
            for (uint256 i; i < h.actorCount(); ++i) {
                longHeld += book.balanceOf(h.actors(i), id << 1);
                shortHeld += book.balanceOf(h.actors(i), (id << 1) | 1);
            }
            assertEq(s.longSupply, longHeld, "LONG supply");
            assertEq(s.shortSupply, shortHeld, "SHORT supply");
            uint256 unit = book.collateralFor(id, 1);
            if (s.state == 2) {
                assertLe(s.payoffUnit, unit);
                locked += s.longSupply * s.payoffUnit + s.shortSupply * (unit - s.payoffUnit);
            } else {
                assertEq(s.longSupply, s.shortSupply, "pairs until settlement");
                locked += s.longSupply * unit;
            }

            // never a crossed book
            (uint256 bid,) = book.bestBid(id);
            (uint256 ask,) = book.bestAsk(id);
            if (bid != 0 && ask != 0) assertLt(bid, ask, "crossed");
        }
        assertEq(book.escrowedUsdc(), escrow, "escrow == sum of open bids");
        assertEq(book.totalLocked(), locked, "locked == sum of per-series claims");
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    /// forge-config: default.invariant.fail-on-revert = true
    function invariant_payouts_never_exceed_collateral() public view {
        assertLe(h.paidOut(), h.collateralIn());
        assertEq(h.collateralIn() - h.paidOut(), book.totalLocked());
    }

    /// At the end of every run: cancel everything, settle, redeem everyone.
    /// Nothing may be left locked, and what remains is exactly the fees.
    function afterInvariant() public {
        h.windDown(uint256(keccak256(abi.encode(block.timestamp, h.calls()))));
        assertEq(book.totalLocked(), 0, "all collateral paid out");
        assertEq(book.escrowedUsdc(), 0, "all escrow returned");
        assertEq(h.paidOut(), h.collateralIn(), "payouts == collateral, exactly");
        assertEq(usd.balanceOf(address(book)), book.accruedFees() + book.totalUnclaimed());
        book.withdrawFees();
        assertEq(usd.balanceOf(address(book)), book.totalUnclaimed());
    }
}
