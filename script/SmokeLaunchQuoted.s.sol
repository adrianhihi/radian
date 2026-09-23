// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Smoke launch paired with an ERC-20 quote asset, through the router,
///         with an optional referrer (The Pound). The broadcaster pays the launch
///         fee in the gas coin and the opening buy in the quote asset.
///
/// Env: PRIVATE_KEY, ROUTER, QUOTE (ERC-20), BUY (quote units, raw), optional
///      REFERRER, NAME, SYMBOL, SALT.
contract SmokeLaunchQuoted is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        RadianLaunchRouter router = RadianLaunchRouter(payable(vm.envAddress("ROUTER")));
        PonsV2LaunchFactory factory = router.factory();
        address quote = vm.envAddress("QUOTE");
        uint256 buy = vm.envUint("BUY");
        address referrer = vm.envOr("REFERRER", address(0));
        string memory name = vm.envOr("NAME", string("Pound Smoke"));
        string memory symbol = vm.envOr("SYMBOL", string("PNDT"));
        bytes32 salt = bytes32(vm.envOr("SALT", uint256(0x90D)));
        require(factory.canLaunch(me), "broadcaster may not launch");
        uint256 fee = factory.launchFee();

        vm.startBroadcast(pk);
        IERC20(quote).approve(address(router), buy);
        (address token, address curve, uint256 out) = router.launchAndBuy{value: fee}(
            PonsV2LaunchFactory.TokenParams({
                name: name,
                symbol: symbol,
                logo: "",
                description: "The Pound smoke launch: referral tags, vault settlement, Pack burn. Not a product.",
                socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: true,
                expectedEconomics: bytes32(0),
                salt: salt
            }),
            0,
            quote,
            buy,
            0,
            new address[](0),
            referrer
        );
        vm.stopBroadcast();

        console.log("token:      ", token);
        console.log("curve:      ", curve);
        console.log("bought:     ", out);
        console.log("launcherRef:", router.launcherRef(token));
    }
}
