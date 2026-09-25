// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CrossBuyReceiver} from "../src/pound/CrossBuyReceiver.sol";

/// @notice Deploys the cross-chain buy receiver against an existing
///         RadianLaunchRouter v4. Deploy-only: the receiver has no owner and
///         needs no wiring (the factory is read from the router), so nothing
///         on chain is configured and no owner function is called.
///
/// Env:
///   PRIVATE_KEY  broadcaster
///   ROUTER       RadianLaunchRouter v4 (the factory's launchForwarder)
///   FACTORY      optional; when set, the run fails unless router.factory() matches
contract DeployCrossBuyReceiver is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address routerAddr = vm.envAddress("ROUTER");
        address expectedFactory = vm.envOr("FACTORY", address(0));
        require(routerAddr.code.length > 0, "ROUTER has no code");

        vm.startBroadcast(pk);
        CrossBuyReceiver receiver = new CrossBuyReceiver(routerAddr);
        vm.stopBroadcast();

        address factory = address(receiver.factory());
        if (expectedFactory != address(0)) require(factory == expectedFactory, "FACTORY does not match router.factory()");

        console.log("== CrossBuyReceiver on chain", block.chainid, "==");
        console.log("CrossBuyReceiver:", address(receiver));
        console.log("router:          ", routerAddr);
        console.log("factory:         ", factory);
        console.log("Bridges call buyFor(token, minTokensOut, recipient, refundTo, referrer) with the delivered ETH as value,");
        console.log("or transfer the ERC-20 quote first; Across calls handleV3AcrossMessage. See docs/CROSS_CHAIN_BUY.md.");
    }
}
