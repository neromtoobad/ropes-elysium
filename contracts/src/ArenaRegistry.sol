// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * ROPES — the public scoreboard.
 *
 * The executor holds the players' collateral and routes their orders; this
 * contract holds nothing and trades nothing. What it does is settle the GAME
 * in the same transaction that settles the MARKET: RopeMarket calls
 * `onRoundSettled` from inside `settle`, so an elimination can never land on
 * a different price, or in a different block, from the result that caused it.
 *
 * Every round, entry and elimination is an event here, which is what makes a
 * custodial executor auditable: you do not have to trust our database, you
 * can replay the game from this log.
 *
 * (On Somnia this was driven by the reactivity precompile; on Elysium the
 * market is ours, so the market calls the scoreboard directly.)
 */
contract ArenaRegistry {
    /* ------------------------------------------------------------ types */

    uint8 internal constant SIDE_UP = 0;
    uint8 internal constant SIDE_DOWN = 1;

    uint8 internal constant ALIVE = 0;
    uint8 internal constant BANKED = 1;
    uint8 internal constant ELIMINATED = 2;

    struct Round {
        bytes32 marketId; // the executor's own key, mirrored for cross-reference
        uint64 nonce; // (pool, nonce) identifies one market on a recycled pool
        bool open;
        bool settled;
        bool voided;
        uint8 winner; // 0 UP, 1 DOWN; meaningless when voided
    }

    struct Entry {
        bytes32 runId;
        uint8 side;
        /// Outcome tokens held. A winning contract redeems for exactly 1, so
        /// this IS the winning stack — the 1/p growth, already computed.
        uint128 contracts;
        /// Budget the book could not absorb. Never at risk, so never forfeit.
        uint128 remainder;
        uint128 stackBefore;
    }

    /* ----------------------------------------------------------- storage */

    /// The executor. Writes entries; cannot settle.
    address public owner;

    /// RopeMarket — the only address allowed to settle.
    address public immutable market;

    /// keccak(pool, nonce) => round
    mapping(bytes32 => Round) public rounds;
    /// keccak(pool, nonce) => entries in that round
    mapping(bytes32 => Entry[]) internal _entries;

    /// runId => current stack
    mapping(bytes32 => uint128) public stackOf;
    /// runId => ALIVE | BANKED | ELIMINATED
    mapping(bytes32 => uint8) public statusOf;

    /* ------------------------------------------------------------ events */

    event RoundOpened(bytes32 indexed roundKey, bytes32 indexed marketId, address pool, uint64 nonce);
    event RunEntered(bytes32 indexed roundKey, bytes32 indexed runId, uint8 side, uint128 contracts, uint128 stakeBefore);
    event RunAdvanced(bytes32 indexed runId, bytes32 indexed roundKey, uint128 from, uint128 to);
    event RunEliminated(bytes32 indexed runId, bytes32 indexed roundKey, uint128 lost);
    event RunBanked(bytes32 indexed runId, uint128 stack);
    event RoundSettled(bytes32 indexed roundKey, uint8 winner, bool voided, uint16 survivors, uint16 killed);
    /// Emitted when a callback arrives for a round we never registered. Not an
    /// error: the venue settles markets we are not playing.
    event UnknownRound(bytes32 indexed roundKey);

    error NotOwner();
    error NotMarket();
    error RoundNotOpen();
    error RoundAlreadySettled();
    error RunNotAlive();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _market) {
        owner = msg.sender;
        market = _market;
    }

    /* ------------------------------------------------------- executor API */

    function setOwner(address next) external onlyOwner {
        owner = next;
    }

    function roundKey(address pool, uint64 nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(pool, nonce));
    }

    /// Register the window the executor is about to play.
    function openRound(address pool, uint64 nonce, bytes32 marketId) external onlyOwner returns (bytes32 key) {
        key = roundKey(pool, nonce);
        Round storage r = rounds[key];
        if (r.open || r.settled) return key; // idempotent; the loop re-ticks
        r.marketId = marketId;
        r.nonce = nonce;
        r.open = true;
        emit RoundOpened(key, marketId, pool, nonce);
    }

    /// Record a filled position. Called after the order lands, never before —
    /// the numbers here are chain truth, not what we asked for.
    function enter(
        address pool,
        uint64 nonce,
        bytes32 runId,
        uint8 side,
        uint128 contracts,
        uint128 remainder,
        uint128 stackBefore
    ) external onlyOwner {
        bytes32 key = roundKey(pool, nonce);
        Round storage r = rounds[key];
        // Settled first: _settle clears `open` too, so checking that first
        // would report a settled round as merely "not open".
        if (r.settled) revert RoundAlreadySettled();
        if (!r.open) revert RoundNotOpen();
        if (statusOf[runId] != ALIVE) revert RunNotAlive();

        _entries[key].push(
            Entry({runId: runId, side: side, contracts: contracts, remainder: remainder, stackBefore: stackBefore})
        );
        stackOf[runId] = stackBefore;
        emit RunEntered(key, runId, side, contracts, stackBefore);
    }

    /**
     * Enter a whole side of the table in one transaction.
     *
     * The executor already batches its orders by side (everyone on a side must
     * get the same fill price), so it has one array per round anyway. This also
     * keeps the executor's write count flat as the table grows: a round costs
     * one openRound plus at most two enterMany, whatever the player count —
     * which matters when the whole window is sixty seconds.
     */
    function enterMany(
        address pool,
        uint64 nonce,
        uint8 side,
        bytes32[] calldata runIds,
        uint128[] calldata contracts,
        uint128[] calldata remainders,
        uint128[] calldata stacksBefore
    ) external onlyOwner {
        bytes32 key = roundKey(pool, nonce);
        Round storage r = rounds[key];
        if (r.settled) revert RoundAlreadySettled();
        if (!r.open) revert RoundNotOpen();

        uint256 n = runIds.length;
        if (contracts.length != n || remainders.length != n || stacksBefore.length != n) {
            revert LengthMismatch();
        }

        for (uint256 i; i < n; ++i) {
            // Skip rather than revert: one dead run must not cost the whole
            // side its entry, and the executor's ledger is authoritative anyway.
            if (statusOf[runIds[i]] != ALIVE) continue;
            _entries[key].push(
                Entry({
                    runId: runIds[i],
                    side: side,
                    contracts: contracts[i],
                    remainder: remainders[i],
                    stackBefore: stacksBefore[i]
                })
            );
            stackOf[runIds[i]] = stacksBefore[i];
            emit RunEntered(key, runIds[i], side, contracts[i], stacksBefore[i]);
        }
    }

    /// End a run voluntarily. The executor sells the position off-chain and
    /// reports the proceeds; this records the exit.
    function bankRun(bytes32 runId, uint128 finalStack) external onlyOwner {
        if (statusOf[runId] != ALIVE) revert RunNotAlive();
        statusOf[runId] = BANKED;
        stackOf[runId] = finalStack;
        emit RunBanked(runId, finalStack);
    }

    /* --------------------------------------------------------- the handler */

    /**
     * Called by RopeMarket from inside `settle` (and its void path). Never
     * called by us. The round is keyed by (market, roundId), exactly as the
     * executor registered it.
     */
    function onRoundSettled(uint64 roundId, bool voided, uint8 winner) external {
        if (msg.sender != market) revert NotMarket();
        _settle(roundKey(market, roundId), voided, winner);
    }

    /**
     * Backstop for a missed callback — a hook that ran out of gas.
     *
     * Owner-only, deliberately: the outcome is an argument here rather than
     * something the chain hands us, so a permissionless version would let
     * anyone inject a false result. A settled round is immutable either way,
     * and the event log shows which path ran, so a poke cannot quietly
     * overwrite a real callback.
     */
    function pokeSettle(address pool, uint64 nonce, bool voided, uint8 winner) external onlyOwner {
        _settle(roundKey(pool, nonce), voided, winner);
    }

    function _settle(bytes32 key, bool voided, uint8 winner) internal {
        Round storage r = rounds[key];
        // The venue finalises markets we never played. Say so and stop.
        if (!r.open) {
            emit UnknownRound(key);
            return;
        }
        if (r.settled) return; // idempotent: callback + poke must not double-apply

        r.settled = true;
        r.open = false;
        r.voided = voided;
        r.winner = winner;

        Entry[] storage list = _entries[key];
        uint16 survivors;
        uint16 killed;

        for (uint256 i; i < list.length; ++i) {
            Entry storage e = list[i];
            if (statusOf[e.runId] != ALIVE) continue;

            if (voided) {
                // A void refunds the stake and eliminates nobody: the stack
                // goes back to exactly what it was before the round.
                uint128 next = e.stackBefore;
                stackOf[e.runId] = next;
                ++survivors;
                emit RunAdvanced(e.runId, key, e.stackBefore, next);
            } else if (e.side == winner) {
                // Each winning contract redeems for exactly 1 — this is 1/p.
                uint128 next = e.contracts + e.remainder;
                stackOf[e.runId] = next;
                ++survivors;
                emit RunAdvanced(e.runId, key, e.stackBefore, next);
            } else {
                // The undeployed remainder was never at risk; it is not ours.
                statusOf[e.runId] = ELIMINATED;
                stackOf[e.runId] = e.remainder;
                ++killed;
                emit RunEliminated(e.runId, key, e.stackBefore - e.remainder);
            }
        }

        emit RoundSettled(key, winner, voided, survivors, killed);
    }

    /* ---------------------------------------------------------------- views */

    function entryCount(address pool, uint64 nonce) external view returns (uint256) {
        return _entries[roundKey(pool, nonce)].length;
    }

    function entryAt(address pool, uint64 nonce, uint256 i) external view returns (Entry memory) {
        return _entries[roundKey(pool, nonce)][i];
    }
}
