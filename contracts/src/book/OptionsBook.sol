// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155Lite} from "./ERC1155Lite.sol";
import {TickBitmap} from "./TickBitmap.sol";
import {ISettlementOracle} from "./ISettlementOracle.sol";

interface IERC20Book {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/**
 * ROPES options book — fully collateralised European options on Hyperliquid
 * assets, traded on an onchain limit order book.
 *
 * MODEL ("option token + writer", like Opyn / Premia):
 *   A series is (underlying, expiry, strike, call|put). Anyone can WRITE it:
 *   `mint` locks the series' max payout in tUSDC and hands the writer one
 *   LONG and one SHORT token per option (ERC-1155, ids below). LONG is the
 *   option. SHORT is the claim on whatever collateral the LONG does not take.
 *   A LONG+SHORT pair is always worth exactly the max payout, so `burnPair`
 *   returns the collateral for a pair at any time.
 *   The order book trades LONG tokens against tUSDC, price-time priority.
 *   At expiry the keeper oracle supplies the settlement price; holders
 *   `redeem`: LONG gets the payoff, SHORT gets max payout − payoff.
 *
 * PAYOFF (per option, both in 1e8 price units, S = settlement, K = strike):
 *   call  min(max(S − K, 0), K)       — capped at K so it can be collateralised
 *   put   max(K − S, 0)               — never more than K
 *   so the max payout of one option is K, for calls and puts alike.
 *
 * UNITS
 *   collateral  tUSDC, 6 decimals ("usdc units")
 *   strike      uint64, 1e8 (Hyperliquid mark convention); must be a multiple
 *               of 1e4 ($0.0001) so the collateral per qty unit is exact
 *   qty         uint, in hundredths of an option: QTY_ONE = 100 is 1 option
 *               (1 option = 1 unit of the underlying)
 *   price       premium per ONE option, usdc units (6 dp); a multiple of
 *               TICK = 1000 ($0.001); 0 < price ≤ max payout (= K/100)
 *   notional    price × qty / 100 — exact, because TICK/100 is an integer
 *   collateral per qty unit  = K / 1e4 (usdc units per 0.01 option)
 *   payoff per qty unit      = floor(intrinsic / 1e4), fixed once at settlement;
 *               rounding (< $0.0001 per option) goes to SHORT, and because LONG
 *               and SHORT payouts come from the same per-unit numbers the sum
 *               of all payouts equals the collateral exactly.
 *
 * TOKEN IDS   LONG = seriesId << 1, SHORT = (seriesId << 1) | 1.
 *
 * FEES  makerFeeBps / takerFeeBps on the premium notional, in tUSDC, capped at
 *   MAX_FEE_BPS. A buyer pays notional + fee, a seller receives notional − fee.
 *   A resting order keeps the maker rate in force when it was placed (its
 *   escrow was sized on it). Fees accrue in the contract and are swept to
 *   `feeRecipient` by `withdrawFees`.
 *
 * DELIVERY NOTE (ERC-1155 receiver hook): transfers a user starts
 *   (safeTransferFrom / safeBatchTransferFrom), mints, and LONG bought as a
 *   taker run the receiver hook, after all state changes. LONG delivered to a
 *   resting BUY order when it fills, and LONG returned from a cancelled SELL
 *   order, are credited without the hook: the owner asked for them by placing
 *   the order, and calling arbitrary code once per fill inside the matching
 *   loop would hand every maker a way to grief takers.
 *
 * TRUST: the operator creates series; the settlement price comes from an
 *   oracle fixed at deployment (KeeperOracle in v1). The owner sets fees (capped)
 *   and can pause new orders and mints; it can never move user funds. Cancels,
 *   burns, redeems, claims and settlement always work, paused or not.
 */
contract OptionsBook is ERC1155Lite {
    using TickBitmap for TickBitmap.Bitmap;

    /* ------------------------------------------------------------ constants */

    uint256 public constant QTY_ONE = 100; // qty units per option
    uint256 public constant TICK = 1_000; // $0.001 in usdc units
    uint256 public constant STRIKE_UNIT = 1e4; // strike (1e8) per usdc unit per qty unit
    uint256 public constant MAX_TICK = type(uint32).max;
    uint256 public constant MAX_QTY = 1e12; // per order: 10 billion options
    uint256 public constant MAX_FILLS = 32; // matching-loop bound per call
    uint256 public constant MAX_FEE_BPS = 500;
    uint256 internal constant BPS = 10_000;

    uint8 public constant SERIES_NONE = 0;
    uint8 public constant SERIES_OPEN = 1;
    uint8 public constant SERIES_SETTLED = 2;

    uint8 public constant ORDER_NONE = 0;
    uint8 public constant ORDER_OPEN = 1;
    uint8 public constant ORDER_FILLED = 2;
    uint8 public constant ORDER_CANCELLED = 3;

    uint8 public constant CANCEL_USER = 0;
    uint8 public constant CANCEL_SELF_TRADE = 1;
    uint8 public constant CANCEL_REPLACED = 2;
    uint8 public constant CANCEL_EXPIRED = 3;

    uint256 internal constant ASK = 0;
    uint256 internal constant BID = 1;

    /* ---------------------------------------------------------------- types */

    struct Series {
        bytes32 underlying; // e.g. "HYPE"
        uint64 expiry; // unix seconds, a whole minute
        uint64 strike; // 1e8
        bool isCall;
        uint8 state; // SERIES_*
        uint64 payoffUnit; // usdc units per qty unit owed to LONG; set at settlement
        uint128 settlementPrice; // 1e8; set at settlement
        uint128 longSupply; // qty units outstanding
        uint128 shortSupply;
    }

    struct Order {
        // slot 0
        address owner;
        uint32 seriesId;
        uint32 tick; // price / TICK
        uint16 makerFeeBps; // maker rate in force when placed
        bool isBuy;
        uint8 status; // ORDER_*
        // slot 1
        uint48 qty; // remaining
        uint48 origQty;
        uint48 prev; // FIFO neighbours at this price level
        uint48 next;
        uint32 userIdx; // position in _userOrders[owner][seriesId]
    }

    struct Level {
        uint48 head; // oldest order (filled first)
        uint48 tail; // newest order
        uint128 qty; // aggregate remaining qty
    }

    /// Everything one call owes or is owed, settled in one place at the end
    /// (after every state change): net USDC with the caller, maker payouts,
    /// and LONG delivered to the caller (for the receiver hook).
    struct Ctx {
        uint256 usdcIn; // owed by msg.sender
        uint256 usdcOut; // owed to msg.sender
        uint256 longOut; // LONG delivered to msg.sender as a taker
        uint256 longId;
        // the taker leg of this call (one per call)
        uint256 filled;
        uint256 notional;
        uint256 takerFee;
        uint256 tBps;
        uint256 want; // qty the taker asked for
        uint256 side; // the resting side being taken (ASK for a buy)
        // maker payouts
        uint256 nPay;
        address[MAX_FILLS] payee;
        uint256[MAX_FILLS] pay;
    }

    struct OrderView {
        uint256 id;
        address owner;
        uint256 seriesId;
        bool isBuy;
        uint256 price;
        uint256 qty; // remaining
        uint256 origQty;
        uint256 filledQty;
        uint256 makerFeeBps;
        uint8 status;
        uint256 escrow; // usdc (buy) or LONG qty (sell) still held for it
    }

    /* -------------------------------------------------------------- storage */

    IERC20Book public immutable collateral;
    ISettlementOracle public immutable oracle;

    address public owner;
    address public operator;
    address public feeRecipient;
    bool public paused;

    uint16 public makerFeeBps;
    uint16 public takerFeeBps;
    /// Smallest order (qty units) accepted, so a price level cannot be
    /// stuffed with dust that costs takers a fill each.
    uint256 public minQty = 10;

    mapping(bytes32 => bool) public underlyingAllowed;

    uint32 public seriesCount;
    mapping(uint256 => Series) internal _series;
    mapping(bytes32 => uint32) internal _seriesByKey;

    uint48 public orderCount;
    mapping(uint256 => Order) internal _orders;
    /// (seriesId << 40) | (side << 32) | tick => level
    mapping(uint256 => Level) internal _levels;
    /// (seriesId << 1) | side => set of non-empty ticks
    mapping(uint256 => TickBitmap.Bitmap) internal _bitmaps;
    /// owner => seriesId => open order ids
    mapping(address => mapping(uint256 => uint48[])) internal _userOrders;

    /// Solvency accounting; see `requiredBalance`.
    uint256 public escrowedUsdc; // resting buy orders: notional + maker fee
    uint256 public totalLocked; // writers' collateral still owed to LONG/SHORT holders
    uint256 public accruedFees; // fees not yet swept to feeRecipient
    uint256 public totalUnclaimed; // maker payouts whose transfer failed
    mapping(address => uint256) public unclaimed;

    uint256 private _lock = 1;

    /* --------------------------------------------------------------- events */

    event OwnerSet(address owner);
    event OperatorSet(address operator);
    event FeeRecipientSet(address feeRecipient);
    event FeesSet(uint16 makerFeeBps, uint16 takerFeeBps);
    event MinQtySet(uint256 minQty);
    event UnderlyingSet(bytes32 indexed underlying, bool allowed);
    event PausedSet(bool paused);

    event SeriesCreated(
        uint256 indexed seriesId,
        bytes32 indexed underlying,
        uint64 expiry,
        uint64 strike,
        bool isCall,
        uint256 longId,
        uint256 shortId
    );
    event Minted(uint256 indexed seriesId, address indexed writer, uint256 qty, uint256 collateral);
    event PairBurned(uint256 indexed seriesId, address indexed holder, uint256 qty, uint256 collateral);
    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed seriesId,
        address indexed owner,
        bool isBuy,
        uint256 price,
        uint256 qty,
        uint16 makerFeeBps
    );
    event OrderFilled(
        uint256 indexed seriesId,
        uint256 indexed makerOrderId,
        address indexed maker,
        address taker,
        bool takerIsBuy,
        uint256 price,
        uint256 qty,
        uint256 makerFee,
        uint256 takerFee
    );
    event OrderCancelled(
        uint256 indexed orderId, uint256 indexed seriesId, address indexed owner, uint256 remainingQty, uint8 reason
    );
    /// One per taker call: what was asked, what filled, what rested.
    event TakerTrade(
        uint256 indexed seriesId,
        address indexed taker,
        bool isBuy,
        uint256 limitPrice,
        uint256 qty,
        uint256 filledQty,
        uint256 notional,
        uint256 takerFee,
        uint256 restingOrderId
    );
    event SeriesSettled(uint256 indexed seriesId, uint128 settlementPrice, uint256 payoffPerOption);
    event Redeemed(uint256 indexed seriesId, address indexed holder, uint256 longQty, uint256 shortQty, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PaymentDeferred(address indexed to, uint256 amount);
    event Claimed(address indexed to, uint256 amount);

    /* --------------------------------------------------------------- errors */

    error NotOwner();
    error NotOperator();
    error NotOrderOwner();
    error Paused();
    error Reentrancy();
    error BadParam();
    error BadPrice();
    error BadQty();
    error UnknownSeries();
    error SeriesExists();
    error UnderlyingNotAllowed();
    error Expired();
    error NotExpired();
    error AlreadySettled();
    error PriceNotReady();
    error OrderNotOpen();
    error PostOnlyWouldCross();
    error InsufficientLong();
    error TransferFailed();
    error NoTransferToBook();

    /* ------------------------------------------------------------ modifiers */

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address _collateral, address _oracle, address _operator, address _feeRecipient) {
        if (_collateral == address(0) || _oracle == address(0) || _feeRecipient == address(0)) revert BadParam();
        collateral = IERC20Book(_collateral);
        oracle = ISettlementOracle(_oracle);
        owner = msg.sender;
        operator = _operator;
        feeRecipient = _feeRecipient;
        underlyingAllowed["HYPE"] = true;
        emit OwnerSet(msg.sender);
        emit OperatorSet(_operator);
        emit FeeRecipientSet(_feeRecipient);
        emit UnderlyingSet("HYPE", true);
    }

