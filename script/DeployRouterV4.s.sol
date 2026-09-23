// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {PoundVault} from "../src/pound/PoundVault.sol";

/// @notice Redeploy only the launch router (v4) against an existing PoundVault,
///         e.g. after a router fix. Wires it when the broadcaster owns the
///         factory / vault, otherwise prints the owner actions (Safe batch).
///
/// Env: PRIVATE_KEY, FACTORY, VAULT (PoundVault), KEEPER, WALL_TREASURY_IMPL,
///      WALL_STAKING_IMPL, WALL_LADDER_IMPL, POF_VAULT_IMPL.
contract DeployRouterV4 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory = PonsV2LaunchFactory(payable(vm.envAddress("FACTORY")));
        PoundVault vault = PoundVault(payable(vm.envAddress("VAULT")));
        address keeper = vm.envAddress("KEEPER");

        vm.startBroadcast(pk);
        RadianLaunchRouter router = new RadianLaunchRouter(
            factory,
            vm.envAddress("WALL_TREASURY_IMPL"),
            vm.envAddress("WALL_STAKING_IMPL"),
            vm.envAddress("WALL_LADDER_IMPL"),
            vm.envAddress("POF_VAULT_IMPL")
        );
        bool ownsFactory = factory.owner() == me;
        bool ownsVault = vault.owner() == me;
        if (ownsFactory) {
            factory.setLaunchForwarder(address(router));
            router.setVault(address(vault));
            router.setKeeper(keeper);
        }
        if (ownsVault) vault.setRouter(address(router));
        vm.stopBroadcast();

        console.log("RadianLaunchRouter v4", address(router));
        console.log("factory forwarder now", factory.launchForwarder());
        console.log("vault router now    ", vault.router());
        if (!ownsFactory) {
            console.log("ACTION (factory owner): factory.setLaunchForwarder(router); router.setVault(vault); router.setKeeper(keeper);");
        }
        if (!ownsVault) console.log("ACTION (vault owner): vault.setRouter(router);");
        // The router's owner is the factory owner (checked on every owner call), so nothing to transfer.
    }
}
