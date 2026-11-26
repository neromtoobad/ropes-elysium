// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FixedPointMathLib as FPM} from "../vendor/FixedPointMathLib.sol";

/**
 * Black–Scholes with r = 0, for the ROPES options book.
 *
 *   d1 = (ln(S/K) + σ²τ/2) / (σ√τ),   d2 = d1 − σ√τ
 *   C  = S·N(d1) − K·N(d2)
 *   P  = C − S + K                         (put–call parity, r = 0)
 *
 * The book's call is CAPPED at K (payoff min(max(S−K,0), K)), which is exactly
 * a call spread: long the K call, short the 2K call. So its fair value is
 * C(K) − C(2K), not min(C(K), K). For short-dated strikes near the money the
 * two agree to many decimals; for long-dated or very high-vol series the cap
 * matters (see the tests).
 *
 * Units: S and K are 1e8 (Hyperliquid marks); σ is per √second, wad (the
 * convention RopeMarket.setSigma uses); τ is seconds. Results are 1e8.
 * N(·) is the same Abramowitz & Stegun 7.1.26 erf RopeMarket uses (max error
 * 1.5e-7), so a price is good to ~(S+K)·2e-7 — far inside one $0.001 tick.
 */
library BlackScholes {
    int256 private constant SQRT2 = 1_414213562373095049;
    int256 private constant P = 327591100000000000;
    int256 private constant A1 = 254829592000000000;
    int256 private constant A2 = -284496736000000000;
    int256 private constant A3 = 1_421413741000000000;
    int256 private constant A4 = -1_453152027000000000;
    int256 private constant A5 = 1_061405429000000000;

    /// Plain (uncapped) call, 1e8.
    function call(uint256 s, uint256 k, uint256 tau, uint256 sigmaWad) internal pure returns (uint256) {
        if (s == 0) return 0;
        if (k == 0) return s;
        uint256 sd = (sigmaWad * FPM.sqrt(tau * 1e36)) / 1e18; // σ√τ, wad
        if (sd == 0) return s > k ? s - k : 0;
        int256 x = FPM.lnWad(int256((s * 1e18) / k)); // ln(S/K), wad
        int256 d1 = ((x + int256((sd * sd) / 2e18)) * 1e18) / int256(sd);
        int256 d2 = d1 - int256(sd);
        uint256 a = s * phi(d1);
        uint256 b = k * phi(d2);
        return a > b ? (a - b) / 1e18 : 0;
    }

    /// The book's capped call: C(K) − C(2K), 1e8. Never above K.
    function cappedCall(uint256 s, uint256 k, uint256 tau, uint256 sigmaWad) internal pure returns (uint256 v) {
        uint256 c1 = call(s, k, tau, sigmaWad);
        uint256 c2 = call(s, 2 * k, tau, sigmaWad);
        v = c1 > c2 ? c1 - c2 : 0;
        if (v > k) v = k;
    }

    /// Put by parity, 1e8, clamped to [0, K].
    function put(uint256 s, uint256 k, uint256 tau, uint256 sigmaWad) internal pure returns (uint256 v) {
        uint256 c = call(s, k, tau, sigmaWad);
        // P = C − S + K, computed without going negative
        v = c + k > s ? c + k - s : 0;
        if (v > k) v = k;
    }

    /// The book's option value, 1e8.
    function value(bool isCall, uint256 s, uint256 k, uint256 tau, uint256 sigmaWad) internal pure returns (uint256) {
        return isCall ? cappedCall(s, k, tau, sigmaWad) : put(s, k, tau, sigmaWad);
    }

    /// Standard normal CDF, wad in and out.
    function phi(int256 d) internal pure returns (uint256) {
        bool neg = d < 0;
        int256 z = ((neg ? -d : d) * 1e18) / SQRT2; // |d|/√2
        if (z > 6e18) return neg ? 0 : 1e18;
        int256 t = int256(1e36) / (1e18 + (P * z) / 1e18);
        int256 poly = A5;
        poly = A4 + (poly * t) / 1e18;
        poly = A3 + (poly * t) / 1e18;
        poly = A2 + (poly * t) / 1e18;
        poly = A1 + (poly * t) / 1e18;
        poly = (poly * t) / 1e18;
        int256 e = FPM.expWad(-(z * z) / 1e18);
        int256 erf = 1e18 - (poly * e) / 1e18;
        if (erf < 0) erf = 0;
        int256 v = neg ? 1e18 - erf : 1e18 + erf;
        return uint256(v) / 2;
    }
}
