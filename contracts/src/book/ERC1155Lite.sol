// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC1155Receiver {
    function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data)
        external
        returns (bytes4);

    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external returns (bytes4);
}

/**
 * A minimal ERC-1155 (EIP-1155 core + ERC-165), written for the options book.
 *
 * The public surface is the standard one: balanceOf, balanceOfBatch,
 * setApprovalForAll, isApprovedForAll, safeTransferFrom, safeBatchTransferFrom,
 * supportsInterface, with the TransferSingle / TransferBatch / ApprovalForAll
 * events and the receiver-hook acceptance check on every user transfer.
 *
 * Internal helpers for the inheriting contract:
 *   _mint / _burn / _move   update balances and emit TransferSingle. They do
 *                           NOT call the receiver hook; the caller decides
 *                           where (and whether) to run `_checkReceived` /
 *                           `_checkBatchReceived`, always after its own state
 *                           changes are complete (checks-effects-interactions).
 *
 * No metadata URI extension: positions are described by the book's events
 * and views, not by off-chain JSON.
 */
abstract contract ERC1155Lite {
    /* --------------------------------------------------------------- events */

    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value
    );
    event TransferBatch(
        address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values
    );
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);

    /* --------------------------------------------------------------- errors */

    error ERC1155ZeroAddress();
    error ERC1155NotApproved();
    error ERC1155InsufficientBalance();
    error ERC1155LengthMismatch();
    error ERC1155ReceiverRejected();

    /* -------------------------------------------------------------- storage */

    /// id => holder => balance
    mapping(uint256 => mapping(address => uint256)) internal _balances;
    /// holder => operator => approved
    mapping(address => mapping(address => bool)) internal _operatorApprovals;

    /* ---------------------------------------------------------------- views */

    function balanceOf(address account, uint256 id) public view returns (uint256) {
        if (account == address(0)) revert ERC1155ZeroAddress();
        return _balances[id][account];
    }

    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids)
        external
        view
        returns (uint256[] memory out)
    {
        if (accounts.length != ids.length) revert ERC1155LengthMismatch();
        out = new uint256[](accounts.length);
        for (uint256 i; i < accounts.length; ++i) {
            out[i] = balanceOf(accounts[i], ids[i]);
        }
    }

    function isApprovedForAll(address account, address operator) public view returns (bool) {
        return _operatorApprovals[account][operator];
    }

    /// ERC-165: IERC165 (0x01ffc9a7) and IERC1155 (0xd9b67a26).
    function supportsInterface(bytes4 interfaceId) public view virtual returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0xd9b67a26;
    }

    /* ------------------------------------------------------------ approvals */

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /* ------------------------------------------------------------ transfers */

    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external {
        if (to == address(0)) revert ERC1155ZeroAddress();
        if (from != msg.sender && !_operatorApprovals[from][msg.sender]) revert ERC1155NotApproved();
        _beforeUserTransfer(from, to);
        uint256 bal = _balances[id][from];
        if (bal < value) revert ERC1155InsufficientBalance();
        unchecked {
            _balances[id][from] = bal - value;
        }
        _balances[id][to] += value;
        emit TransferSingle(msg.sender, from, to, id, value);
        _checkReceived(msg.sender, from, to, id, value, data);
    }

    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external {
        if (ids.length != values.length) revert ERC1155LengthMismatch();
        if (to == address(0)) revert ERC1155ZeroAddress();
        if (from != msg.sender && !_operatorApprovals[from][msg.sender]) revert ERC1155NotApproved();
        _beforeUserTransfer(from, to);
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            uint256 value = values[i];
            uint256 bal = _balances[id][from];
            if (bal < value) revert ERC1155InsufficientBalance();
            unchecked {
                _balances[id][from] = bal - value;
            }
            _balances[id][to] += value;
        }
        emit TransferBatch(msg.sender, from, to, ids, values);
        _checkBatchReceived(msg.sender, from, to, ids, values, data);
    }

    /// Hook for the inheriting contract to veto a user-initiated transfer.
    function _beforeUserTransfer(address from, address to) internal virtual {}

    /* ------------------------------------------------------------- internal */

    function _mint(address to, uint256 id, uint256 value) internal {
        _balances[id][to] += value;
        emit TransferSingle(msg.sender, address(0), to, id, value);
    }

    function _burn(address from, uint256 id, uint256 value) internal {
        uint256 bal = _balances[id][from];
        if (bal < value) revert ERC1155InsufficientBalance();
        unchecked {
            _balances[id][from] = bal - value;
        }
        emit TransferSingle(msg.sender, from, address(0), id, value);
    }

    function _move(address from, address to, uint256 id, uint256 value) internal {
        uint256 bal = _balances[id][from];
        if (bal < value) revert ERC1155InsufficientBalance();
        unchecked {
            _balances[id][from] = bal - value;
        }
        _balances[id][to] += value;
        emit TransferSingle(msg.sender, from, to, id, value);
    }

    function _checkReceived(address operator, address from, address to, uint256 id, uint256 value, bytes memory data)
        internal
    {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155Received(operator, from, id, value, data) returns (bytes4 r) {
            if (r != IERC1155Receiver.onERC1155Received.selector) revert ERC1155ReceiverRejected();
        } catch {
            revert ERC1155ReceiverRejected();
        }
    }

    function _checkBatchReceived(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values,
        bytes memory data
    ) internal {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155BatchReceived(operator, from, ids, values, data) returns (bytes4 r) {
            if (r != IERC1155Receiver.onERC1155BatchReceived.selector) revert ERC1155ReceiverRejected();
        } catch {
            revert ERC1155ReceiverRejected();
        }
    }
}
