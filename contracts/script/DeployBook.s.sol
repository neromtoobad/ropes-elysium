// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KeeperOracle} from "../src/book/KeeperOracle.sol";
import {OptionsBook} from "../src/book/OptionsBook.sol";
import {BackstopVault} from "../src/book/BackstopVault.sol";

/**
 * Deploy the ROPES options book next to an EXISTING tUSDC:
 *
 *   COLLATERAL=0x… OPERATOR=0x… FEE_RECIPIENT=0x… \
 *   forge script contracts/script/DeployBook.s.sol --rpc-url <rpc> --broadcast \
 *     --account <keystore>            # or --ledger / --private-key, your choice
 *
 * The broadcasting account becomes the owner of all three contracts.
 * OPERATOR is the keeper: it posts settlement prices, creates series and
 * quotes for the vault. Optional env:
 *   MAKER_FEE_BPS, TAKER_FEE_BPS   default 0 / 0 (each capped at 500)
 *   DEPLOY_VAULT                   default true
 *   SIGMA_WAD                      vault σ per √second, default 1.4246e14 (80%/yr)
 *   UNDERLYING                     default "HYPE"
 *
 * The script reads no key material itself: signing is whatever the forge
 * CLI was given.
 */
contract DeployBook is Script {
    function run() external returns (KeeperOracle oracle, OptionsBook book, BackstopVault vault) {
        address collateral = vm.envAddress("COLLATERAL");
        address operator = vm.envAddress("OPERATOR");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 makerFee = vm.envOr("MAKER_FEE_BPS", uint256(0));
        uint256 takerFee = vm.envOr("TAKER_FEE_BPS", uint256(0));
        bool deployVault = vm.envOr("DEPLOY_VAULT", true);
        uint256 sigma = vm.envOr("SIGMA_WAD", uint256(142457947723562));
        bytes32 underlying = bytes32(bytes(vm.envOr("UNDERLYING", string("HYPE"))));

        require(collateral.code.length > 0, "COLLATERAL has no code");
        require(operator != address(0) && feeRecipient != address(0), "OPERATOR / FEE_RECIPIENT unset");

        vm.startBroadcast();
        oracle = new KeeperOracle(operator);
        book = new OptionsBook(collateral, address(oracle), operator, feeRecipient);
        if (makerFee != 0 || takerFee != 0) book.setFees(uint16(makerFee), uint16(takerFee));
        if (underlying != bytes32("HYPE")) book.setUnderlying(underlying, true);
        if (deployVault) vault = new BackstopVault(address(book), underlying, operator, sigma);
        vm.stopBroadcast();

        console.log("KeeperOracle: ", address(oracle));
        console.log("OptionsBook:  ", address(book));
        console.log("BackstopVault:", address(vault));
    }
}
