// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {RadianStaking} from "../src/radian/RadianStaking.sol";
import {RadianTreasury} from "../src/radian/RadianTreasury.sol";

/// Deploys the $RADIAN flywheel on Arc testnet:
/// 1. adds a non-graduating launch config (so $RADIAN keeps its curve as the
///    buyback venue), 2. launches $RADIAN on Radian itself (dogfood), 3. deploys
///    RadianStaking + RadianTreasury and wires them.
contract DeployRadian is Script {
    address constant FACTORY = 0x90022cC2107De9c070F889E3A67009FcA270E4E2;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory = PonsV2LaunchFactory(payable(FACTORY));

        vm.startBroadcast(pk);

        // Non-graduating config for the protocol token (huge graduation threshold).
        uint256 configId = factory.addLaunchConfig(
            PonsV2LaunchFactory.LaunchConfig({
                supply: 1_000_000_000e18,
                curveFeeBps: 100,
                phantomQuote: 6_000e18, // opening FDV ~ $6k
                graduationThreshold: 1_000_000e18, // effectively never graduates
                poolFee: 0,
                tickSpacing: 200,
                enabled: true
            })
        );

        (address token, address curve) = factory.launchToken{value: 1e18}(
            PonsV2LaunchFactory.TokenParams({
                name: "Radian",
                symbol: "RADIAN",
                logo: "",
                description: "The Radian protocol token. Stake it to earn a share of every fee the platform collects, in USDC. Fees also buy it back and burn it. Launched fair on Radian's own launchpad.",
                socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: true,
                expectedEconomics: bytes32(0),
                salt: bytes32(uint256(0x2AD1A4))
            }),
            configId,
            address(0)
        );

        RadianStaking staking = new RadianStaking(token, me);
        RadianTreasury treasury = new RadianTreasury(token, curve, me);
        treasury.setStaking(address(staking));
        staking.setRewardsDistributor(address(treasury));
        treasury.setKeeper(me);

        vm.stopBroadcast();

        console.log("RADIAN token:  ", token);
        console.log("RADIAN curve:  ", curve);
        console.log("RadianStaking: ", address(staking));
        console.log("RadianTreasury:", address(treasury));
        console.log("configId:      ", configId);
    }
}
