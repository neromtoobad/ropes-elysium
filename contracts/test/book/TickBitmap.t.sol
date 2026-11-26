// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {TickBitmap} from "../../src/book/TickBitmap.sol";

contract BitmapHarness {
    using TickBitmap for TickBitmap.Bitmap;

    TickBitmap.Bitmap internal b;

    function set(uint256 t) external {
        b.set(t);
    }

    function clear(uint256 t) external {
        b.clear(t);
    }

    function isSet(uint256 t) external view returns (bool) {
        return b.isSet(t);
    }

    function isEmpty() external view returns (bool) {
        return b.isEmpty();
    }

    function lowest() external view returns (uint256, bool) {
        return b.lowest();
    }

    function highest() external view returns (uint256, bool) {
        return b.highest();
    }

    function nextAbove(uint256 t) external view returns (uint256, bool) {
        return b.nextAbove(t);
    }

    function nextBelow(uint256 t) external view returns (uint256, bool) {
        return b.nextBelow(t);
    }
}

/// The bitmap against a plain sorted array, on ticks chosen to straddle
/// every word boundary at every level.
contract TickBitmapTest is Test {
    BitmapHarness h;
    uint256[] ref; // sorted, unique

    uint256 constant MAXT = type(uint32).max;

    function setUp() public {
        h = new BitmapHarness();
    }

    function _pick(uint256 seed) internal pure returns (uint256 t) {
        uint256 kind = seed % 6;
        uint256 r = seed >> 8;
        if (kind == 0) t = r % 600; // dense near zero, across the first 256-word
        else if (kind == 1) t = 65_536 + (r % 600) - 300; // around a level-1 boundary
        else if (kind == 2) t = (1 << 24) + (r % 600) - 300; // around a level-2 boundary
        else if (kind == 3) t = MAXT - (r % 600); // the very top
        else if (kind == 4) t = (r % 256) << 8; // first bit of a level-0 word
        else t = r % (MAXT + 1); // anywhere
        if (t == 0) t = 1;
        if (t > MAXT) t = MAXT;
    }

    function _refInsert(uint256 t) internal {
        uint256 i;
        while (i < ref.length && ref[i] < t) ++i;
        if (i < ref.length && ref[i] == t) return;
        ref.push(0);
        for (uint256 j = ref.length - 1; j > i; --j) {
            ref[j] = ref[j - 1];
        }
        ref[i] = t;
    }

    function _refRemove(uint256 t) internal {
        uint256 i;
        while (i < ref.length && ref[i] != t) ++i;
        if (i == ref.length) return;
        for (uint256 j = i; j + 1 < ref.length; ++j) {
            ref[j] = ref[j + 1];
        }
        ref.pop();
    }

    function _check() internal view {
        (uint256 lo, bool okLo) = h.lowest();
        (uint256 hi, bool okHi) = h.highest();
        assertEq(okLo, ref.length > 0);
        assertEq(okHi, ref.length > 0);
        assertEq(h.isEmpty(), ref.length == 0);
        if (ref.length == 0) return;
        assertEq(lo, ref[0], "lowest");
        assertEq(hi, ref[ref.length - 1], "highest");
        // walk up and down the whole set
        uint256 t = lo;
        for (uint256 i = 1; i < ref.length; ++i) {
            bool ok;
            (t, ok) = h.nextAbove(t);
            assertTrue(ok);
            assertEq(t, ref[i], "nextAbove");
        }
        (, bool more) = h.nextAbove(hi);
        assertFalse(more);
        t = hi;
        for (uint256 i = ref.length - 1; i > 0; --i) {
            bool ok;
            (t, ok) = h.nextBelow(t);
            assertTrue(ok);
            assertEq(t, ref[i - 1], "nextBelow");
        }
        (, more) = h.nextBelow(lo);
        assertFalse(more);
    }

    function testFuzz_matches_a_sorted_array(uint256[24] memory seeds, uint256 clearMask) public {
        for (uint256 i; i < seeds.length; ++i) {
            uint256 t = _pick(seeds[i]);
            h.set(t);
            _refInsert(t);
            assertTrue(h.isSet(t));
        }
        _check();
        for (uint256 i; i < seeds.length; ++i) {
            if ((clearMask >> i) & 1 == 1) {
                uint256 t = _pick(seeds[i]);
                h.clear(t);
                _refRemove(t);
                assertFalse(h.isSet(t));
            }
        }
        _check();
        // and empty it
        while (ref.length > 0) {
            uint256 t = ref[ref.length - 1];
            h.clear(t);
            ref.pop();
        }
        _check();
    }

    function testFuzz_next_from_arbitrary_points(uint256[8] memory seeds, uint256 probe) public {
        for (uint256 i; i < seeds.length; ++i) {
            uint256 t = _pick(seeds[i]);
            h.set(t);
            _refInsert(t);
        }
        uint256 p = _pick(probe);
        (uint256 a, bool okA) = h.nextAbove(p);
        (uint256 b, bool okB) = h.nextBelow(p);
        uint256 expA;
        bool hasA;
        uint256 expB;
        bool hasB;
        for (uint256 i; i < ref.length; ++i) {
            if (ref[i] > p && !hasA) {
                expA = ref[i];
                hasA = true;
            }
            if (ref[i] < p) {
                expB = ref[i];
                hasB = true;
            }
        }
        assertEq(okA, hasA);
        assertEq(okB, hasB);
        if (hasA) assertEq(a, expA);
        if (hasB) assertEq(b, expB);
    }

    function test_edges() public {
        h.set(1);
        h.set(MAXT);
        h.set(255);
        h.set(256);
        (uint256 t,) = h.nextAbove(1);
        assertEq(t, 255);
        (t,) = h.nextAbove(255);
        assertEq(t, 256);
        (t,) = h.nextAbove(256);
        assertEq(t, MAXT);
        (t,) = h.nextBelow(MAXT);
        assertEq(t, 256);
        h.clear(256);
        (t,) = h.nextAbove(255);
        assertEq(t, MAXT);
        h.clear(MAXT);
        (t,) = h.highest();
        assertEq(t, 255);
        // clearing an unset bit is harmless
        h.clear(77);
        (t,) = h.lowest();
        assertEq(t, 1);
    }

    function test_msb_lsb() public pure {
        assertEq(TickBitmap.msb(1), 0);
        assertEq(TickBitmap.msb(type(uint256).max), 255);
        assertEq(TickBitmap.lsb(type(uint256).max), 0);
        assertEq(TickBitmap.lsb(1 << 255), 255);
        assertEq(TickBitmap.msb(0x180), 8);
        assertEq(TickBitmap.lsb(0x180), 7);
    }
}
