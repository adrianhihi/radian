// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PonsV2IntegrationTest} from "./PonsV2Integration.t.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {WallTreasury} from "../src/radian/wall/WallTreasury.sol";
import {WallStaking} from "../src/radian/wall/WallStaking.sol";
import {WallLadder} from "../src/radian/wall/WallLadder.sol";
import {PoFVault} from "../src/radian/pof/PoFVault.sol";
import {PoundVault} from "../src/pound/PoundVault.sol";
import {PackBurner} from "../src/pound/PackBurner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/// The Pound core on the V2 harness: router v4 referral tags → PoundVault
/// waterfall → PackBurner buying and burning a graduated token's V4 pool.
contract PoundCoreTest is PonsV2IntegrationTest {
    RadianLaunchRouter router;
    PoundVault pv;
    PackBurner burner;
    address dana = makeAddr("dana");
    address ref1 = makeAddr("ref1");
    address ref2 = makeAddr("ref2");
    address treasury = makeAddr("treasury");
    address keeper = makeAddr("keeper");
    address[] noExempt;

    function setUp() public override {
        super.setUp();
        router = new RadianLaunchRouter(factory, address(new WallTreasury()), address(new WallStaking()), address(new WallLadder()), address(new PoFVault()));
        pv = new PoundVault(address(feeEscrow), treasury, owner);
        burner = new PackBurner(address(poolManager), owner);
        vm.startPrank(owner);
        factory.setLaunchForwarder(address(router));
        router.setVault(address(pv));
        router.setKeeper(keeper);
        pv.setRouter(address(router));
        pv.setBurner(address(burner));
        burner.setParams(1 days, 50, 500, false, keeper);
        hook.setProtocolFeeRecipient(address(pv));
        hook.setProtocolFeeShareBps(5_000);
        vm.stopPrank();
        vm.deal(dana, 100e18);
        vm.deal(bob, 100e18);
    }

    function _launch(bytes32 salt, uint256 buyAmt, address referrer) internal returns (address t, address c) {
        PonsV2LaunchFactory.TokenParams memory p = _params(salt);
        p.creatorFeeRecipient = dana;
        vm.prank(dana);
        (t, c,) = router.launchAndBuy{value: LAUNCH_FEE + buyAmt}(p, 0, address(0), buyAmt, 0, noExempt, referrer);
    }

    // ---- referral attribution ----

    function test_launchAndBuyRecordsLauncherRefAndCreditsBothShares() public {
        (address t,) = _launch(bytes32(uint256(21)), 1e18, ref1);
        assertEq(router.launcherRef(t), ref1, "launcher reference recorded");
        uint256 fee = 1e16; // 1% of the creator's untaxed opening buy
        uint256 share = (fee * pv.REFERRAL_BPS()) / 10_000;
        // ref1 brought the creator (launcher share) and is the buyer's referrer on the opening buy
        assertEq(pv.pending(address(0), ref1), 2 * share, "both shares to ref1");
        assertEq(pv.totalPending(address(0)), 2 * share);
    }

    function test_routerBuyCreditsBuyerReferrerAndLauncherRef() public {
        (address t,) = _launch(bytes32(uint256(22)), 0, ref1);
        vm.warp(vm.getBlockTimestamp() + 20); // past the snipe window
        uint256 before = pv.pending(address(0), ref1);
        vm.prank(bob);
        uint256 out = router.buy{value: 1e18}(t, 1e18, 0, bob, ref2);
        assertGt(out, 0);
        assertEq(IERC20(t).balanceOf(bob), out, "tokens to the buyer");
        uint256 fee = 1e16;
        uint256 share = (fee * pv.REFERRAL_BPS()) / 10_000;
        assertEq(pv.pending(address(0), ref2), share, "buyer's referrer");
        assertEq(pv.pending(address(0), ref1) - before, share, "creator's referrer, on someone else's trade");
    }

    function test_selfReferralIsIgnored() public {
        (address t,) = _launch(bytes32(uint256(23)), 0, address(0));
        vm.warp(vm.getBlockTimestamp() + 20);
        vm.prank(bob);
        router.buy{value: 1e18}(t, 1e18, 0, bob, bob);
        assertEq(pv.pending(address(0), bob), 0, "no self referral");
        assertEq(pv.totalPending(address(0)), 0);
    }

    function test_routerSellCreditsReferrer() public {
        (address t,) = _launch(bytes32(uint256(24)), 0, address(0));
        vm.warp(vm.getBlockTimestamp() + 20);
        vm.prank(bob);
        uint256 out = router.buy{value: 1e18}(t, 1e18, 0, bob, address(0));
        vm.startPrank(bob);
        IERC20(t).approve(address(router), out);
        uint256 balBefore = bob.balance;
        uint256 quoteOut = router.sell(t, out, 0, bob, ref2);
        vm.stopPrank();
        assertEq(bob.balance - balBefore, quoteOut, "quote to the seller");
        uint256 fee = (quoteOut * 100) / (10_000 - 100);
        assertEq(pv.pending(address(0), ref2), (fee * pv.REFERRAL_BPS()) / 10_000, "referrer credited on the sell");
    }

    function test_onlyRouterAttributes() public {
        vm.expectRevert(PoundVault.NotRouter.selector);
        pv.attribute(address(0), bob, ref1, address(0), 1e18);
    }

    // ---- the waterfall ----

    function test_settleFundsReferralsThenSplitsBurnAndTreasury() public {
        (address t, address c) = _launch(bytes32(uint256(25)), 1e18, ref1);
        vm.warp(vm.getBlockTimestamp() + 20);
        vm.prank(bob);
        router.buy{value: 5e18}(t, 5e18, 0, bob, ref2);
        // the curve holds the fees until swept; buyback launches need the fee sweep operator (the owner here)
        vm.prank(owner);
        PonsV2BondingCurve(c).sweepFees(1); // the internal buyback needs a nonzero minimum
        assertGt(feeEscrow.balanceOf(address(pv)), 0, "protocol share credited to the vault");
        uint256 owed = pv.totalPending(address(0));
        uint256 treasuryBefore = treasury.balance;
        (uint256 intake, uint256 toReferrals, uint256 toBurn, uint256 toTreasury) = pv.settle(address(0));
        assertEq(intake, toReferrals + toBurn + toTreasury, "everything is allocated");
        assertEq(toReferrals, owed, "referrals funded in full (launch fee alone covers them)");
        assertEq(pv.reserve(address(0)), owed);
        assertEq(toBurn, ((intake - owed) * pv.burnShareBps()) / 10_000, "burn share of the remainder");
        assertEq(burner.pool(address(0)), toBurn, "burn pool funded");
        assertEq(treasury.balance - treasuryBefore, toTreasury, "treasury paid");
        assertEq(address(pv).balance, owed, "only the referral reserve stays");
        // referrers pull
        (uint256 claimable,) = pv.referralOf(address(0), ref1);
        uint256 r1Before = ref1.balance;
        vm.prank(ref1);
        uint256 got = pv.claimReferral(address(0));
        assertEq(got, claimable);
        assertEq(ref1.balance - r1Before, got);
        assertEq(pv.pending(address(0), ref1), 0);
    }

    function test_settleWithNothingIsHarmless() public {
        (uint256 intake,,,) = pv.settle(address(0));
        assertEq(intake, 0);
    }

    function test_burnShareBounds() public {
        vm.startPrank(owner);
        vm.expectRevert("range");
        pv.setBurnShare(4_999);
        pv.setBurnShare(10_000);
        vm.stopPrank();
        assertEq(pv.burnShareBps(), 10_000);
    }

    // ---- the Pack ----

    function _graduatedKey(address t) internal view returns (PoolKey memory) {
        return PoolKey({currency0: Currency.wrap(address(0)), currency1: Currency.wrap(t), fee: 0, tickSpacing: 200, hooks: IHooks(address(hook))});
    }

    function _packCoin() internal returns (address t) {
        (t,) = _launch(bytes32(uint256(26)), 0, address(0));
        vm.warp(vm.getBlockTimestamp() + 20);
        address c = factory.getLaunchedToken(t).curve; // hoisted: a view call in the arguments would eat the prank
        vm.prank(alice);
        PonsV2BondingCurve(c).buy{value: 40e18}(40e18, 0, alice);
        if (!locker.isLocked(t)) factory.createGraduatedPool(t);
        assertTrue(locker.isLocked(t), "pool seeded");
        vm.prank(owner);
        burner.addPack(t, _graduatedKey(t), 0.1e18, 1e18);
        burner.deposit{value: 3e18}(address(0), 3e18);
    }

    function test_burnBuysNextPackCoinToTheDeadAddress() public {
        address t = _packCoin();
        uint256 quoteIn = 0.5e18 - (0.5e18 * 50) / 10_000;
        uint256 floorOut = (burner.spotOut(0, quoteIn) * 9_500) / 10_000;
        uint256 keeperBefore = keeper.balance;
        vm.prank(keeper);
        (uint256 index, uint256 out) = burner.burn(0.5e18, floorOut);
        assertEq(index, 0);
        assertGe(out, floorOut, "cleared the spot floor");
        assertEq(IERC20(t).balanceOf(burner.DEAD()), out, "tokens are dead");
        assertEq(burner.burnedOf(t), out);
        assertEq(burner.pool(address(0)), 3e18 - 0.5e18, "pool debited by the full amount");
        assertEq(keeper.balance - keeperBefore, (0.5e18 * 50) / 10_000, "bounty to the caller");
        assertEq(burner.cursor(), 0, "single coin: rotation wraps");
        assertEq(burner.lastBurnAt(), vm.getBlockTimestamp());
    }

    function test_burnRespectsIntervalBoundsFloorAndGate() public {
        _packCoin();
        uint256 quoteIn = 0.5e18 - (0.5e18 * 50) / 10_000;
        uint256 floorOut = (burner.spotOut(0, quoteIn) * 9_500) / 10_000;
        // not keeper, not owner, not permissionless
        vm.prank(alice);
        vm.expectRevert(PackBurner.NotAllowed.selector);
        burner.burn(0.5e18, floorOut);
        // below the coin's floor / above its cap
        vm.startPrank(keeper);
        vm.expectRevert(PackBurner.BadAmount.selector);
        burner.burn(0.05e18, 0);
        vm.expectRevert(PackBurner.BadAmount.selector);
        burner.burn(2e18, 0);
        // a lazy quote is refused
        vm.expectRevert(abi.encodeWithSelector(PackBurner.BelowFloor.selector, floorOut - 1, floorOut));
        burner.burn(0.5e18, floorOut - 1);
        burner.burn(0.5e18, floorOut);
        // too soon for the next one
        uint256 q2 = 0.5e18 - (0.5e18 * 50) / 10_000;
        uint256 f2 = (burner.spotOut(0, q2) * 9_500) / 10_000;
        vm.expectRevert(PackBurner.TooSoon.selector);
        burner.burn(0.5e18, f2);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 1 days);
        // permissionless mode lets anyone crank, checks unchanged
        vm.prank(owner);
        burner.setParams(1 days, 50, 500, true, keeper);
        uint256 f3 = (burner.spotOut(0, q2) * 9_500) / 10_000;
        vm.prank(alice);
        (, uint256 out) = burner.burn(0.5e18, f3);
        assertGt(out, 0);
    }

    function test_addPackRejectsForeignKeyAndNeedsInitializedPool() public {
        (address t,) = _launch(bytes32(uint256(27)), 0, address(0));
        vm.startPrank(owner);
        vm.expectRevert(PackBurner.BadKey.selector);
        burner.addPack(bob, _graduatedKey(t), 1, 1);
        vm.expectRevert("pool not initialized");
        burner.addPack(t, _graduatedKey(t), 1, 1); // not graduated: no pool yet
        vm.stopPrank();
    }

    // ---- templates gate ----

    function test_templatesAreOffUntilEnabled() public {
        PonsV2LaunchFactory.TokenParams memory p = _params(bytes32(uint256(28)));
        vm.prank(dana);
        vm.expectRevert(RadianLaunchRouter.TemplatesDisabled.selector);
        router.launchPoF{value: LAUNCH_FEE}(p, 0, address(0), 0, 0, noExempt, PoFVault.Config({targetWork: 1e18, roundSeconds: 3600, minInterval: 600, maxBuybackReserveBps: 100}));
    }
}
