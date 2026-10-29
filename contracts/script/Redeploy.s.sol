// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RopeMarket} from "../src/RopeMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

/**
 * Replace a live RopeMarket (and its ArenaRegistry) on the same collateral:
 *
 *   DEPLOY_PK=0x… OLD_MARKET=0x… START_AFTER=… forge script \
 *     contracts/script/Redeploy.s.sol --rpc-url elysium_testnet --broadcast
 *
 * Players keep their tUSDC. Every setting (operator, σ, spread, timings, cap)
 * is copied from the old market. Round ids carry on after START_AFTER, which
 * must be above the old market's last round. The registry goes to the old
 * operator (the executor), who opens and banks runs. The deployer seeds the
 * new vault with VAULT_SEED freshly minted test dollars.
 */
contract Redeploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOY_PK");
        address me = vm.addr(pk);
        RopeMarket old = RopeMarket(vm.envAddress("OLD_MARKET"));
        uint64 startAfter = uint64(vm.envUint("START_AFTER"));
        uint256 vaultSeed = vm.envOr("VAULT_SEED", uint256(100_000e6));
        require(startAfter > old.roundCount(), "START_AFTER must be above the old market's last round");

        MockUSDC usd = MockUSDC(address(old.collateral()));
        address keeper = old.operator();

        vm.startBroadcast(pk);
        RopeMarket market = new RopeMarket(address(usd), old.asset(), keeper, old.sigmaWad());
        ArenaRegistry reg = new ArenaRegistry(address(market));
        market.setHook(address(reg));
        market.setParams(
            old.halfSpread(), old.lateSecs(), old.buyLockSecs(), old.maxStaleSecs(), old.sampleWindowSecs(), old.roundCapBps()
        );
        market.startAt(startAfter);
        reg.setOwner(keeper);

        for (uint256 minted; minted < vaultSeed; minted += 10_000e6) {
            usd.mint(me, 10_000e6);
        }
        usd.approve(address(market), type(uint256).max);
        market.deposit(vaultSeed);
        vm.stopBroadcast();

        console.log("RopeMarket:      ", address(market));
        console.log("ArenaRegistry:   ", address(reg));
        console.log("first round id:  ", market.firstRound());
    }
}