    /* ================================================================ admin */

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert BadParam();
        owner = next;
        emit OwnerSet(next);
    }

    function setOperator(address next) external onlyOwner {
        operator = next;
        emit OperatorSet(next);
    }

    function setFeeRecipient(address next) external onlyOwner {
        if (next == address(0)) revert BadParam();
        feeRecipient = next;
        emit FeeRecipientSet(next);
    }

    /// New rates apply to taker fills from now on and to orders placed from
    /// now on; resting orders keep the maker rate they were placed with.
    function setFees(uint16 _makerFeeBps, uint16 _takerFeeBps) external onlyOwner {
        if (_makerFeeBps > MAX_FEE_BPS || _takerFeeBps > MAX_FEE_BPS) revert BadParam();
        makerFeeBps = _makerFeeBps;
        takerFeeBps = _takerFeeBps;
        emit FeesSet(_makerFeeBps, _takerFeeBps);
    }

    function setMinQty(uint256 q) external onlyOwner {
        if (q == 0 || q > 100 * QTY_ONE) revert BadParam();
        minQty = q;
        emit MinQtySet(q);
    }

    function setUnderlying(bytes32 underlying, bool allowed) external onlyOwner {
        underlyingAllowed[underlying] = allowed;
        emit UnderlyingSet(underlying, allowed);
    }

    /// Pauses new orders and mints only. Cancels, burns, settlement, redeems,
    /// claims and fee sweeps keep working.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /* =============================================================== series */

    function createSeries(bytes32 underlying, uint64 expiry, uint64 strike, bool isCall)
        external
        onlyOperator
        returns (uint256 id)
    {
        if (!underlyingAllowed[underlying]) revert UnderlyingNotAllowed();
        if (expiry <= block.timestamp || expiry % 60 != 0) revert BadParam();
        // strike a multiple of $0.0001, max payout at least one tick, and
        // every price up to the max payout addressable by a 32-bit tick
        if (strike == 0 || strike % STRIKE_UNIT != 0) revert BadParam();
        uint256 maxPay = uint256(strike) / 100;
        if (maxPay < TICK || maxPay / TICK > MAX_TICK) revert BadParam();

        bytes32 key = _seriesKey(underlying, expiry, strike, isCall);
        if (_seriesByKey[key] != 0) revert SeriesExists();
        id = ++seriesCount;
        _seriesByKey[key] = uint32(id);
        Series storage s = _series[id];
        s.underlying = underlying;
        s.expiry = expiry;
        s.strike = strike;
        s.isCall = isCall;
        s.state = SERIES_OPEN;
        emit SeriesCreated(id, underlying, expiry, strike, isCall, id << 1, (id << 1) | 1);
    }

    /* ======================================================== write/unwrite */

    /// Write `qty` (hundredths of an option): lock qty × (K/1e4) tUSDC and
    /// receive qty LONG + qty SHORT.
    function mint(uint256 seriesId, uint256 qty) external nonReentrant whenNotPaused {
        Series storage s = _tradable(seriesId);
        Ctx memory c;
        c.longId = seriesId << 1;
        _mintPair(c, seriesId, s, qty);
        _finish(c);
        _mintHook(seriesId, qty);
    }

    /// Return `qty` LONG + `qty` SHORT for their collateral. A pair is worth
    /// the max payout whatever the settlement price, so this works at any
    /// time — before or after expiry, settled or not, paused or not.
    function burnPair(uint256 seriesId, uint256 qty) external nonReentrant returns (uint256 amount) {
        Series storage s = _series[seriesId];
        if (s.state == SERIES_NONE) revert UnknownSeries();
        if (qty == 0) revert BadQty();
        amount = qty * _unitCollateral(s);
        _burn(msg.sender, seriesId << 1, qty);
        _burn(msg.sender, (seriesId << 1) | 1, qty);
        s.longSupply -= uint128(qty);
        s.shortSupply -= uint128(qty);
        totalLocked -= amount;
        emit PairBurned(seriesId, msg.sender, qty, amount);
        _send(msg.sender, amount);
    }

    /* =============================================================== orders */

    /**
     * Place a limit order for `qty` LONG at `price` (premium per option).
     * It first trades against the opposite side as a taker, best price first,
     * up to MAX_FILLS resting orders; the rest rests on the book as a maker —
     * unless the loop bound stopped it while it still crosses, in which case
     * the unfilled rest is not placed (see TakerTrade.restingOrderId == 0 and
     * filledQty < qty) and the caller can simply send it again.
     * `postOnly` rejects an order that would trade at all.
     * Buy orders pay notional + fees in tUSDC; sell orders need the LONG.
     */
    function placeLimit(uint256 seriesId, bool isBuy, uint256 price, uint256 qty, bool postOnly)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId, uint256 filled)
    {
        Series storage s = _tradable(seriesId);
        Ctx memory c;
        c.longId = seriesId << 1;
        (orderId, filled) = _placeLimit(c, seriesId, s, isBuy, price, qty, postOnly);
        _finish(c);
    }

    /// Immediate-or-cancel: trade up to `qty` at prices no worse than
    /// `limitPrice` (the slippage guard); nothing rests.
    function placeMarket(uint256 seriesId, bool isBuy, uint256 qty, uint256 limitPrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 filled, uint256 notional, uint256 fee)
    {
        Series storage s = _tradable(seriesId);
        Ctx memory c;
        c.longId = seriesId << 1;
        (filled, notional, fee) = _placeIOC(c, seriesId, s, isBuy, qty, limitPrice);
        _finish(c);
    }

    /// Cancel an open order and get its escrow back. Only the owner before
    /// expiry; ANYONE after expiry (the refund always goes to the owner).
    function cancel(uint256 orderId) external nonReentrant {
        _cancelPublic(orderId);
    }

    function cancelMany(uint256[] calldata orderIds) external nonReentrant {
        for (uint256 i; i < orderIds.length; ++i) {
            _cancelPublic(orderIds[i]);
        }
    }

    /// Cancel an order and place a new one on the same series and side, with
    /// the escrow netted in one transfer. The new order goes to the back of
    /// its price level's queue.
    function cancelReplace(uint256 orderId, uint256 newPrice, uint256 newQty, bool postOnly)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 newOrderId, uint256 filled)
    {
        Order storage o = _orders[orderId];
        if (o.status != ORDER_OPEN) revert OrderNotOpen();
        if (o.owner != msg.sender) revert NotOrderOwner();
        uint256 seriesId = o.seriesId;
        bool isBuy = o.isBuy;
        Series storage s = _tradable(seriesId);
        Ctx memory c;
        c.longId = seriesId << 1;
        c.usdcOut += _cancelOrder(orderId, CANCEL_REPLACED);
        (newOrderId, filled) = _placeLimit(c, seriesId, s, isBuy, newPrice, newQty, postOnly);
        _finish(c);
    }

    /// Write `qty` and offer the LONG at `price` in one call (sell to open).
    /// The caller keeps the SHORT; the premium from any fill nets against
    /// the collateral pulled.
    function mintAndSell(uint256 seriesId, uint256 qty, uint256 price, bool postOnly)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId, uint256 filled)
    {
        Series storage s = _tradable(seriesId);
        Ctx memory c;
        c.longId = seriesId << 1;
        _mintPair(c, seriesId, s, qty);
        (orderId, filled) = _placeLimit(c, seriesId, s, false, price, qty, postOnly);
        _finish(c);
        _mintHook(seriesId, qty);
    }

    /// Close a short: buy up to `qty` LONG at no worse than `maxPrice`
    /// (immediate-or-cancel) and burn each one bought with a SHORT the caller
    /// holds, receiving the pair's collateral. Net tUSDC in one transfer.
    function buyAndBurn(uint256 seriesId, uint256 qty, uint256 maxPrice)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 filled, uint256 netPaid)
    {
        Series storage s = _tradable(seriesId);
        if (_balances[(seriesId << 1) | 1][msg.sender] < qty) revert BadQty();
        Ctx memory c;
        c.longId = seriesId << 1;
        uint256 notional;
        uint256 fee;
        (filled, notional, fee) = _placeIOC(c, seriesId, s, true, qty, maxPrice);
        if (filled > 0) {
            uint256 amount = filled * _unitCollateral(s);
            _burn(msg.sender, seriesId << 1, filled);
            _burn(msg.sender, (seriesId << 1) | 1, filled);
            s.longSupply -= uint128(filled);
            s.shortSupply -= uint128(filled);
            totalLocked -= amount;
            c.usdcOut += amount;
            c.longOut -= filled; // burned at once: nothing delivered to the hook
            emit PairBurned(seriesId, msg.sender, filled, amount);
        }
        netPaid = c.usdcIn > c.usdcOut ? c.usdcIn - c.usdcOut : 0;
        _finish(c);
    }

    /* =========================================================== settlement */

    /// Fix the settlement price and payoff from the oracle. Anyone, once the
    /// oracle reports a final price for the expiry. `redeem` calls it lazily.
    function settle(uint256 seriesId) public {
        Series storage s = _series[seriesId];
        if (s.state == SERIES_NONE) revert UnknownSeries();
        if (s.state == SERIES_SETTLED) revert AlreadySettled();
        if (block.timestamp < s.expiry) revert NotExpired();
        (uint128 price, bool ready) = oracle.settlementPrice(s.underlying, s.expiry);
        if (!ready || price == 0) revert PriceNotReady();

        uint256 k = s.strike;
        uint256 intrinsic;
        if (s.isCall) {
            intrinsic = price > k ? price - k : 0;
            if (intrinsic > k) intrinsic = k; // the cap
        } else {
            intrinsic = k > price ? k - price : 0;
        }
        uint256 payoffUnit = intrinsic / STRIKE_UNIT; // floor: rounding goes to SHORT
        s.payoffUnit = uint64(payoffUnit);
        s.settlementPrice = price;
        s.state = SERIES_SETTLED;
        emit SeriesSettled(seriesId, price, payoffUnit * QTY_ONE);
    }

    /// Burn all of the caller's LONG and SHORT of a settled series and pay
    /// LONG × payoff + SHORT × (max payout − payoff). Settles first if needed.
    /// LONG still escrowed in the caller's open sell orders is not included:
    /// cancel those first (anyone may cancel them after expiry).
    function redeem(uint256 seriesId) external nonReentrant returns (uint256 amount) {
        Series storage s = _series[seriesId];
        if (s.state == SERIES_OPEN) settle(seriesId);
        if (s.state != SERIES_SETTLED) revert UnknownSeries();
        uint256 longId = seriesId << 1;
        uint256 shortId = longId | 1;
        uint256 l = _balances[longId][msg.sender];
        uint256 sh = _balances[shortId][msg.sender];
        if (l == 0 && sh == 0) return 0;
        uint256 pu = s.payoffUnit;
        amount = l * pu + sh * (_unitCollateral(s) - pu);
        if (l > 0) _burn(msg.sender, longId, l);
        if (sh > 0) _burn(msg.sender, shortId, sh);
        s.longSupply -= uint128(l);
        s.shortSupply -= uint128(sh);
        totalLocked -= amount;
        emit Redeemed(seriesId, msg.sender, l, sh, amount);
        _send(msg.sender, amount);
    }

    /* ================================================================= fees */

    /// Sweep accrued fees to `feeRecipient`. Anyone may call.
    function withdrawFees() external nonReentrant returns (uint256 amount) {
        amount = accruedFees;
        accruedFees = 0;
        emit FeesWithdrawn(feeRecipient, amount);
        _send(feeRecipient, amount);
    }

    /// Collect maker payouts that could not be pushed when the fill happened.
    function claim() external nonReentrant returns (uint256 amount) {
        amount = unclaimed[msg.sender];
        unclaimed[msg.sender] = 0;
        totalUnclaimed -= amount;
        emit Claimed(msg.sender, amount);
        _send(msg.sender, amount);
    }

    /* ================================================================ views */

    function seriesId(bytes32 underlying, uint64 expiry, uint64 strike, bool isCall) external view returns (uint256) {
        return _seriesByKey[_seriesKey(underlying, expiry, strike, isCall)];
    }

    function getSeries(uint256 id) external view returns (Series memory) {
        return _series[id];
    }

    /// Series that have not expired yet.
    function liveSeries() external view returns (uint256[] memory ids) {
        uint256 n = seriesCount;
        uint256 live;
        for (uint256 i = 1; i <= n; ++i) {
            if (_series[i].expiry > block.timestamp) ++live;
        }
        ids = new uint256[](live);
        uint256 j;
        for (uint256 i = 1; i <= n; ++i) {
            if (_series[i].expiry > block.timestamp) ids[j++] = i;
        }
    }

    function longId(uint256 id) external pure returns (uint256) {
        return id << 1;
    }

    function shortId(uint256 id) external pure returns (uint256) {
        return (id << 1) | 1;
    }

    /// Max payout of ONE option, usdc units (= strike / 100).
    function maxPayout(uint256 id) external view returns (uint256) {
        return uint256(_series[id].strike) / 100;
    }

    /// Collateral `qty` costs to write, usdc units.
    function collateralFor(uint256 id, uint256 qty) external view returns (uint256) {
        return qty * _unitCollateral(_series[id]);
    }

    function bestBid(uint256 id) external view returns (uint256 price, uint256 qty) {
        (uint256 t, bool ok) = _bitmaps[_bkey(id, BID)].highest();
        if (!ok) return (0, 0);
        return (t * TICK, _levels[_lkey(id, BID, t)].qty);
    }

    function bestAsk(uint256 id) external view returns (uint256 price, uint256 qty) {
        (uint256 t, bool ok) = _bitmaps[_bkey(id, ASK)].lowest();
        if (!ok) return (0, 0);
        return (t * TICK, _levels[_lkey(id, ASK, t)].qty);
    }

    /// Top `n` price levels on each side, best first, with aggregate qty.
    function depth(uint256 id, uint256 n)
        external
        view
        returns (uint256[] memory bidPx, uint256[] memory bidQty, uint256[] memory askPx, uint256[] memory askQty)
    {
        bidPx = new uint256[](n);
        bidQty = new uint256[](n);
        askPx = new uint256[](n);
        askQty = new uint256[](n);
        TickBitmap.Bitmap storage bb = _bitmaps[_bkey(id, BID)];
        TickBitmap.Bitmap storage ab = _bitmaps[_bkey(id, ASK)];
        uint256 i;
        (uint256 t, bool ok) = bb.highest();
        while (ok && i < n) {
            bidPx[i] = t * TICK;
            bidQty[i] = _levels[_lkey(id, BID, t)].qty;
            ++i;
            (t, ok) = bb.nextBelow(t);
        }
        _shrink(bidPx, i);
        _shrink(bidQty, i);
        i = 0;
        (t, ok) = ab.lowest();
        while (ok && i < n) {
            askPx[i] = t * TICK;
            askQty[i] = _levels[_lkey(id, ASK, t)].qty;
            ++i;
            (t, ok) = ab.nextAbove(t);
        }
        _shrink(askPx, i);
        _shrink(askQty, i);
    }

    /// Order ids queued at one price level, oldest first (bounded by `max`).
    function levelOrders(uint256 id, bool isBuy, uint256 price, uint256 max)
        external
        view
        returns (uint256[] memory ids)
    {
        ids = new uint256[](max);
        uint256 oid = _levels[_lkey(id, isBuy ? BID : ASK, price / TICK)].head;
        uint256 i;
        while (oid != 0 && i < max) {
            ids[i++] = oid;
            oid = _orders[oid].next;
        }
        _shrink(ids, i);
    }

    function getOrder(uint256 orderId) external view returns (OrderView memory v) {
        Order storage o = _orders[orderId];
        v.id = orderId;
        v.owner = o.owner;
        v.seriesId = o.seriesId;
        v.isBuy = o.isBuy;
        v.price = uint256(o.tick) * TICK;
        v.qty = o.qty;
        v.origQty = o.origQty;
        v.filledQty = o.origQty - o.qty; // for a cancelled order: what filled before the cancel
        v.makerFeeBps = o.makerFeeBps;
        v.status = o.status;
        if (o.status == ORDER_OPEN) {
            v.escrow = o.isBuy ? _buyEscrow(o.tick, o.qty, o.makerFeeBps) : o.qty;
        }
    }

    function openOrders(address user, uint256 id) external view returns (uint256[] memory ids) {
        uint48[] storage list = _userOrders[user][id];
        ids = new uint256[](list.length);
        for (uint256 i; i < list.length; ++i) {
            ids[i] = list[i];
        }
    }

    /// The tUSDC this contract must hold at all times. Its balance is never
    /// below this (the invariant the tests fuzz).
    function requiredBalance() public view returns (uint256) {
        return escrowedUsdc + totalLocked + accruedFees + totalUnclaimed;
    }

    /// What `qty` costs a buyer at `price` including the current taker fee,
    /// or what a seller receives net of it.
    function takerQuote(uint256 price, uint256 qty, bool isBuy) external view returns (uint256) {
        uint256 n = (price * qty) / QTY_ONE;
        uint256 fee = (n * takerFeeBps) / BPS;
        return isBuy ? n + fee : n - fee;
    }

    /* ============================================================= internal */

    function _seriesKey(bytes32 underlying, uint64 expiry, uint64 strike, bool isCall) internal pure returns (bytes32) {
        return keccak256(abi.encode(underlying, expiry, strike, isCall));
    }

    function _lkey(uint256 id, uint256 side, uint256 tick) internal pure returns (uint256) {
        return (id << 40) | (side << 32) | tick;
    }

    function _bkey(uint256 id, uint256 side) internal pure returns (uint256) {
        return (id << 1) | side;
    }

    function _unitCollateral(Series storage s) internal view returns (uint256) {
        return uint256(s.strike) / STRIKE_UNIT;
    }

    function _tradable(uint256 id) internal view returns (Series storage s) {
        s = _series[id];
        if (s.state == SERIES_NONE) revert UnknownSeries();
        if (block.timestamp >= s.expiry || s.state != SERIES_OPEN) revert Expired();
    }

    /// price → tick; price must be a positive multiple of TICK, at most the max payout.
    function _tickOf(Series storage s, uint256 price) internal view returns (uint256) {
        if (price == 0 || price % TICK != 0 || price > uint256(s.strike) / 100) revert BadPrice();
        return price / TICK;
    }

    function _checkQty(uint256 qty) internal view {
        if (qty < minQty || qty > MAX_QTY) revert BadQty();
    }

    /// notional of `qty` at `tick`: tick·TICK·qty/QTY_ONE = tick·10·qty, exact.
    function _notional(uint256 tick, uint256 qty) internal pure returns (uint256) {
        return tick * (TICK / QTY_ONE) * qty;
    }

    function _fee(uint256 notional, uint256 bps) internal pure returns (uint256) {
        return (notional * bps) / BPS;
    }

    /// What a resting buy order of `qty` at `tick` holds: notional + maker fee.
    /// Defined on the REMAINING qty, so a fill consumes exactly
    /// escrow(before) − escrow(after) and the escrow can never run short.
    function _buyEscrow(uint256 tick, uint256 qty, uint256 bps) internal pure returns (uint256) {
        uint256 n = _notional(tick, qty);
        return n + _fee(n, bps);
    }

    function _mintPair(Ctx memory c, uint256 id, Series storage s, uint256 qty) internal {
        _checkQty(qty);
        uint256 amount = qty * _unitCollateral(s);
        uint256 lid = id << 1;
        _balances[lid][msg.sender] += qty;
        _balances[lid | 1][msg.sender] += qty;
        s.longSupply += uint128(qty);
        s.shortSupply += uint128(qty);
        totalLocked += amount;
        c.usdcIn += amount;
        uint256[] memory ids = new uint256[](2);
        uint256[] memory vals = new uint256[](2);
        ids[0] = lid;
        ids[1] = lid | 1;
        vals[0] = qty;
        vals[1] = qty;
        emit TransferBatch(msg.sender, address(0), msg.sender, ids, vals);
        emit Minted(id, msg.sender, qty, amount);
    }

    function _mintHook(uint256 id, uint256 qty) internal {
        if (msg.sender.code.length == 0) return;
        uint256[] memory ids = new uint256[](2);
        uint256[] memory vals = new uint256[](2);
        ids[0] = id << 1;
        ids[1] = (id << 1) | 1;
        vals[0] = qty;
        vals[1] = qty;
        _checkBatchReceived(msg.sender, address(0), msg.sender, ids, vals, "");
    }

    function _placeLimit(
        Ctx memory c,
        uint256 id,
        Series storage s,
        bool isBuy,
        uint256 price,
        uint256 qty,
        bool postOnly
    ) internal returns (uint256 orderId, uint256 filled) {
        uint256 tick = _tickOf(s, price);
        _checkQty(qty);
        if (!isBuy && _balances[c.longId][msg.sender] < qty) revert InsufficientLong();
        if (postOnly && _crosses(id, isBuy, tick)) revert PostOnlyWouldCross();

        _take(c, id, isBuy, tick, qty);
        filled = c.filled;
        // Rest only what no longer crosses: the fill bound may have stopped
        // the loop with marketable orders left, and a crossed book is never ok.
        if (qty > filled && !_crosses(id, isBuy, tick)) {
            orderId = _rest(c, id, isBuy, tick, qty - filled);
        }
        _emitTaker(c, id, isBuy, price, qty, orderId);
    }

    function _emitTaker(Ctx memory c, uint256 id, bool isBuy, uint256 price, uint256 qty, uint256 orderId) internal {
        emit TakerTrade(id, msg.sender, isBuy, price, qty, c.filled, c.notional, c.takerFee, orderId);
    }

    function _placeIOC(Ctx memory c, uint256 id, Series storage s, bool isBuy, uint256 qty, uint256 limitPrice)
        internal
        returns (uint256 filled, uint256 notional, uint256 fee)
    {
        uint256 tick = _tickOf(s, limitPrice);
        _checkQty(qty);
        if (!isBuy && _balances[c.longId][msg.sender] < qty) revert InsufficientLong();
        _take(c, id, isBuy, tick, qty);
        (filled, notional, fee) = (c.filled, c.notional, c.takerFee);
        emit TakerTrade(id, msg.sender, isBuy, limitPrice, qty, filled, notional, fee, 0);
    }

    function _crosses(uint256 id, bool isBuy, uint256 tick) internal view returns (bool) {
        if (isBuy) {
            (uint256 t, bool ok) = _bitmaps[_bkey(id, ASK)].lowest();
            return ok && t <= tick;
        }
        (uint256 t2, bool ok2) = _bitmaps[_bkey(id, BID)].highest();
        return ok2 && t2 >= tick;
    }

    /**
     * The matching loop: take resting orders on the opposite side, best price
     * first and oldest first at a price, while they are at `limitTick` or
     * better, until `qty` is filled or MAX_FILLS resting orders were touched.
     * A resting order of the taker's own is cancelled (and refunded to them),
     * never filled, and counts toward the bound.
     */
    /// Results land in c.filled / c.notional / c.takerFee.
    function _take(Ctx memory c, uint256 id, bool isBuy, uint256 limitTick, uint256 qty) internal {
        c.want = qty;
        c.tBps = takerFeeBps;
        c.side = isBuy ? ASK : BID;
        TickBitmap.Bitmap storage bm = _bitmaps[_bkey(id, c.side)];
        (uint256 best, bool ok) = isBuy ? bm.lowest() : bm.highest();
        uint256 touched;

        while (c.filled < qty && ok && touched < MAX_FILLS && (isBuy ? best <= limitTick : best >= limitTick)) {
            ++touched;
            uint256 oid = _levels[_lkey(id, c.side, best)].head;
            if (_orders[oid].owner == msg.sender) {
                // Self-trade prevention: cancel the resting order. A buy
                // order's escrow comes back as tUSDC; a sell order's LONG is
                // returned inside _cancelOrder.
                c.usdcOut += _cancelOrder(oid, CANCEL_SELF_TRADE);
            } else {
                _fill(c, id, isBuy, best, oid);
            }
            if (_levels[_lkey(id, c.side, best)].head == 0) (best, ok) = isBuy ? bm.lowest() : bm.highest();
        }
    }

    /// Fill as much of the taker's remaining qty as resting order `oid` at `tick` holds.
    function _fill(Ctx memory c, uint256 id, bool takerIsBuy, uint256 tick, uint256 oid) internal {
        Order storage o = _orders[oid];
        address maker = o.owner;
        (uint256 q, uint256 mFee) = _consume(c, id, tick, oid);
        uint256 n = _notional(tick, q);
        uint256 tFee = _fee(n, c.tBps);
        c.filled += q;
        c.notional += n;
        c.takerFee += tFee;

        if (takerIsBuy) {
            // LONG out of the maker's escrow to the taker; tUSDC from the taker to the maker.
            _move(address(this), msg.sender, c.longId, q);
            c.longOut += q;
            c.usdcIn += n + tFee;
            _addPayee(c, maker, n - mFee);
        } else {
            // LONG from the taker to the maker; tUSDC out of the maker's escrow to the taker.
            _move(msg.sender, maker, c.longId, q);
            escrowedUsdc -= n + mFee;
            c.usdcOut += n - tFee;
        }
        accruedFees += mFee + tFee;
        emit OrderFilled(id, oid, maker, msg.sender, takerIsBuy, tick * TICK, q, mFee, tFee);
    }

    /// Book-keeping half of a fill: take q off the resting order and its
    /// level, retire the order if it is done. Returns q and the maker fee.
    function _consume(Ctx memory c, uint256 id, uint256 tick, uint256 oid) internal returns (uint256 q, uint256 mFee) {
        Order storage o = _orders[oid];
        uint256 rem = o.qty;
        {
            uint256 want = c.want - c.filled;
            q = want < rem ? want : rem;
        }
        // The maker fee is the change in the order's escrowed fee, so the
        // fees over all of an order's fills never exceed what it escrowed.
        mFee = _fee(_notional(tick, rem), o.makerFeeBps) - _fee(_notional(tick, rem - q), o.makerFeeBps);

        o.qty = uint48(rem - q);
        Level storage lv = _levels[_lkey(id, c.side, tick)];
        lv.qty -= uint128(q);
        if (rem == q) {
            o.status = ORDER_FILLED;
            _unlink(lv, o);
            _removeUserOrder(o.owner, id, o);
            if (lv.head == 0) _clearTick(id, c.side, tick);
        }
    }

    function _clearTick(uint256 id, uint256 side, uint256 tick) internal {
        _bitmaps[_bkey(id, side)].clear(tick);
    }

    function _rest(Ctx memory c, uint256 id, bool isBuy, uint256 tick, uint256 qty) internal returns (uint256 oid) {
        oid = ++orderCount;
        uint256 side = isBuy ? BID : ASK;
        uint16 bps = makerFeeBps;
        Order storage o = _orders[oid];
        o.owner = msg.sender;
        o.seriesId = uint32(id);
        o.tick = uint32(tick);
        o.makerFeeBps = bps;
        o.isBuy = isBuy;
        o.status = ORDER_OPEN;
        o.qty = uint48(qty);
        o.origQty = uint48(qty);

        Level storage lv = _levels[_lkey(id, side, tick)];
        uint48 tail = lv.tail;
        if (tail == 0) {
            lv.head = uint48(oid);
            _bitmaps[_bkey(id, side)].set(tick);
        } else {
            _orders[tail].next = uint48(oid);
            o.prev = tail;
        }
        lv.tail = uint48(oid);
        lv.qty += uint128(qty);

        uint48[] storage list = _userOrders[msg.sender][id];
        o.userIdx = uint32(list.length);
        list.push(uint48(oid));

        if (isBuy) {
            uint256 esc = _buyEscrow(tick, qty, bps);
            escrowedUsdc += esc;
            c.usdcIn += esc;
        } else {
            _move(msg.sender, address(this), c.longId, qty);
        }
        emit OrderPlaced(oid, id, msg.sender, isBuy, tick * TICK, qty, bps);
    }

    /// Remove an open order from the book. A sell order's LONG goes back to
    /// its owner here; a buy order's tUSDC escrow is returned as `refund` for
    /// the caller to pay out.
    function _cancelOrder(uint256 oid, uint8 reason) internal returns (uint256 refund) {
        Order storage o = _orders[oid];
        uint256 id = o.seriesId;
        uint256 side = o.isBuy ? BID : ASK;
        uint256 tick = o.tick;
        uint256 rem = o.qty;
        address who = o.owner;

        Level storage lv = _levels[_lkey(id, side, tick)];
        _unlink(lv, o);
        lv.qty -= uint128(rem);
        if (lv.head == 0) _bitmaps[_bkey(id, side)].clear(tick);
        _removeUserOrder(who, id, o);
        o.status = ORDER_CANCELLED;

        if (o.isBuy) {
            refund = _buyEscrow(tick, rem, o.makerFeeBps);
            escrowedUsdc -= refund;
        } else {
            _move(address(this), who, id << 1, rem);
        }
        emit OrderCancelled(oid, id, who, rem, reason);
    }

    function _cancelPublic(uint256 oid) internal {
        Order storage o = _orders[oid];
        if (o.status != ORDER_OPEN) revert OrderNotOpen();
        address who = o.owner;
        uint8 reason = CANCEL_USER;
        if (msg.sender != who) {
            if (block.timestamp < _series[o.seriesId].expiry) revert NotOrderOwner();
            reason = CANCEL_EXPIRED;
        }
        uint256 refund = _cancelOrder(oid, reason);
        if (who == msg.sender) _send(who, refund);
        else _payOrCredit(who, refund);
    }

    function _unlink(Level storage lv, Order storage o) internal {
        uint48 p = o.prev;
        uint48 n = o.next;
        if (p != 0) _orders[p].next = n;
        else lv.head = n;
        if (n != 0) _orders[n].prev = p;
        else lv.tail = p;
        o.prev = 0;
        o.next = 0;
    }

    function _removeUserOrder(address who, uint256 id, Order storage o) internal {
        uint48[] storage list = _userOrders[who][id];
        uint256 idx = o.userIdx;
        uint256 last = list.length - 1;
        if (idx != last) {
            uint48 moved = list[last];
            list[idx] = moved;
            _orders[moved].userIdx = uint32(idx);
        }
        list.pop();
    }

    function _addPayee(Ctx memory c, address who, uint256 amount) internal pure {
        uint256 n = c.nPay;
        if (n > 0 && c.payee[n - 1] == who) {
            c.pay[n - 1] += amount;
            return;
        }
        c.payee[n] = who;
        c.pay[n] = amount;
        c.nPay = n + 1;
    }

    /// The only place a trading call moves tokens out of / into the caller:
    /// every state change is already done.
    function _finish(Ctx memory c) internal {
        if (c.usdcIn > c.usdcOut) _pull(msg.sender, c.usdcIn - c.usdcOut);
        else if (c.usdcOut > c.usdcIn) _send(msg.sender, c.usdcOut - c.usdcIn);
        for (uint256 i; i < c.nPay; ++i) {
            _payOrCredit(c.payee[i], c.pay[i]);
        }
        if (c.longOut > 0) _checkReceived(msg.sender, address(this), msg.sender, c.longId, c.longOut, "");
    }

    /* ------------------------------------------------------------- transfer */

    function _beforeUserTransfer(address, address to) internal view override {
        // LONG held by the book is order escrow; a direct transfer in would be lost.
        if (to == address(this)) revert NoTransferToBook();
    }

    function _pull(address from, uint256 amount) internal {
        if (amount == 0) return;
        if (!collateral.transferFrom(from, address(this), amount)) revert TransferFailed();
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!collateral.transfer(to, amount)) revert TransferFailed();
    }

    /// Pay a third party (a maker, or an order owner on an expiry cancel).
    /// If the transfer fails (e.g. a blocklisted address on a real stablecoin)
    /// the amount is credited to `unclaimed` instead, so one bad counterparty
    /// can never block everyone else's trades.
    function _payOrCredit(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory ret) =
            address(collateral).call(abi.encodeWithSelector(IERC20Book.transfer.selector, to, amount));
        if (ok && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool))))) return;
        unclaimed[to] += amount;
        totalUnclaimed += amount;
        emit PaymentDeferred(to, amount);
    }

    function _shrink(uint256[] memory a, uint256 n) internal pure {
        assembly {
            mstore(a, n)
        }
    }
}
