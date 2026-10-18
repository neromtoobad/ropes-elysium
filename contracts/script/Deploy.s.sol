// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RopeMarket} from "../src/RopeMarket.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {ArenaRegistry} from "../src/ArenaRegistry.sol";

/**
 * Deploy ROPES to Elysium testnet (chain 99801):
 *
 *   DEPLOY_PK=0x… SIGMA_WAD=… forge script contracts/script/Deploy.s.sol \
 *     --rpc-url elysium_testnet --broadcast
 *
 * The deployer is also the operator (the executor wallet) — it relays the
 * Hyperliquid mark, opens and settles rounds and routes orders. It seeds the
 * house vault with VAULT_SEED test dollars and keeps HOUSE_FLOAT for stakes.
 */
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOY_PK");
        address me = vm.addr(pk);
        bytes32 asset = bytes32(bytes(vm.envOr("ASSET", string("HYPE"))));
        uint256 sigma = vm.envUint("SIGMA_WAD");
        uint256 vaultSeed = vm.envOr("VAULT_SEED", uint256(100_000e6));
        uint256 houseFloat = vm.envOr("HOUSE_FLOAT", uint256(20_000e6));

        vm.startBroadcast(pk);
        MockUSDC usd = new MockUSDC();
        RopeMarket market = new RopeMarket(address(usd), asset, me, sigma);
        ArenaRegistry reg = new ArenaRegistry(address(market));
        market.setHook(address(reg));
        // 1% half-spread, double in the last 10s, no buys in the last 5s,
        // marks must be < 3s old to trade, strikes/closes sampled within 8s.
        market.setParams(10_000, 10, 5, 3, 8, 2_500);

        for (uint256 minted; minted < vaultSeed + houseFloat; minted += 10_000e6) {
            usd.mint(me, 10_000e6);
        }
        usd.approve(address(market), type(uint256).max);
        market.deposit(vaultSeed);
        vm.stopBroadcast();

        console.log("MockUSDC (tUSDC):", address(usd));
        console.log("RopeMarket:      ", address(market));
        console.log("ArenaRegistry:   ", address(reg));
    }
}
