// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RadianStakingERC20} from "../src/radian/RadianStakingERC20.sol";
import {RadianTreasuryERC20} from "../src/radian/RadianTreasuryERC20.sol";
import {PonsV2MemeHook} from "../src/v2/hooks/PonsV2MemeHook.sol";

/// @notice Redeploys the ERC-20 flywheel (staking + treasury) for an EXISTING
///         $RADIAN token and curve, e.g. after the 2026-09-17 review fixes.
///         Wires pool <-> treasury and hands both to OWNER (two-step: OWNER
///         must call acceptOwnership on each). Pointing the hook at the new
///         treasury is the hook owner's call (the Safe): setProtocolFeeRecipient.
///
/// Env: PRIVATE_KEY, RADIAN_TOKEN, RADIAN_CURVE, HOOK, QUOTE, KEEPER, OWNER
contract RedeployFlywheelERC20 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address token = vm.envAddress("RADIAN_TOKEN");
        address curve = vm.envAddress("RADIAN_CURVE");
        PonsV2MemeHook hook = PonsV2MemeHook(payable(vm.envAddress("HOOK")));
        address quote = vm.envAddress("QUOTE");
        address keeper = vm.envAddress("KEEPER");
        address owner = vm.envAddress("OWNER");
        require(owner != me, "OWNER must be the multisig");

        vm.startBroadcast(pk);
        RadianStakingERC20 staking = new RadianStakingERC20(token, quote, me);
        RadianTreasuryERC20 treasury = new RadianTreasuryERC20(token, curve, address(hook.feeEscrow()), quote, me);
        staking.setRewardsDistributor(address(treasury));
        treasury.setStaking(address(staking));
        treasury.setKeeper(keeper);
        staking.transferOwnership(owner);
        treasury.transferOwnership(owner);
        vm.stopBroadcast();

        console.log("staking (ERC20):", address(staking));
        console.log("treasury(ERC20):", address(treasury));
        console.log("pending owner:  ", owner);
        console.log("ACTION (Safe): hook.setProtocolFeeRecipient(treasury); staking.acceptOwnership(); treasury.acceptOwnership()");
    }
}
