// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";

interface IOwnable2Step {
    function transferOwnership(address newOwner) external;
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
}

/// @notice Hands the four owned Pons V2 contracts to a multisig. All are
/// Ownable2Step, so this only sets the PENDING owner — the multisig must then
/// call `acceptOwnership()` on each address for the transfer to take effect.
/// Run this AFTER the mainnet smoke test passes and launch is enabled.
///
/// Env: PRIVATE_KEY (current owner/deployer), MULTISIG (Gnosis Safe address),
///      FACTORY, HOOK, VAULT, LOCKER (deployed addresses).
contract TransferOwnership is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address multisig = vm.envAddress("MULTISIG");
        require(multisig != address(0), "set MULTISIG");

        address[4] memory targets = [
            vm.envAddress("FACTORY"),
            vm.envAddress("HOOK"),
            vm.envAddress("VAULT"),
            vm.envAddress("LOCKER")
        ];
        string[4] memory names = ["Factory", "Hook", "Vault", "Locker"];

        vm.startBroadcast(pk);
        for (uint256 i = 0; i < targets.length; i++) {
            IOwnable2Step(targets[i]).transferOwnership(multisig);
            console.log(names[i], "pending owner ->", IOwnable2Step(targets[i]).pendingOwner());
        }
        vm.stopBroadcast();

        console.log("");
        console.log("Pending owner set to multisig on all 4 contracts.");
        console.log("ACTION REQUIRED: the multisig must call acceptOwnership() on each:");
        for (uint256 i = 0; i < targets.length; i++) {
            console.log("  ", names[i], targets[i]);
        }
    }
}
