// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2MemeHook} from "../src/v2/hooks/PonsV2MemeHook.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {RadianExecutor} from "../src/radian/RadianExecutor.sol";
import {PoundVault} from "../src/pound/PoundVault.sol";
import {PackBurner} from "../src/pound/PackBurner.sol";

/// @notice Deploys The Pound core on a chain that already runs the Pons V2 stack:
///         PoundVault (protocol-fee waterfall), PackBurner (rotating buy-and-burn),
///         RadianLaunchRouter v4 (trades with referral tags, templates gated) and
///         RadianExecutor v2 (price-bounded delegated buys). Reuses the template
///         implementations already on chain.
///
///         When the broadcaster owns the factory/hook (testnets) it also wires
///         everything. When a Safe owns them (mainnet) it prints the calls the
///         Safe must make; the vault/burner are handed to OWNER two-step.
///
/// Env: PRIVATE_KEY, FACTORY, HOOK, KEEPER, OWNER (Safe or the broadcaster), TREASURY,
///      WALL_TREASURY_IMPL, WALL_STAKING_IMPL, WALL_LADDER_IMPL, POF_VAULT_IMPL,
///      optional PROTOCOL_SHARE_BPS (default 5000)
contract DeployPoundCore is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory = PonsV2LaunchFactory(payable(vm.envAddress("FACTORY")));
        PonsV2MemeHook hook = PonsV2MemeHook(payable(vm.envAddress("HOOK")));
        address keeper = vm.envAddress("KEEPER");
        address owner = vm.envAddress("OWNER");
        address treasury = vm.envAddress("TREASURY");
        uint256 shareBps = vm.envOr("PROTOCOL_SHARE_BPS", uint256(5_000));
        bool iOwn = factory.owner() == me;

        vm.startBroadcast(pk);
        PoundVault vault = new PoundVault(address(hook.feeEscrow()), treasury, me);
        PackBurner burner = new PackBurner(address(factory.poolManager()), me);
        RadianLaunchRouter router = new RadianLaunchRouter(
            factory,
            vm.envAddress("WALL_TREASURY_IMPL"),
            vm.envAddress("WALL_STAKING_IMPL"),
            vm.envAddress("WALL_LADDER_IMPL"),
            vm.envAddress("POF_VAULT_IMPL")
        );
        RadianExecutor executor = new RadianExecutor(factory);
        vault.setRouter(address(router));
        vault.setBurner(address(burner));
        burner.setParams(1 days, 50, 500, false, keeper);
        if (iOwn) {
            factory.setLaunchForwarder(address(router));
            router.setVault(address(vault));
            router.setKeeper(keeper);
            executor.setKeeper(keeper);
            hook.setProtocolFeeRecipient(address(vault));
            hook.setProtocolFeeShareBps(shareBps);
        }
        if (owner != me) {
            vault.transferOwnership(owner);
            burner.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console.log("== The Pound core on chain", block.chainid, "==");
        console.log("PoundVault:          ", address(vault));
        console.log("PackBurner:          ", address(burner));
        console.log("RadianLaunchRouter v4", address(router));
        console.log("PoFRouter (v4):      ", address(router.pofRouter()));
        console.log("RadianExecutor v2:   ", address(executor));
        if (!iOwn) {
            console.log("ACTION (factory/hook owner): factory.setLaunchForwarder(router); router.setVault(vault);");
            console.log("  router.setKeeper(keeper); executor.setKeeper(keeper); hook.setProtocolFeeRecipient(vault);");
            console.log("  hook.setProtocolFeeShareBps(shareBps); vault.acceptOwnership(); burner.acceptOwnership()");
        }
    }
}
