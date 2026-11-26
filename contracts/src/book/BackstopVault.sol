// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {OptionsBook} from "./OptionsBook.sol";
import {BlackScholes} from "./BlackScholes.sol";

interface IERC20Vault {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/**
 * ROPES backstop vault — a tUSDC vault that makes markets of last resort on
 * the options book.
 *
 * It is an ordinary book participant: no special access, the same fees, the
 * same price-time priority. The operator (keeper) relays the Hyperliquid mark
 * and σ, and calls `requote(series[])`, which for each series
 *   1. cancels the vault's previous bid and ask,
 *   2. burns any LONG+SHORT pairs the vault holds (frees their collateral),
 *   3. prices the option with Black–Scholes (r = 0) at the mark,
 *   4. posts a bid at fair − h and an ask at fair + h, h = max(fair·halfSpread,
 *      one tick), bid rounded down and ask rounded up to the tick, at a fixed
 *      size `quoteQty`, selling LONG it already holds first and writing
 *      (minting) only the rest.
 * Caps: the vault's net position per series stays within `maxPosition`
 * (qty units, long or short); the tUSDC it has committed across all series
 * (writer collateral for its SHORT + escrow of its resting bids) stays
 * within `maxCommitted`. A mark older than `maxStaleSecs` is refused.
 *
 * LPs deposit tUSDC for shares and withdraw at NAV: idle tUSDC + bid escrow
 * + positions valued at the model price (settled series at their payoff).
 * Withdrawals are paid from idle tUSDC only. Deposits and withdrawals need a
 * fresh mark, so nobody can buy in or out at a stale model price.
 *
 * TRUST: like RopeMarket, the mark comes from the operator relaying the public
 * Hyperliquid API; every push is an event with the Hyperliquid-side time.
 * Resting quotes do not expire on their own: the keeper must requote (or
 * `cancelQuotes`) when the mark moves or the feed stalls.
 */
contract BackstopVault {
    uint256 public constant MAX_SERIES = 32;
    uint256 internal constant TICK = 1_000;
    uint256 internal constant BPS = 10_000;

    struct Quote {
        uint256 bidId;
        uint256 askId;
    }

    IERC20Vault public immutable collateral;
    OptionsBook public immutable book;
    /// The one underlying this vault's mark is for (v1: "HYPE").
    bytes32 public immutable underlying;

    address public owner;
    address public operator;

    uint128 public mark; // 1e8
    uint64 public markSourceMs;
    uint64 public markAt;
    uint256 public sigmaWad; // per √second

    uint256 public halfSpreadBps = 100; // 1%
    uint256 public quoteQty = 100; // one option per side
    uint256 public maxPosition = 2_000; // 20 options net, per series
    uint256 public maxCommitted = 50_000e6; // tUSDC across all series
    uint64 public maxStaleSecs = 10;
    uint64 public minTauSecs = 60; // stop quoting a minute before expiry

    uint256[] internal _tracked;
    mapping(uint256 => uint256) internal _trackedPos; // 1-based index into _tracked
    mapping(uint256 => Quote) public quotes;

    uint256 public totalShares;
    mapping(address => uint256) public shares;

    uint256 private _lock = 1;

    event MarkPushed(uint128 mark, uint64 sourceMs);
    event SigmaSet(uint256 sigmaWad);
    event ParamsSet(
        uint256 halfSpreadBps, uint256 quoteQty, uint256 maxPosition, uint256 maxCommitted, uint64 maxStaleSecs, uint64 minTauSecs
    );
    event Quoted(uint256 indexed seriesId, uint256 fair, uint256 bid, uint256 bidQty, uint256 ask, uint256 askQty);
    event Harvested(uint256 indexed seriesId, uint256 amount);
    event Deposit(address indexed who, uint256 assets, uint256 shares);
    event Withdraw(address indexed who, uint256 assets, uint256 shares);
    event OwnerSet(address owner);
    event OperatorSet(address operator);

    error NotOwner();
    error NotOperator();
    error BadParam();
    error BadMark();
    error StaleMark();
    error TooManySeries();
    error WrongUnderlying();
    error NotExpired();
    error Insufficient();
    error TransferFailed();
    error Reentrancy();
    error OnlyBook();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _book, bytes32 _underlying, address _operator, uint256 _sigmaWad) {
        book = OptionsBook(_book);
        collateral = IERC20Vault(address(OptionsBook(_book).collateral()));
        underlying = _underlying;
        owner = msg.sender;
        operator = _operator;
        _setSigma(_sigmaWad);
        if (!collateral.approve(_book, type(uint256).max)) revert TransferFailed();
        emit OwnerSet(msg.sender);
        emit OperatorSet(_operator);
    }

