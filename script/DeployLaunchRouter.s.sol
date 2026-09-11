// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";

/// Deploys the atomic launch-and-buy router and, when the broadcaster owns the
/// factory, registers it as the factory's trusted `launchForwarder`. The router
/// has no owner and holds no funds; the only privilege is the factory's trust,
/// which the owner (later: the multisig) can re-point with setLaunchForwarder.
///
/// Env:
///   PRIVATE_KEY   broadcaster
///   FACTORY       PonsV2LaunchFactory (default: Arc testnet)
contract DeployLaunchRouter is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory =
            PonsV2LaunchFactory(payable(vm.envOr("FACTORY", address(0x90022cC2107De9c070F889E3A67009FcA270E4E2))));
        bool isOwner = factory.owner() == me;

        vm.startBroadcast(pk);
        RadianLaunchRouter router = new RadianLaunchRouter(factory);
        if (isOwner) factory.setLaunchForwarder(address(router));
        vm.stopBroadcast();

        console.log("RadianLaunchRouter:", address(router));
        console.log("factory.launchForwarder:", factory.launchForwarder());
        if (isOwner) require(factory.launchForwarder() == address(router), "forwarder not wired");
        else console.log("broadcaster is not the factory owner: call factory.setLaunchForwarder(router) from the owner");
    }
}
