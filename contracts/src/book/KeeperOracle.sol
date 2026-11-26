// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISettlementOracle} from "./ISettlementOracle.sol";

/**
 * Settlement prices for the ROPES options book, posted by a keeper.
 *
 * The price an expiry settles at is the OPEN of the Hyperliquid one-minute
 * candle that starts at the expiry time (a public, after-the-fact number that
 * anyone can check against Hyperliquid's candle history). The operator posts
 * it once, after the expiry. The owner may correct it during
 * CORRECTION_WINDOW after the first post; the price is reported `ready` only
 * when that window has closed, and from then on it can never change.
 *
 * TRUST, stated plainly: until Elysium's HyperCore read precompile ships, the
 * settlement price is only as good as the keeper and the owner. Every post and
 * correction is an event carrying the price and the candle it came from.
 */
contract KeeperOracle is ISettlementOracle {
    uint64 public constant CORRECTION_WINDOW = 10 minutes;

    struct Post {
        uint128 price; // 1e8
        uint64 postedAt; // block time of the first post
        bool corrected;
    }

    address public owner;
    address public operator;

    /// keccak256(underlying, expiry) => post
    mapping(bytes32 => Post) internal _posts;

    event OwnerSet(address owner);
    event OperatorSet(address operator);
    event PricePosted(bytes32 indexed underlying, uint64 indexed expiry, uint128 price, uint64 finalAt);
    event PriceCorrected(bytes32 indexed underlying, uint64 indexed expiry, uint128 oldPrice, uint128 newPrice);

    error NotOwner();
    error NotOperator();
    error TooEarly();
    error AlreadyPosted();
    error NotPosted();
    error WindowClosed();
    error BadPrice();
    error BadParam();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _operator) {
        owner = msg.sender;
        operator = _operator;
        emit OwnerSet(msg.sender);
        emit OperatorSet(_operator);
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert BadParam();
        owner = next;
        emit OwnerSet(next);
    }

    function setOperator(address next) external onlyOwner {
        operator = next;
        emit OperatorSet(next);
    }

    function _id(bytes32 underlying, uint64 expiry) internal pure returns (bytes32) {
        return keccak256(abi.encode(underlying, expiry));
    }

    /// Post the settlement price for (underlying, expiry). Once only, and only
    /// after the expiry. The operator posts; the owner may too, as a fallback
    /// when the keeper is down.
    function post(bytes32 underlying, uint64 expiry, uint128 price) external {
        if (msg.sender != operator && msg.sender != owner) revert NotOperator();
        if (block.timestamp < expiry) revert TooEarly();
        if (price == 0) revert BadPrice();
        Post storage p = _posts[_id(underlying, expiry)];
        if (p.postedAt != 0) revert AlreadyPosted();
        p.price = price;
        p.postedAt = uint64(block.timestamp);
        emit PricePosted(underlying, expiry, price, uint64(block.timestamp) + CORRECTION_WINDOW);
    }

    /// Owner-only fix of a bad post, inside the correction window. The window
    /// is NOT extended: the price is final CORRECTION_WINDOW after the first post.
    function correct(bytes32 underlying, uint64 expiry, uint128 price) external onlyOwner {
        if (price == 0) revert BadPrice();
        Post storage p = _posts[_id(underlying, expiry)];
        if (p.postedAt == 0) revert NotPosted();
        if (block.timestamp >= uint256(p.postedAt) + CORRECTION_WINDOW) revert WindowClosed();
        uint128 old = p.price;
        p.price = price;
        p.corrected = true;
        emit PriceCorrected(underlying, expiry, old, price);
    }

    /// The final price. `ready` only after the correction window has closed.
    function settlementPrice(bytes32 underlying, uint64 expiry) external view returns (uint128 price, bool ready) {
        Post storage p = _posts[_id(underlying, expiry)];
        if (p.postedAt == 0) return (0, false);
        return (p.price, block.timestamp >= uint256(p.postedAt) + CORRECTION_WINDOW);
    }

    /// The posted (possibly not yet final) price and when it becomes final.
    function pending(bytes32 underlying, uint64 expiry)
        external
        view
        returns (uint128 price, uint64 postedAt, uint64 finalAt, bool corrected)
    {
        Post storage p = _posts[_id(underlying, expiry)];
        if (p.postedAt == 0) return (0, 0, 0, false);
        return (p.price, p.postedAt, p.postedAt + CORRECTION_WINDOW, p.corrected);
    }
}
