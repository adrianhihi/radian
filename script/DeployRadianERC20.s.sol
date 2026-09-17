// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {PonsV2MemeHook} from "../src/v2/hooks/PonsV2MemeHook.sol";
import {RadianStakingERC20} from "../src/radian/RadianStakingERC20.sol";
import {RadianTreasuryERC20} from "../src/radian/RadianTreasuryERC20.sol";

/// @notice Launches $RADIAN on a chain whose dollar is an ERC-20 (Robinhood
/// Chain: USDG / testnet USDGx), deploys the ERC-20-reward flywheel, wires it,
/// and points the hook's protocol-fee recipient at the treasury.
///
/// Env:
///   PRIVATE_KEY, FACTORY, HOOK, QUOTE (the dollar ERC-20 the curve is priced in)
///   OPENING_BUY_RAW  optional opening buy in quote units (approve happens here)
///   KEEPER, OWNER    default: broadcaster; OWNER != broadcaster starts a two-step handover
///   RADIAN_DESCRIPTION optional on-chain description
contract DeployRadianERC20 is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory = PonsV2LaunchFactory(payable(vm.envAddress("FACTORY")));
        PonsV2MemeHook hook = PonsV2MemeHook(payable(vm.envAddress("HOOK")));
        address quote = vm.envAddress("QUOTE");
        uint256 openingBuy = vm.envOr("OPENING_BUY_RAW", uint256(0));
        address keeper = vm.envOr("KEEPER", me);
        address owner = vm.envOr("OWNER", me);
        string memory description = vm.envOr(
            "RADIAN_DESCRIPTION",
            string(
                "Radian's protocol token. Platform fees buy it back and burn it; the rest streams to stakers as the chain's dollar. Fair-launched on Radian's own curve, no team allocation."
            )
        );
        require(factory.approvedPairTokens(quote), "quote not approved on the factory");
        uint256 fee = factory.launchFee();

        vm.startBroadcast(pk);
        (address token, address curve) = factory.launchToken{value: fee}(
            PonsV2LaunchFactory.TokenParams({
                name: "Radian",
                symbol: "RADIAN",
                logo: "",
                description: description,
                socials: PonsV2LauncherToken.Socials("", "", "", "https://radian-sable.vercel.app/earn", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: true,
                expectedEconomics: bytes32(0),
                salt: bytes32(uint256(0xAD1A))
            }),
            0,
            quote
        );
        RadianStakingERC20 staking = new RadianStakingERC20(token, quote, me);
        RadianTreasuryERC20 treasury = new RadianTreasuryERC20(token, curve, address(hook.feeEscrow()), quote, me);
        staking.setRewardsDistributor(address(treasury));
        treasury.setStaking(address(staking)); // checks the pool points back at this treasury
        treasury.setKeeper(keeper);
        hook.setProtocolFeeRecipient(address(treasury));
        if (openingBuy > 0) {
            IERC20(quote).approve(curve, openingBuy);
            PonsV2BondingCurve(curve).buy(openingBuy, 0, me);
        }
        if (owner != me) {
            staking.transferOwnership(owner);
            treasury.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console.log("RADIAN token:   ", token);
        console.log("RADIAN curve:   ", curve);
        console.log("quote:          ", quote);
        console.log("staking (ERC20):", address(staking));
        console.log("treasury(ERC20):", address(treasury));
        console.log("keeper:         ", keeper);
        console.log("hook.protocolFeeRecipient ->", address(treasury));
        if (owner != me) console.log("pending owner (accept from):", owner);
    }
}
