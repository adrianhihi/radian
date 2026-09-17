// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {WallTreasury} from "../src/radian/wall/WallTreasury.sol";
import {MockStock} from "../src/mock/MockStock.sol";

/// Launches a Stock Treasury showcase through the current router (with the
/// post-graduation ladder), quoted in a stock stand-in. Env: ROUTER, STOCK,
/// SALT (uint), NAME, SYMBOL, OPENING_BUY_RAW.
contract LaunchWallShowcase is Script {
    address[] noExempt;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        RadianLaunchRouter router = RadianLaunchRouter(payable(vm.envAddress("ROUTER")));
        MockStock stock = MockStock(vm.envAddress("STOCK"));
        uint256 buy = vm.envOr("OPENING_BUY_RAW", uint256(2e18));
        uint256 fee = router.factory().launchFee();
        WallTreasury.Config memory cfg = WallTreasury.Config({
            marginBps: 500, epochBudgetBps: 1000, streamBps: 3000, maxSlippageBps: 500, minInterval: 3600, keeperBounty: 0.01e18
        });
        vm.startBroadcast(pk);
        stock.mint(me, buy);
        stock.approve(address(router), buy);
        (address t, address c, address tr, address st) = router.launchWall{value: fee}(
            PonsV2LaunchFactory.TokenParams({
                name: vm.envOr("NAME", string("Stock Treasury Showcase v2")),
                symbol: vm.envOr("SYMBOL", string("STSHOW2")),
                logo: "",
                description: "Template showcase launched by the Radian team on testnet: a Stock Treasury (The Wall) launch with the post-graduation bid ladder, quoted in a clearly labeled stock stand-in. Creator fees build a pile that is never sold; 30% of every claim streams to stakers; the rest keeps a standing bid under book value, on the curve first and as a seven-rung ladder in the Uniswap V4 pool after graduation. Not a real project.",
                socials: PonsV2LauncherToken.Socials("", "", "", "https://github.com/adrianhihi/radian-wall", ""),
                creatorFeeRecipient: me,
                creatorTaxBps: 0,
                buybackEnabled: false,
                expectedEconomics: bytes32(0),
                salt: bytes32(vm.envOr("SALT", uint256(0xA31)))
            }),
            0,
            address(stock),
            buy,
            0,
            noExempt,
            cfg
        );
        vm.stopBroadcast();
        console.log("token:", t);
        console.log("curve:", c);
        console.log("treasury:", tr);
        console.log("staking:", st);
        console.log("ladder:", WallTreasury(payable(tr)).ladder());
    }
}
