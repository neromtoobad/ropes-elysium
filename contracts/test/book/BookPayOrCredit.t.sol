// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {OptionsBook} from "../../src/book/OptionsBook.sol";
import {KeeperOracle} from "../../src/book/KeeperOracle.sol";

/// A stablecoin with a blocklist, like real USDC: transfers to a blocked
/// address revert.
contract BlockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        require(!blocked[to] && !blocked[msg.sender], "blocked");
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(!blocked[to] && !blocked[f], "blocked");
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

contract BookPayOrCreditTest is Test {
    OptionsBook book;
    BlockUSDC usd;
    KeeperOracle oracle;
    address constant OP = address(0x0FE);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    uint256 id;
    uint64 expiry;

    function setUp() public {
        vm.warp(1_800_000_000);
        expiry = uint64(block.timestamp) + 1 hours;
        usd = new BlockUSDC();
        oracle = new KeeperOracle(OP);
        book = new OptionsBook(address(usd), address(oracle), OP, address(0xFEE5));
        vm.prank(OP);
        id = book.createSeries("HYPE", expiry, 40_00000000, true);
        usd.mint(ALICE, 1000e6);
        usd.mint(BOB, 1000e6);
        vm.prank(ALICE);
        usd.approve(address(book), type(uint256).max);
        vm.prank(BOB);
        usd.approve(address(book), type(uint256).max);
    }

    function test_a_blocked_maker_cannot_block_takers() public {
        vm.startPrank(BOB);
        book.mint(id, 100);
        book.placeLimit(id, false, 1_500_000, 100, false);
        vm.stopPrank();
        usd.setBlocked(BOB, true);

        vm.prank(ALICE);
        (, uint256 filled) = book.placeLimit(id, true, 1_500_000, 100, false);
        assertEq(filled, 100);
        assertEq(book.unclaimed(BOB), 1_500_000);
        assertEq(book.totalUnclaimed(), 1_500_000);
        assertEq(usd.balanceOf(address(book)), book.requiredBalance());

        // still blocked: the claim reverts and the credit stays
        vm.prank(BOB);
        vm.expectRevert(bytes("blocked"));
        book.claim();
        assertEq(book.unclaimed(BOB), 1_500_000);

        usd.setBlocked(BOB, false);
        uint256 b0 = usd.balanceOf(BOB);
        vm.prank(BOB);
        assertEq(book.claim(), 1_500_000);
        assertEq(usd.balanceOf(BOB) - b0, 1_500_000);
        assertEq(book.totalUnclaimed(), 0);
        assertEq(usd.balanceOf(address(book)), book.requiredBalance());
    }

    function test_expiry_cancel_for_a_blocked_owner_credits_them() public {
        vm.prank(ALICE);
        (uint256 oid,) = book.placeLimit(id, true, 1_000_000, 100, false);
        usd.setBlocked(ALICE, true);
        vm.warp(expiry);
        vm.prank(BOB);
        book.cancel(oid);
        assertEq(book.unclaimed(ALICE), 1_000_000);
        assertEq(usd.balanceOf(address(book)), book.requiredBalance());
    }
}
