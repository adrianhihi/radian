// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";

/// @notice Robinhood TESTNET: one launch priced in a Pack coin (RHDOG), so "pairing" — every trade
/// of this token buys the ally coin — is visible on the site. Stays on the curve (opening buy well
/// under the 10M RHDOG goal). Env: PRIVATE_KEY (holds RHDOG from the Pack seeding).
contract LaunchPackPaired is Script {
    address constant FACTORY = 0x55622f7eD404f982cb6C5fa12268894A580848F6;
    address constant ROUTER = 0x6AD94a7A0073deCc6114Ee8B5A1ED3fcC20296a4;
    address constant RHDOG = 0x1Ad078768676Af931388f7eBCA9370e677b30502;
    uint256 constant BUY = 1_500_000e18;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        uint256 fee = PonsV2LaunchFactory(payable(FACTORY)).launchFee();
        console.log("RHDOG balance", IERC20(RHDOG).balanceOf(me) / 1e18);
        vm.startBroadcast(pk);
        IERC20(RHDOG).approve(ROUTER, BUY);
        (address token, address curve, uint256 out) = RadianLaunchRouter(payable(ROUTER)).launchAndBuy{value: fee}(
            PonsV2LaunchFactory.TokenParams({
                name: "Dog Ally",
                symbol: "DOGALLY",
                logo: "",
                description: "Priced in $RHDOG, a Pack coin: every buy and sell of this token buys Robinhood Dog on the curve, not just at the weekly burn. Testnet demonstration of pairing.",
                socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: true,
                expectedEconomics: bytes32(0),
                salt: keccak256("pack-paired-dogally")
            }),
            0,
            RHDOG,
            BUY,
            0,
            new address[](0),
            address(0)
        );
        vm.stopBroadcast();
        console.log("DOGALLY", token);
        console.log("curve", curve, "tokensOut", out / 1e18);
    }
}
