// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FixedPointMathLib as FPM} from "./vendor/FixedPointMathLib.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Called by the market inside the settlement transaction, so the game's
/// public scoreboard settles in the same transaction as the money.
interface ISettlementHook {
    function onRoundSettled(uint64 roundId, bool voided, uint8 winner) external;
}

/**
 * ROPES — one minute of Hyperliquid, as a market.
 *
 * Every round is a binary contract on one Hyperliquid mark: did the price at
 * the bell finish above the price at the open? There is no order book to wait
 * for and no counterparty to find. The contract itself quotes both sides,
 * from the live mark, every block:
 *
 *     fair(UP) = Φ( ln(S/K) / (σ·√τ) )
 *
 *   S  the latest relayed Hyperliquid mark      K  the strike, the mark at the open
 *   τ  seconds left in the round                σ  per-√second volatility of ln(price)
 *
 * and sells UP at fair + spread, buys it back at fair − spread. DOWN is the
 * mirror (a DOWN share is worth 1 − UP). The house vault takes the other side
 * of every trade and earns the spread. A winning share redeems for exactly 1.
 *
 * This is a market maker that re-quotes from an oracle every block, which only
 * makes sense on a chain where a block is ~100 ms and a quote refresh costs a
 * fraction of a cent. That chain is Elysium.
 *
 * TRUST, stated plainly: until Elysium's HyperCore read precompile ships, the
 * Hyperliquid mark arrives through `operator`, a keeper that relays the public
 * Hyperliquid API. Every mark it pushes is an event here, stamped with the
 * Hyperliquid-side timestamp, so anyone can audit every strike and every close
 * against Hyperliquid's own history. Trading is operator-only in this version
 * for the same reason: an open market fed by a relay could be picked off by
 * anyone with a faster feed than the relay.
 */
