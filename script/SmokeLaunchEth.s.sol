// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mainnet smoke test while launches are closed: the whitelisted
/// broadcaster launches one ETH-quoted token through the router with a tiny
/// opening buy, then sells half of it back, so launch, buy and sell are all
/// exercised on the real chain. Graduation is not attempted.
///
/// Env: PRIVATE_KEY, ROUTER, optional BUY_WEI (default 0.0005 ETH), NAME, SYMBOL.
contract SmokeLaunchEth is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        RadianLaunchRouter router = RadianLaunchRouter(payable(vm.envAddress("ROUTER")));
        PonsV2LaunchFactory factory = router.factory();
        uint256 buy = vm.envOr("BUY_WEI", uint256(0.0005 ether));
        string memory name = vm.envOr("NAME", string("Radian Mainnet Smoke"));
        string memory symbol = vm.envOr("SYMBOL", string("RHMAIN"));
        require(factory.canLaunch(me), "broadcaster is not whitelisted");
        uint256 fee = factory.launchFee();

        vm.startBroadcast(pk);
        (address token, address curve, uint256 out) = router.launchAndBuy{value: fee + buy}(
            PonsV2LaunchFactory.TokenParams({
                name: name,
                symbol: symbol,
                logo: "",
                description: "Stage A smoke launch. Not a product. Launches on this chain are closed.",
                socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: true,
                expectedEconomics: bytes32(0),
                salt: bytes32(uint256(0x5A0E))
            }),
            0,
            address(0),
            buy,
            0,
            new address[](0),
            address(0)
        );
        uint256 half = out / 2;
        IERC20(token).approve(curve, half);
        uint256 quoteOut = PonsV2BondingCurve(curve).sell(half, 0, me);
        vm.stopBroadcast();

        console.log("token:      ", token);
        console.log("curve:      ", curve);
        console.log("bought:     ", out);
        console.log("sold half ->", quoteOut, "wei");
    }
}
