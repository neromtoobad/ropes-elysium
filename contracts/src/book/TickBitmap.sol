// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * A four-level hierarchical bitmap over 32-bit tick indices: the set of price
 * levels that hold at least one resting order, for one side of one book.
 *
 * Why this and not a sorted list of levels:
 *   - best bid / best ask is a walk down from the root word, always exactly
 *     4 SLOADs, however many levels exist and however far apart they are;
 *   - adding or removing a level touches at most 4 words, with no hint
 *     argument and no walk, so the cost of placing an order never depends on
 *     what else is in the book (a sorted list costs O(levels) per insert, and
 *     anyone can spam levels to make everyone else's inserts expensive);
 *   - "next level above / below" for the depth view is also O(1) (≤ 8 SLOADs).
 *   A single flat bitmap would be cheapest per write but finding the next set
 *   bit could scan many empty words; two levels would cap the tick range at
 *   65 536 ticks (≈ $65 at a 0.001 tick), too tight for strikes above that.
 *
 * Layout: tick t (0 < t < 2^32) is bit (t >> 8L) & 0xff of word
 * t >> 8(L+1) at level L, for L = 0..3. Level 3 is the root, a single word.
 * A bit at level L > 0 is set iff its child word at level L-1 is non-zero.
 */
library TickBitmap {
    struct Bitmap {
        /// key = (level << 32) | wordIndex
        mapping(uint256 => uint256) words;
    }

    uint256 private constant ROOT = 3 << 32;

    function _key(uint256 level, uint256 idx) private pure returns (uint256) {
        return (level << 32) | idx;
    }

    function isEmpty(Bitmap storage b) internal view returns (bool) {
        return b.words[ROOT] == 0;
    }

    function isSet(Bitmap storage b, uint256 t) internal view returns (bool) {
        return (b.words[_key(0, t >> 8)] >> (t & 0xff)) & 1 == 1;
    }

    function set(Bitmap storage b, uint256 t) internal {
        uint256 prefix = t;
        for (uint256 l; l < 4; ++l) {
            uint256 k = _key(l, prefix >> 8);
            uint256 old = b.words[k];
            b.words[k] = old | (uint256(1) << (prefix & 0xff));
            if (old != 0) return; // the parents already know this word is non-empty
            prefix >>= 8;
        }
    }

    function clear(Bitmap storage b, uint256 t) internal {
        uint256 prefix = t;
        for (uint256 l; l < 4; ++l) {
            uint256 k = _key(l, prefix >> 8);
            uint256 next = b.words[k] & ~(uint256(1) << (prefix & 0xff));
            b.words[k] = next;
            if (next != 0) return; // the word still has other bits: parents unchanged
            prefix >>= 8;
        }
    }

    /// Lowest set tick (best ask).
    function lowest(Bitmap storage b) internal view returns (uint256 t, bool found) {
        uint256 w = b.words[ROOT];
        if (w == 0) return (0, false);
        t = lsb(w);
        for (uint256 l = 3; l > 0; --l) {
            t = (t << 8) | lsb(b.words[_key(l - 1, t)]);
        }
        return (t, true);
    }

    /// Highest set tick (best bid).
    function highest(Bitmap storage b) internal view returns (uint256 t, bool found) {
        uint256 w = b.words[ROOT];
        if (w == 0) return (0, false);
        t = msb(w);
        for (uint256 l = 3; l > 0; --l) {
            t = (t << 8) | msb(b.words[_key(l - 1, t)]);
        }
        return (t, true);
    }

    /// Lowest set tick strictly above `t`.
    function nextAbove(Bitmap storage b, uint256 t) internal view returns (uint256, bool) {
        uint256 prefix = t;
        for (uint256 l; l < 4; ++l) {
            uint256 bit = prefix & 0xff;
            uint256 idx = prefix >> 8;
            // bits strictly above `bit`; for bit == 255 the shift wraps to 0 and the mask is empty
            uint256 mask;
            unchecked {
                mask = ~((uint256(2) << bit) - 1);
            }
            uint256 w = b.words[_key(l, idx)] & mask;
            if (w != 0) {
                uint256 r = (idx << 8) | lsb(w);
                for (uint256 d = l; d > 0; --d) {
                    r = (r << 8) | lsb(b.words[_key(d - 1, r)]);
                }
                return (r, true);
            }
            prefix = idx;
        }
        return (0, false);
    }

    /// Highest set tick strictly below `t`.
    function nextBelow(Bitmap storage b, uint256 t) internal view returns (uint256, bool) {
        uint256 prefix = t;
        for (uint256 l; l < 4; ++l) {
            uint256 bit = prefix & 0xff;
            uint256 idx = prefix >> 8;
            uint256 mask = (uint256(1) << bit) - 1; // bits strictly below `bit`
            uint256 w = b.words[_key(l, idx)] & mask;
            if (w != 0) {
                uint256 r = (idx << 8) | msb(w);
                for (uint256 d = l; d > 0; --d) {
                    r = (r << 8) | msb(b.words[_key(d - 1, r)]);
                }
                return (r, true);
            }
            prefix = idx;
        }
        return (0, false);
    }

    /* ------------------------------------------------------------- bit math */

    /// Index of the most significant set bit. x must be non-zero.
    function msb(uint256 x) internal pure returns (uint256 r) {
        if (x >= 1 << 128) {
            x >>= 128;
            r += 128;
        }
        if (x >= 1 << 64) {
            x >>= 64;
            r += 64;
        }
        if (x >= 1 << 32) {
            x >>= 32;
            r += 32;
        }
        if (x >= 1 << 16) {
            x >>= 16;
            r += 16;
        }
        if (x >= 1 << 8) {
            x >>= 8;
            r += 8;
        }
        if (x >= 1 << 4) {
            x >>= 4;
            r += 4;
        }
        if (x >= 1 << 2) {
            x >>= 2;
            r += 2;
        }
        if (x >= 1 << 1) r += 1;
    }

    /// Index of the least significant set bit. x must be non-zero.
    function lsb(uint256 x) internal pure returns (uint256) {
        unchecked {
            return msb(x & (~x + 1));
        }
    }
}