contract RopeMarket {
    /* ------------------------------------------------------------ constants */

    uint256 public constant ONE = 1e6; // collateral and probabilities: 6 decimals
    uint8 public constant UP = 0;
    uint8 public constant DOWN = 1;

    uint8 internal constant NONE = 0;
    uint8 internal constant TRADING = 1;
    uint8 internal constant SETTLED = 2;
    uint8 internal constant VOIDED = 3;

    /* ---------------------------------------------------------------- types */

    struct Round {
        uint64 opensAt; // unix seconds
        uint64 expiresAt; // unix seconds — the bell
        uint8 status;
        uint8 winner; // UP or DOWN; meaningless unless SETTLED
        uint128 strike; // mark at the open, 1e8
        uint128 close; // mark at the bell, 1e8
        uint128 upShares; // outstanding
        uint128 downShares;
        uint128 cap; // the most this round may ever owe one side
        uint128 reserved; // what this round currently holds back from the vault
    }

    /* -------------------------------------------------------------- storage */

    IERC20Min public immutable collateral;
    /// The asset this market prices, e.g. "HYPE", "BTC", "xyz:SP500".
    bytes32 public immutable asset;

    address public owner;
    /// The keeper: relays Hyperliquid marks, opens and settles rounds, routes orders.
    address public operator;
    /// The game's scoreboard, settled inside `settle`. Optional.
    address public hook;

    /// Latest relayed mark (1e8), the Hyperliquid-side time it was taken (ms),
    /// and the block time it landed here.
    uint128 public mark;
    uint64 public markSourceMs;
    uint64 public markAt;

    /// Volatility of ln(price) per √second, wad. Set by the keeper from recent
    /// Hyperliquid candles; bounded so a bad push cannot give quotes away.
    uint256 public sigmaWad;

    /// Half the bid/ask spread, in probability units (ONE = 100%).
    uint256 public halfSpread = 10_000; // 1%
    /// The spread doubles over the last `lateSecs` of a round.
    uint64 public lateSecs = 10;
    /// No buying in the last `buyLockSecs`. Selling (BAIL) is allowed to the bell.
    uint64 public buyLockSecs = 5;
    /// A trade needs a mark at most this old (block time).
    uint64 public maxStaleSecs = 3;
    /// The strike must be taken within this window around the open, and the
    /// close within this window after the bell — or the round cannot settle
    /// on a price and is voided instead.
    uint64 public sampleWindowSecs = 5;
    /// Share of the vault's free balance one round may risk, in bps.
    uint256 public roundCapBps = 2_500;

    uint64 public roundCount;
    mapping(uint64 => Round) public rounds;
    /// roundId => holder => [upShares, downShares]
    mapping(uint64 => mapping(address => uint256[2])) internal _shares;

    /// Everything the vault currently owes or holds back: open rounds' worst
    /// case plus settled rounds' unredeemed winnings.
    uint256 public liability;

    /// The house vault. Non-transferable shares for now; the token is roadmap.
    uint256 public totalLpShares;
    mapping(address => uint256) public lpShares;

    /* --------------------------------------------------------------- events */

    event MarkPushed(uint128 mark, uint64 sourceMs);
    event RoundOpened(uint64 indexed roundId, uint64 opensAt, uint64 expiresAt, uint128 strike, uint128 cap);
    event Traded(
        uint64 indexed roundId, address indexed trader, uint8 side, bool isBuy, uint256 shares, uint256 price, uint256 amount
    );
    event RoundSettled(uint64 indexed roundId, uint128 close, uint8 winner, bool voided);
    event Redeemed(uint64 indexed roundId, address indexed holder, uint256 amount);
    event VaultDeposit(address indexed who, uint256 assets, uint256 shares);
    event VaultWithdraw(address indexed who, uint256 assets, uint256 shares);
    event ParamsSet(uint256 halfSpread, uint64 lateSecs, uint64 buyLockSecs, uint64 maxStaleSecs, uint64 sampleWindowSecs, uint256 roundCapBps);
    event SigmaSet(uint256 sigmaWad);

    /* --------------------------------------------------------------- errors */

    error NotOwner();
    error NotOperator();
    error StaleMark();
    error BadMark();
    error NotTrading();
    error BuyLocked();
    error TooLate();
    error TooEarly();
    error PriceLimit(uint256 price);
    error OverCap();
    error NothingToSell();
    error AlreadyFinal();
    error Insufficient();
    error TransferFailed();
    error BadParam();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address _collateral, bytes32 _asset, address _operator, uint256 _sigmaWad) {
        collateral = IERC20Min(_collateral);
        asset = _asset;
        owner = msg.sender;
        operator = _operator;
        _setSigma(_sigmaWad);
    }

    /* ---------------------------------------------------------------- admin */

    function setOwner(address next) external onlyOwner {
        owner = next;
    }

    function setOperator(address next) external onlyOwner {
        operator = next;
    }

    function setHook(address next) external onlyOwner {
        hook = next;
    }

    function setParams(
        uint256 _halfSpread,
        uint64 _lateSecs,
        uint64 _buyLockSecs,
        uint64 _maxStaleSecs,
        uint64 _sampleWindowSecs,
        uint256 _roundCapBps
    ) external onlyOwner {
        // A spread under 0.2% gives the vault no edge; over 10% is not a market.
        if (_halfSpread < 2_000 || _halfSpread > 100_000) revert BadParam();
        if (_roundCapBps == 0 || _roundCapBps > 5_000) revert BadParam();
        if (_maxStaleSecs == 0 || _sampleWindowSecs == 0) revert BadParam();
        halfSpread = _halfSpread;
        lateSecs = _lateSecs;
        buyLockSecs = _buyLockSecs;
        maxStaleSecs = _maxStaleSecs;
        sampleWindowSecs = _sampleWindowSecs;
        roundCapBps = _roundCapBps;
        emit ParamsSet(_halfSpread, _lateSecs, _buyLockSecs, _maxStaleSecs, _sampleWindowSecs, _roundCapBps);
    }

    /// Owner or keeper. Bounded: per-√second σ between 0.001% and 0.5%, i.e.
    /// a one-minute move of roughly 0.008% to 3.9%.
    function setSigma(uint256 _sigmaWad) external {
        if (msg.sender != owner && msg.sender != operator) revert NotOperator();
        _setSigma(_sigmaWad);
    }

    function _setSigma(uint256 s) internal {
        if (s < 1e13 || s > 5e15) revert BadParam();
        sigmaWad = s;
        emit SigmaSet(s);
    }

    /* ----------------------------------------------------------- the relay */

    /// Relay a Hyperliquid mark. Idempotent and monotonic: an older or equal
    /// Hyperliquid timestamp is ignored, never an error, so every write path
    /// can carry the freshest mark it has without coordinating.
    function pushMark(uint128 _mark, uint64 sourceMs) public onlyOperator {
        _push(_mark, sourceMs);
    }

    function _push(uint128 _mark, uint64 sourceMs) internal {
        if (sourceMs <= markSourceMs) return;
        if (_mark == 0) revert BadMark();
        // The relay may not report a time from the future.
        if (sourceMs > uint64(block.timestamp) * 1000 + 2_000) revert BadMark();
        mark = _mark;
        markSourceMs = sourceMs;
        markAt = uint64(block.timestamp);
        emit MarkPushed(_mark, sourceMs);
    }

    /* --------------------------------------------------------------- rounds */

    /**
     * Open the round that runs from `opensAt` to `expiresAt`, struck at the
     * mark pushed with it. That mark must be taken within `sampleWindowSecs`
     * of the open, on the Hyperliquid clock — the strike is a fact about the
     * open, not about whenever the keeper got round to it.
     */
    function openRound(uint64 opensAt, uint64 expiresAt, uint128 strikeMark, uint64 sourceMs)
        external
        onlyOperator
        returns (uint64 id)
    {
        if (expiresAt <= opensAt || expiresAt <= block.timestamp) revert BadParam();
        uint256 openMs = uint256(opensAt) * 1000;
        uint256 window = uint256(sampleWindowSecs) * 1000;
        if (sourceMs + window < openMs || sourceMs > openMs + window) revert BadMark();
        _push(strikeMark, sourceMs);

        id = ++roundCount;
        uint256 free = freeBalance();
        uint128 cap = uint128((free * roundCapBps) / 10_000);
        rounds[id] = Round({
            opensAt: opensAt,
            expiresAt: expiresAt,
            status: TRADING,
            winner: 0,
            strike: strikeMark,
            close: 0,
            upShares: 0,
            downShares: 0,
            cap: cap,
            reserved: 0
        });
        emit RoundOpened(id, opensAt, expiresAt, strikeMark, cap);
    }

    /**
     * Settle on the mark at the bell. The close must be sampled in the
     * `sampleWindowSecs` after expiry; a keeper that was down for the bell
     * cannot settle on a price taken later, and the round is voided instead
     * (every share pays half), which is the honest result when we don't know.
     */
    function settle(uint64 id, uint128 closeMark, uint64 sourceMs) external onlyOperator {
        Round storage r = rounds[id];
        if (r.status != TRADING) revert AlreadyFinal();
        if (block.timestamp < r.expiresAt) revert TooEarly();

        uint256 bellMs = uint256(r.expiresAt) * 1000;
        bool sampled = closeMark != 0 && sourceMs >= bellMs && sourceMs <= bellMs + uint256(sampleWindowSecs) * 1000;
        if (!sampled || closeMark == r.strike) {
            if (sampled) {
                _push(closeMark, sourceMs);
                r.close = closeMark;
            }
            _void(id, r);
            return;
        }
        _push(closeMark, sourceMs);
        r.close = closeMark;
        r.status = SETTLED;
        r.winner = closeMark > r.strike ? UP : DOWN;

        uint256 owed = r.winner == UP ? r.upShares : r.downShares;
        liability = liability - r.reserved + owed;
        r.reserved = uint128(owed);

        emit RoundSettled(id, closeMark, r.winner, false);
        _callHook(id, false, r.winner);
    }

    /// No mark could be had for the bell. Anyone may void a round that is
    /// well past its sample window, so a dead keeper cannot freeze money.
    function voidStale(uint64 id) external {
        Round storage r = rounds[id];
        if (r.status != TRADING) revert AlreadyFinal();
        if (block.timestamp <= uint256(r.expiresAt) + 120) revert TooEarly();
        _void(id, r);
    }

    function _void(uint64 id, Round storage r) internal {
        r.status = VOIDED;
        uint256 owed = (uint256(r.upShares) + uint256(r.downShares)) / 2;
        liability = liability - r.reserved + owed;
        r.reserved = uint128(owed);
        emit RoundSettled(id, r.close, 0, true);
        _callHook(id, true, 0);
    }

    function _callHook(uint64 id, bool voided, uint8 winner) internal {
        if (hook == address(0)) return;
        // The scoreboard must never be able to block the money.
        try ISettlementHook(hook).onRoundSettled(id, voided, winner) {} catch {}
    }

    /* --------------------------------------------------------------- quotes */

    /// Fair probability that UP wins, ONE-scaled, at the current mark.
    function fairUp(uint64 id) public view returns (uint256) {
        Round storage r = rounds[id];
        uint256 tau = block.timestamp >= r.expiresAt ? 0 : r.expiresAt - block.timestamp;
        return fairUpAt(mark, r.strike, tau, sigmaWad);
    }

    /// The pricing function on its own, so anyone can check a quote.
    function fairUpAt(uint256 s, uint256 k, uint256 tau, uint256 sigma) public pure returns (uint256) {
        if (s == 0 || k == 0) return ONE / 2;
        if (tau == 0 || sigma == 0) return s > k ? ONE : s < k ? 0 : ONE / 2;
        int256 x = FPM.lnWad(int256((s * 1e18) / k)); // ln(S/K), wad
        uint256 sd = (sigma * FPM.sqrt(tau * 1e36)) / 1e18; // σ·√τ, wad
        int256 d = (x * 1e18) / int256(sd);
        return _phi(d) / 1e12;
    }

    /**
     * The quote in YES (= UP) terms, like a book's touch:
     *   yesAsk  what one UP share costs        (DOWN sells at 1 − yesAsk ... see below)
     *   yesBid  what one UP share sells for
     * A DOWN share costs ONE − yesBid and sells for ONE − yesAsk.
     */
    function quote(uint64 id) public view returns (uint256 yesBid, uint256 yesAsk, uint256 fair) {
        Round storage r = rounds[id];
        fair = fairUp(id);
        uint256 hs = halfSpread;
        if (block.timestamp + lateSecs >= r.expiresAt) hs *= 2;
        yesAsk = fair + hs > ONE ? ONE : fair + hs;
        yesBid = fair > hs ? fair - hs : 0;
    }

    /// Price of one share of `side`: what a buyer pays, and what a seller gets.
    function priceOf(uint64 id, uint8 side) public view returns (uint256 buyPrice, uint256 sellPrice) {
        (uint256 yesBid, uint256 yesAsk,) = quote(id);
        if (side == UP) return (yesAsk, yesBid);
        return (ONE - yesBid, ONE - yesAsk);
    }

    /* --------------------------------------------------------------- trades */

    /**
     * Spend up to `budget` on `side`. Carries a fresh mark so the quote is
     * never older than the trade. Shares = budget / price, so a win pays
     * budget/price — the 1/p the whole game is built on.
     */
    function buy(uint64 id, uint8 side, uint256 budget, uint256 maxPrice, uint128 _mark, uint64 sourceMs)
        external
        onlyOperator
        returns (uint256 shares, uint256 cost, uint256 price)
    {
        _push(_mark, sourceMs);
        Round storage r = rounds[id];
        _checkTradable(r);
        if (block.timestamp + buyLockSecs >= r.expiresAt) revert BuyLocked();

        (price,) = priceOf(id, side);
        if (price == 0 || price >= ONE || price > maxPrice) revert PriceLimit(price);
        shares = (budget * ONE) / price;
        cost = (shares * price + ONE - 1) / ONE; // round the cost UP: the vault never subsidises rounding
        if (cost > budget) {
            shares -= 1;
            cost = (shares * price + ONE - 1) / ONE;
        }
        if (shares == 0) revert Insufficient();

        if (side == UP) r.upShares += uint128(shares);
        else r.downShares += uint128(shares);
        _reserve(r);

        _shares[id][msg.sender][side] += shares;
        _pull(msg.sender, cost);
        emit Traded(id, msg.sender, side, true, shares, price, cost);
    }

    /// Sell `shares` of `side` back at the live bid — the money behind BAIL.
    function sell(uint64 id, uint8 side, uint256 shares, uint256 minPrice, uint128 _mark, uint64 sourceMs)
        external
        onlyOperator
        returns (uint256 proceeds, uint256 price)
    {
        _push(_mark, sourceMs);
        Round storage r = rounds[id];
        _checkTradable(r);
        if (block.timestamp >= r.expiresAt) revert TooLate();

        uint256 held = _shares[id][msg.sender][side];
        if (shares > held) shares = held;
        if (shares == 0) revert NothingToSell();

        (, price) = priceOf(id, side);
        if (price < minPrice) revert PriceLimit(price);
        proceeds = (shares * price) / ONE; // round DOWN

        _shares[id][msg.sender][side] = held - shares;
        if (side == UP) r.upShares -= uint128(shares);
        else r.downShares -= uint128(shares);
        _reserve(r);

        _send(msg.sender, proceeds);
        emit Traded(id, msg.sender, side, false, shares, price, proceeds);
    }

    /// Winning shares pay ONE each; a void pays half a share each side.
    function redeem(uint64 id) external returns (uint256 amount) {
        Round storage r = rounds[id];
        uint256[2] storage s = _shares[id][msg.sender];
        if (r.status == SETTLED) {
            amount = s[r.winner];
        } else if (r.status == VOIDED) {
            amount = (s[UP] + s[DOWN]) / 2;
        } else {
            revert NotTrading();
        }
        s[UP] = 0;
        s[DOWN] = 0;
        if (amount == 0) return 0;
        // Rounding in the void halving can leave `reserved` a unit short of the
        // sum of individual claims; never underflow on it.
        uint256 take = amount > r.reserved ? r.reserved : amount;
        r.reserved -= uint128(take);
        liability -= take;
        _send(msg.sender, amount);
        emit Redeemed(id, msg.sender, amount);
    }

    function _checkTradable(Round storage r) internal view {
        if (r.status != TRADING) revert NotTrading();
        if (block.timestamp < r.opensAt) revert TooEarly();
        if (block.timestamp > uint256(markAt) + maxStaleSecs) revert StaleMark();
    }

    /// Hold back the round's worst case: whichever side, if it won, owes more.
    function _reserve(Round storage r) internal {
        uint256 worst = r.upShares > r.downShares ? r.upShares : r.downShares;
        if (worst > r.cap) revert OverCap();
        liability = liability - r.reserved + worst;
        r.reserved = uint128(worst);
    }

    /* ---------------------------------------------------------------- vault */

    /// Collateral not spoken for by any round.
    function freeBalance() public view returns (uint256) {
        uint256 bal = collateral.balanceOf(address(this));
        return bal > liability ? bal - liability : 0;
    }

    function deposit(uint256 assets) external returns (uint256 shares) {
        uint256 nav = freeBalance();
        shares = totalLpShares == 0 || nav == 0 ? assets : (assets * totalLpShares) / nav;
        if (shares == 0) revert Insufficient();
        _pull(msg.sender, assets);
        totalLpShares += shares;
        lpShares[msg.sender] += shares;
        emit VaultDeposit(msg.sender, assets, shares);
    }

    /// Withdraw at the conservative NAV (every open round assumed lost), and
    /// only from the free balance — LPs can never pull money a round may owe.
    function withdraw(uint256 shares) external returns (uint256 assets) {
        if (shares == 0 || shares > lpShares[msg.sender]) revert Insufficient();
        assets = (shares * freeBalance()) / totalLpShares;
        lpShares[msg.sender] -= shares;
        totalLpShares -= shares;
        _send(msg.sender, assets);
        emit VaultWithdraw(msg.sender, assets, shares);
    }

    /* ---------------------------------------------------------------- views */

    function sharesOf(uint64 id, address holder) external view returns (uint256 up, uint256 down) {
        uint256[2] storage s = _shares[id][holder];
        return (s[UP], s[DOWN]);
    }

    function roundStatus(uint64 id) external view returns (uint8) {
        return rounds[id].status;
    }

    /* ------------------------------------------------------------- transfer */

    function _pull(address from, uint256 amount) internal {
        if (!collateral.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!collateral.transfer(to, amount)) revert TransferFailed();
    }

    /* ----------------------------------------------------------------- math */

    int256 private constant SQRT2 = 1_414213562373095049;
    int256 private constant P = 327591100000000000;
    int256 private constant A1 = 254829592000000000;
    int256 private constant A2 = -284496736000000000;
    int256 private constant A3 = 1_421413741000000000;
    int256 private constant A4 = -1_453152027000000000;
    int256 private constant A5 = 1_061405429000000000;

    /// Standard normal CDF, wad in and out. Abramowitz & Stegun 7.1.26 for
    /// erf (max error 1.5e-7, far below one probability unit of 1e-6).
    function _phi(int256 d) internal pure returns (uint256) {
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
