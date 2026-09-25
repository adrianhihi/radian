// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2LauncherToken} from "../src/v2/PonsV2LauncherToken.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {PackBurner} from "../src/pound/PackBurner.sol";
import {MockUSD} from "../src/mock/MockUSD.sol";

/// @notice Robinhood TESTNET only: seeds The Pack with clearly-labelled stand-in dog / cat coins so
/// the rotation, the floors and the "every trade buys the ally" pairing are demonstrable.
///   1. mint USDGx (the testnet dollar stand-in mints freely)
///   2. launch each coin through the router with an opening buy past the graduation goal, so it is
///      born, graduates and gets its locked V4 pool in one transaction
///   3. add it to the PackBurner (floor 0.1 USDGx, cap 5 USDGx per burn) with its pool key
///   4. approve it as a pair asset (phantom 4M, goal 10M coins) so new launches can be priced in it
///   5. burns every hour on the testnet (mainnet: weekly, by the Safe)
/// Env: PRIVATE_KEY (factory + burner owner on the testnet).
contract SeedPack is Script {
    address constant FACTORY = 0x55622f7eD404f982cb6C5fa12268894A580848F6;
    address constant ROUTER = 0x6AD94a7A0073deCc6114Ee8B5A1ED3fcC20296a4;
    address constant BURNER = 0xd8c4A6129b8b9dbaFf651A22e9504dd49358Ea6c;
    address constant USDGX = 0xf6f8fF47fEa2f2cE3195ad197B8A9BF520c13ed0;
    address constant KEEPER = 0xBb5b9503562CB4a2C86776c55C57EfFF1889779c;
    uint256 constant BUY = 10_600e6; // goal is 10,000 USDGx; the router refunds a clamped fill
    uint128 constant FLOOR = 100_000; // 0.1 USDGx
    uint128 constant CAP = 5_000_000; // 5 USDGx per burn

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        PonsV2LaunchFactory factory = PonsV2LaunchFactory(payable(FACTORY));
        RadianLaunchRouter router = RadianLaunchRouter(payable(ROUTER));
        PackBurner burner = PackBurner(payable(BURNER));

        string[4] memory names = ["Robinhood Dog", "Zcat", "Pack Puppy", "Alley Kitty"];
        string[4] memory symbols = ["RHDOG", "ZCAT", "PUPPY", "KITTY"];
        uint256 fee = factory.launchFee();

        vm.startBroadcast(pk);
        MockUSD(USDGX).mint(me, 4 * BUY);
        IERC20(USDGX).approve(ROUTER, 4 * BUY);
        for (uint256 i = 0; i < names.length; i++) {
            (address token, address curve,) = router.launchAndBuy{value: fee}(
                PonsV2LaunchFactory.TokenParams({
                    name: names[i],
                    symbol: symbols[i],
                    logo: "",
                    description: "Pack coin on the Robinhood testnet: a stand-in for a community dog / cat coin. The Pound burns it on rotation and new launches can be priced in it.",
                    socials: PonsV2LauncherToken.Socials("", "", "", "", ""),
                    creatorFeeRecipient: me,
                    creatorTaxBps: 0,
                    buybackEnabled: true,
                    expectedEconomics: bytes32(0),
                    salt: keccak256(abi.encode("pack-seed", symbols[i]))
                }),
                0,
                USDGX,
                BUY,
                0,
                new address[](0),
                address(0)
            );
            bool graduated = PonsV2BondingCurve(curve).graduated();
            PonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
            if (uint8(L.phase) < 2) {
                try factory.createGraduatedPool(token) {} catch {}
                L = factory.getLaunchedToken(token);
            }
            (address c0, address c1) = token < USDGX ? (token, USDGX) : (USDGX, token);
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(c0),
                currency1: Currency.wrap(c1),
                fee: L.poolFee,
                tickSpacing: L.tickSpacing,
                hooks: IHooks(address(factory.memeHook()))
            });
            uint256 idx = burner.addPack(token, key, FLOOR, CAP);
            factory.setPairTokenEconomics(token, 4_000_000e18, 10_000_000e18, 18);
            factory.setPairTokenApproved(token, true);
            console.log(symbols[i], token);
            console.log("  curve", curve, "graduated", graduated);
            console.log("  phase", uint256(uint8(L.phase)), "pack index", idx);
        }
        burner.setParams(3600, 50, 500, false, KEEPER);
        vm.stopBroadcast();
        console.log("packCount", burner.packCount());
    }
}