    /* ---------------------------------------------------------------- admin */

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert BadParam();
        owner = next;
        emit OwnerSet(next);
    }

    function setOperator(address next) external onlyOwner {
        operator = next;
        emit OperatorSet(next);
    }

    function setParams(
        uint256 _halfSpreadBps,
        uint256 _quoteQty,
        uint256 _maxPosition,
        uint256 _maxCommitted,
        uint64 _maxStaleSecs,
        uint64 _minTauSecs
    ) external onlyOwner {
        // under 0.1% the vault has no edge over its own model error; over 20% is not a market
        if (_halfSpreadBps < 10 || _halfSpreadBps > 2_000) revert BadParam();
        if (_quoteQty == 0 || _quoteQty > _maxPosition) revert BadParam();
        if (_maxStaleSecs == 0 || _maxStaleSecs > 300) revert BadParam();
        halfSpreadBps = _halfSpreadBps;
        quoteQty = _quoteQty;
        maxPosition = _maxPosition;
        maxCommitted = _maxCommitted;
        maxStaleSecs = _maxStaleSecs;
        minTauSecs = _minTauSecs;
        emit ParamsSet(_halfSpreadBps, _quoteQty, _maxPosition, _maxCommitted, _maxStaleSecs, _minTauSecs);
    }

    /// Owner or keeper. Same bounds and convention as RopeMarket.setSigma.
    function setSigma(uint256 s) external {
        if (msg.sender != owner && msg.sender != operator) revert NotOperator();
        _setSigma(s);
    }

    function _setSigma(uint256 s) internal {
        if (s < 1e13 || s > 5e15) revert BadParam();
        sigmaWad = s;
        emit SigmaSet(s);
    }

    /* ------------------------------------------------------------ the relay */

    /// Relay a Hyperliquid mark (1e8) taken at `sourceMs` (Hyperliquid time).
    /// Monotonic: an older or equal timestamp is ignored.
    function pushMark(uint128 _mark, uint64 sourceMs) public onlyOperator {
        if (sourceMs <= markSourceMs) return;
        if (_mark == 0) revert BadMark();
        if (sourceMs > uint64(block.timestamp) * 1000 + 2_000) revert BadMark();
        mark = _mark;
        markSourceMs = sourceMs;
        markAt = uint64(block.timestamp);
        emit MarkPushed(_mark, sourceMs);
    }

    function _fresh() internal view {
        if (mark == 0 || block.timestamp > uint256(markAt) + maxStaleSecs) revert StaleMark();
    }

    /* --------------------------------------------------------------- pricing */

    /// Model value of ONE option of `seriesId`, usdc units (6 dp), at the
    /// current mark. Settled series: the payoff. Expired but unsettled:
    /// intrinsic at the mark.
    function fair(uint256 seriesId) public view returns (uint256) {
        OptionsBook.Series memory s = book.getSeries(seriesId);
        return _fair(s);
    }

    function _fair(OptionsBook.Series memory s) internal view returns (uint256) {
        if (s.state == 2) return uint256(s.payoffUnit) * 100;
        uint256 tau = s.expiry > block.timestamp ? s.expiry - block.timestamp : 0;
        return BlackScholes.value(s.isCall, mark, s.strike, tau, sigmaWad) / 100;
    }

    /// The pure pricing function, so anyone can check a quote:
    /// option value per option in usdc units (6 dp).
    function priceAt(bool isCall, uint256 s, uint256 k, uint256 tau, uint256 sigma) external pure returns (uint256) {
        return BlackScholes.value(isCall, s, k, tau, sigma) / 100;
    }

    /// The bid and ask the vault would post now (0 = that side not quoted).
    function quoteFor(uint256 seriesId) public view returns (uint256 bid, uint256 ask, uint256 fairPx) {
        OptionsBook.Series memory s = book.getSeries(seriesId);
        fairPx = _fair(s);
        (bid, ask) = _spread(fairPx, uint256(s.strike) / 100);
    }

    function _spread(uint256 f, uint256 maxPay) internal view returns (uint256 bid, uint256 ask) {
        uint256 h = (f * halfSpreadBps) / BPS;
        if (h < TICK) h = TICK;
        bid = f > h ? ((f - h) / TICK) * TICK : 0;
        ask = ((f + h + TICK - 1) / TICK) * TICK;
        if (ask > maxPay) ask = (maxPay / TICK) * TICK;
        if (ask <= bid) ask = 0;
    }

    /* ---------------------------------------------------------------- quoting */

    function requote(uint256[] calldata ids) external onlyOperator nonReentrant {
        _requote(ids);
    }

    /// Push the mark and requote in one transaction.
    function pushAndRequote(uint128 _mark, uint64 sourceMs, uint256[] calldata ids) external onlyOperator nonReentrant {
        pushMark(_mark, sourceMs);
        _requote(ids);
    }

    function _requote(uint256[] calldata ids) internal {
        _fresh();
        uint256 used = committed();
        for (uint256 i; i < ids.length; ++i) {
            used = _requoteOne(ids[i], used);
        }
    }

    /// Pull the vault's quotes (operator or owner), e.g. when the feed stalls.
    function cancelQuotes(uint256[] calldata ids) external nonReentrant {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        for (uint256 i; i < ids.length; ++i) {
            _cancelQuotes(ids[i]);
        }
    }

    /// One series' requote, carried in memory between the steps.
    struct Plan {
        uint256 id;
        uint256 unit; // collateral per qty unit
        uint256 used; // running `committed`
        uint256 fair;
        uint256 bid;
        uint256 ask;
        uint256 bidQty;
        uint256 askQty;
        uint256 minQ;
    }

    function _requoteOne(uint256 id, uint256 used) internal returns (uint256) {
        OptionsBook.Series memory s = book.getSeries(id);
        if (s.underlying != underlying) revert WrongUnderlying();
        used -= _cancelQuotes(id);
        if (s.state != 1 || block.timestamp + minTauSecs >= s.expiry) return used; // too late: quotes pulled, none posted
        _track(id);

        Plan memory p;
        p.id = id;
        p.used = used;
        p.unit = book.collateralFor(id, 1);
        p.minQ = book.minQty();
        _net(p);
        p.fair = _fair(s);
        (p.bid, p.ask) = _spread(p.fair, uint256(s.strike) / 100);
        if (p.bid != 0) _postBid(p);
        if (p.ask != 0) _postAsk(p);
        emit Quoted(id, p.fair, p.bid, p.bidQty, p.ask, p.askQty);
        return p.used;
    }

    /// Burn LONG+SHORT pairs: a pair is worth exactly its collateral, so
    /// holding both legs only ties up tUSDC.
    function _net(Plan memory p) internal {
        uint256 l = book.balanceOf(address(this), p.id << 1);
        uint256 sh = book.balanceOf(address(this), (p.id << 1) | 1);
        uint256 m = l < sh ? l : sh;
        if (m == 0) return;
        book.burnPair(p.id, m);
        p.used -= m * p.unit;
    }

    /// Buy LONG at the bid: net long within maxPosition, escrow within maxCommitted.
    function _postBid(Plan memory p) internal {
        uint256 l = book.balanceOf(address(this), p.id << 1);
        if (l >= maxPosition) return;
        uint256 q = _min(quoteQty, maxPosition - l);
        uint256 esc = _bidEscrow(p.bid, q);
        if (q < p.minQ || p.used + esc > maxCommitted || esc > collateral.balanceOf(address(this))) return;
        (uint256 oid,) = book.placeLimit(p.id, true, p.bid, q, false);
        quotes[p.id].bidId = oid;
        if (oid != 0) p.used += book.getOrder(oid).escrow;
        p.bidQty = q;
    }

    /// Sell LONG at the ask: the LONG the vault holds first, then write
    /// (mint) the rest, keeping net short within maxPosition and the new
    /// collateral within maxCommitted.
    function _postAsk(Plan memory p) internal {
        uint256 l = book.balanceOf(address(this), p.id << 1); // re-read: the bid may have bought some
        uint256 sh = book.balanceOf(address(this), (p.id << 1) | 1);
        uint256 q = quoteQty;
        uint256 need = q > l ? q - l : 0;
        if (need > 0 && need < p.minQ) need = p.minQ;
        if (
            need > 0
                && (
                    sh + need > maxPosition || p.used + need * p.unit > maxCommitted
                        || need * p.unit > collateral.balanceOf(address(this))
                )
        ) need = 0;
        if (need > 0) {
            book.mint(p.id, need);
            p.used += need * p.unit;
        }
        q = _min(q, l + need);
        if (q < p.minQ) return;
        (uint256 oid,) = book.placeLimit(p.id, false, p.ask, q, false);
        quotes[p.id].askId = oid;
        p.askQty = q;
    }


    /// Cancel the vault's open quotes on a series. Returns the bid escrow
    /// released (it leaves `committed`).
    function _cancelQuotes(uint256 id) internal returns (uint256 released) {
        Quote storage q = quotes[id];
        if (q.bidId != 0) {
            OptionsBook.OrderView memory v = book.getOrder(q.bidId);
            if (v.status == 1) {
                released = v.escrow;
                book.cancel(q.bidId);
            }
            q.bidId = 0;
        }
        if (q.askId != 0) {
            if (book.getOrder(q.askId).status == 1) book.cancel(q.askId);
            q.askId = 0;
        }
    }

    /* --------------------------------------------------------------- harvest */

    /// After expiry: pull quotes, settle if needed, redeem, stop tracking.
    /// Anyone may call; the proceeds stay in the vault.
    function harvest(uint256 id) external nonReentrant returns (uint256 amount) {
        OptionsBook.Series memory s = book.getSeries(id);
        if (block.timestamp < s.expiry) revert NotExpired();
        _cancelQuotes(id);
        if (s.state == 1) book.settle(id);
        amount = book.redeem(id);
        _untrack(id);
        emit Harvested(id, amount);
    }

    /* ----------------------------------------------------------------- vault */

    /// tUSDC committed to the book: writer collateral behind the vault's
    /// SHORT plus escrow of its resting bids, across tracked series.
    function committed() public view returns (uint256 total) {
        for (uint256 i; i < _tracked.length; ++i) {
            uint256 id = _tracked[i];
            total += book.collateralFor(id, book.balanceOf(address(this), (id << 1) | 1));
            uint256 bidId = quotes[id].bidId;
            if (bidId != 0) {
                OptionsBook.OrderView memory v = book.getOrder(bidId);
                if (v.status == 1) total += v.escrow;
            }
        }
    }

    /// Net asset value: idle tUSDC + bid escrow + positions at the model price.
    function nav() public view returns (uint256 total) {
        total = collateral.balanceOf(address(this)) + book.unclaimed(address(this));
        for (uint256 i; i < _tracked.length; ++i) {
            total += _seriesValue(_tracked[i]);
        }
    }

    function _seriesValue(uint256 id) internal view returns (uint256 v) {
        OptionsBook.Series memory s = book.getSeries(id);
        uint256 lid = id << 1;
        uint256 l = book.balanceOf(address(this), lid);
        uint256 sh = book.balanceOf(address(this), lid | 1);
        Quote storage q = quotes[id];
        if (q.bidId != 0) {
            OptionsBook.OrderView memory b = book.getOrder(q.bidId);
            if (b.status == 1) v += b.escrow;
        }
        if (q.askId != 0) {
            OptionsBook.OrderView memory a = book.getOrder(q.askId);
            if (a.status == 1) l += a.escrow; // LONG escrowed in the ask is still the vault's
        }
        uint256 unit = uint256(s.strike) / 1e4;
        uint256 f = _fair(s); // per option; ≤ max payout = unit × 100
        if (f > unit * 100) f = unit * 100;
        // LONG worth f per option, SHORT worth (max payout − f); both rounded against the vault
        v += (l * f) / 100 + sh * unit - (sh * f + 99) / 100;
    }

    function trackedSeries() external view returns (uint256[] memory) {
        return _tracked;
    }

    function deposit(uint256 assets) external nonReentrant returns (uint256 minted) {
        if (_tracked.length > 0) _fresh();
        uint256 n = nav();
        if (totalShares != 0 && n == 0) revert Insufficient();
        minted = totalShares == 0 ? assets : (assets * totalShares) / n;
        if (minted == 0) revert Insufficient();
        totalShares += minted;
        shares[msg.sender] += minted;
        if (!collateral.transferFrom(msg.sender, address(this), assets)) revert TransferFailed();
        emit Deposit(msg.sender, assets, minted);
    }

    /// Withdraw at NAV, paid from idle tUSDC only.
    function withdraw(uint256 burned) external nonReentrant returns (uint256 assets) {
        if (burned == 0 || burned > shares[msg.sender]) revert Insufficient();
        if (_tracked.length > 0) _fresh();
        assets = (burned * nav()) / totalShares;
        if (assets > collateral.balanceOf(address(this))) revert Insufficient();
        shares[msg.sender] -= burned;
        totalShares -= burned;
        if (!collateral.transfer(msg.sender, assets)) revert TransferFailed();
        emit Withdraw(msg.sender, assets, burned);
    }

    /* --------------------------------------------------------------- ERC-1155 */

    /// Accept positions only from the book, and only when the vault itself
    /// started the transfer (its own mint or taker fill): nobody can push
    /// tokens into the vault and distort its NAV or its caps.
    function onERC1155Received(address op, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(book) || op != address(this)) revert OnlyBook();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address op, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(book) || op != address(this)) revert OnlyBook();
        return this.onERC1155BatchReceived.selector;
    }

    /* --------------------------------------------------------------- helpers */

    function _bidEscrow(uint256 price, uint256 qty) internal view returns (uint256) {
        uint256 n = (price * qty) / 100;
        return n + (n * book.makerFeeBps()) / BPS;
    }

    function _track(uint256 id) internal {
        if (_trackedPos[id] != 0) return;
        if (_tracked.length >= MAX_SERIES) revert TooManySeries();
        _tracked.push(id);
        _trackedPos[id] = _tracked.length;
    }

    function _untrack(uint256 id) internal {
        uint256 pos = _trackedPos[id];
        if (pos == 0) return;
        uint256 last = _tracked[_tracked.length - 1];
        _tracked[pos - 1] = last;
        _trackedPos[last] = pos;
        _tracked.pop();
        _trackedPos[id] = 0;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
