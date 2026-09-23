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
import {MockStock} from "../src/mock/MockStock.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

contract WallLadderTest is PonsV2IntegrationTest {
    RadianLaunchRouter router;
    MockStock stock;
    address dana = makeAddr("dana");
    address kp = makeAddr("keeper");
    address[] noExempt;

    function setUp() public override {
        super.setUp();
        router = new RadianLaunchRouter(
            factory, address(new WallTreasury()), address(new WallStaking()), address(new WallLadder()), address(new PoFVault())
        );
        vm.prank(factory.owner());
        router.setTemplatesEnabled(true);
        vm.startPrank(owner);
        factory.setLaunchForwarder(address(router));
        router.setKeeper(kp);
        vm.stopPrank();
        stock = new MockStock("Nvidia (test stand-in)", "NVDAx");
        vm.startPrank(owner);
        factory.setPairTokenEconomics(address(stock), 20e18, 50e18, 18);
        factory.setPairTokenApproved(address(stock), true);
        vm.stopPrank();
        vm.deal(dana, 100e18);
        vm.deal(alice, 200e18);
        vm.deal(bob, 200e18);
        vm.deal(kp, 1e18);
        stock.mint(dana, 1_000e18);
        stock.mint(alice, 1_000e18);
        stock.mint(bob, 1_000e18);
    }

    function _cfg() internal pure returns (WallTreasury.Config memory) {
        return WallTreasury.Config({
            marginBps: 500, epochBudgetBps: 1000, streamBps: 3000, maxSlippageBps: 1000, minInterval: 3600, keeperBounty: 1e15
        });
    }

    function _launch(address pair, uint256 buyAmt, bytes32 salt)
        internal
        returns (address t, address c, WallTreasury tr, WallLadder ld)
    {
        PonsV2LaunchFactory.TokenParams memory p = _params(salt);
        p.creatorFeeRecipient = dana;
        vm.startPrank(dana);
        if (pair != address(0)) stock.approve(address(router), buyAmt);
        (address token, address curve, address treasury,) =
            router.launchWall{value: LAUNCH_FEE + (pair == address(0) ? buyAmt : 0)}(p, 0, pair, buyAmt, 0, noExempt, _cfg());
        vm.stopPrank();
        tr = WallTreasury(payable(treasury));
        return (token, curve, tr, WallLadder(payable(tr.ladder())));
    }

    function _graduate(address t, address c, address pair) internal {
        vm.warp(vm.getBlockTimestamp() + 20);
        if (pair == address(0)) {
            vm.prank(alice);
            PonsV2BondingCurve(c).buy{value: 40e18}(40e18, 0, alice);
        } else {
            vm.startPrank(alice);
            stock.approve(c, 80e18);
            PonsV2BondingCurve(c).buy(80e18, 0, alice);
            vm.stopPrank();
        }
        assertTrue(PonsV2BondingCurve(c).graduated(), "graduated");
        if (!locker.isLocked(t)) factory.createGraduatedPool(t);
        assertTrue(locker.isLocked(t), "pool seeded");
    }

    function _key(WallLadder ld) internal view returns (PoolKey memory k) {
        (Currency c0, Currency c1, uint24 fee, int24 ts, IHooks h) = ld.key();
        k = PoolKey({currency0: c0, currency1: c1, fee: fee, tickSpacing: ts, hooks: h});
    }

    /// sells `amount` tokens into the pool (crashes the price)
    function _dump(WallLadder ld, address t, address who, uint256 amount) internal {
        PoolKey memory k = _key(ld);
        bool tokenIs0 = Currency.unwrap(k.currency0) == t;
        vm.startPrank(who);
        IERC20(t).approve(address(swapRouter), amount);
        swapRouter.swap(
            k,
            SwapParams({
                zeroForOne: tokenIs0,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: tokenIs0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    /// buys tokens with `amount` quote (pumps the price)
    function _pump(WallLadder ld, address t, address who, uint256 amount) internal {
        PoolKey memory k = _key(ld);
        bool quoteIs0 = Currency.unwrap(k.currency0) != t;
        bool native = ld.quote() == address(0);
        vm.startPrank(who);
        if (!native) IERC20(ld.quote()).approve(address(swapRouter), amount);
        swapRouter.swap{value: native ? amount : 0}(
            k,
            SwapParams({
                zeroForOne: quoteIs0,
                amountSpecified: -int256(amount),
                sqrtPriceLimitX96: quoteIs0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
    }

    function _w(WallLadder ld, int24 tick) internal view returns (int24) {
        return ld.quoteIsCurrency0() ? -tick : tick;
    }

    function _rung(WallLadder ld, uint8 i) internal view returns (uint256 tokenId, int24 lo, int24 hi, uint256 quoteIn) {
        return ld.rungs(i);
    }

    function _assertBooksClose(WallLadder ld) internal view {
        int256 gap = ld.ledgerGap();
        assertLe(gap < 0 ? -gap : gap, 1e9, "ledger conserved (dust only)");
    }

    // ---- wiring ----

    function test_ladder_wiredAtLaunchAndGatedUntilGraduation() public {
        (address t, address c, WallTreasury tr, WallLadder ld) = _launch(address(0), 1e18, bytes32(uint256(41)));
        assertEq(address(ld), router.predictWallLadder(dana, bytes32(uint256(41))));
        assertEq(ld.treasury(), address(tr));
        assertEq(ld.token(), t);
        assertEq(ld.quote(), address(0));
        (Currency c0, Currency c1,,,) = ld.key();
        assertTrue(Currency.unwrap(c0) < Currency.unwrap(c1), "sorted");
        assertEq(Currency.unwrap(c0), address(0));
        assertTrue(ld.quoteIsCurrency0());
        vm.deal(address(tr), 1e18);
        vm.prank(kp);
        vm.expectRevert(bytes("not graduated"));
        tr.fundLadder();
        vm.prank(kp);
        vm.expectRevert(WallLadder.PoolNotLive.selector);
        ld.poke();
        vm.prank(alice);
        vm.expectRevert(WallLadder.NotTreasury.selector);
        ld.deposit{value: 1}(1);
        assertFalse(PonsV2BondingCurve(c).graduated());
    }

    // ---- native quote: the full cycle ----

    function test_ladder_native_fundPostFillBurnRebaseAndRatchet() public {
        (address t, address c, WallTreasury tr, WallLadder ld) = _launch(address(0), 1e18, bytes32(uint256(42)));
        _graduate(t, c, address(0));

        // the pile accumulated from fees moves to the ladder (big enough that
        // book value sits near the spot; a small pile caps the anchor at 2x book)
        vm.deal(address(tr), 100e18);
        vm.prank(kp);
        uint256 moved = tr.fundLadder();
        assertEq(moved, 100e18);
        assertEq(ld.totalIn(), 100e18);
        assertEq(ld.keeperEscrow(), 30e15, "2% of inflow, capped at 30 bounties");
        assertEq(ld.pending(), 100e18 - 30e15);
        assertEq(tr.reserve(), 0);
        assertEq(tr.bookValue(), ld.bookValue(), "book value counts the ladder");
        assertGt(tr.bookValue(), 0);

        // beat 1: anchor at the spot; under-covered → everything to the deep rung
        uint256 kpBefore = kp.balance;
        vm.prank(kp);
        (uint256 harvested, uint256 posted) = ld.poke();
        assertEq(harvested, 0);
        assertGt(posted, 0);
        assertTrue(ld.anchored());
        (uint256 id6,,, uint256 q6) = _rung(ld, 6);
        assertGt(id6, 0, "deep rung posted");
        assertEq(q6, posted, "all of it deep while under-covered");
        for (uint8 i = 0; i < 6; i++) {
            (uint256 id,,,) = _rung(ld, i);
            assertEq(id, 0);
        }
        assertGt(positionManager.getPositionLiquidity(id6), 0);
        assertEq(kp.balance - kpBefore, 1e15, "bounty paid last");
        assertEq(ld.pending(), 100e18 - 30e15 - posted);
        _assertBooksClose(ld);
        int24 anchorBefore = ld.anchorW();
        (int24 spot0,) = ld.currentTick();
        assertLe(anchorBefore, _w(ld, spot0), "anchor never above the spot");
        assertLe(ld.anchorPrice(), 2 * ld.bookValue() + ld.bookValue() / 100, "the -50% rung never above book value");

        // a dump lands inside the deep rung: the wall absorbs it, the anchor does not move
        uint256 aliceTokens = IERC20(t).balanceOf(alice);
        _dump(ld, t, alice, aliceTokens / 2);
        (int24 spotAfterDump,) = ld.currentTick();
        assertLt(_w(ld, spotAfterDump), anchorBefore, "price fell");
        vm.warp(vm.getBlockTimestamp() + 3600);
        uint256 supplyBefore = IERC20(t).totalSupply();
        vm.prank(kp);
        (harvested, posted) = ld.poke();
        assertGt(harvested, 0, "the touched rung is harvested");
        assertGt(ld.totalBurned(), 0, "what it bought is burned");
        assertEq(IERC20(t).totalSupply(), supplyBefore - ld.totalBurned());
        assertGt(ld.totalConverted(), 0);
        assertEq(ld.anchorW(), anchorBefore, "a dump never lowers the anchor");
        assertEq(ld.generation(), 0);
        _assertBooksClose(ld);

        // the rest of the dump falls through the whole ladder: new generation at the spot
        _dump(ld, t, alice, IERC20(t).balanceOf(alice));
        (spotAfterDump,) = ld.currentTick();
        assertLt(_w(ld, spotAfterDump), anchorBefore - 6931, "price fell through the deepest rung");
        vm.warp(vm.getBlockTimestamp() + 3600);
        vm.prank(kp);
        (harvested, posted) = ld.poke();
        assertEq(ld.generation(), 1, "market fell through the whole ladder: new generation");
        assertLe(ld.anchorW(), _w(ld, spotAfterDump) + 1, "re-based at the spot");
        assertGt(posted, 0, "freed quote re-posted below the new anchor");
        _assertBooksClose(ld);

        // a pump: the anchor follows up, at most ×1.25 per beat, and survivors migrate
        int24 anchorLow = ld.anchorW();
        (uint256 idOld,,,) = _rung(ld, 6);
        _pump(ld, t, bob, 30e18);
        (int24 spotAfterPump,) = ld.currentTick();
        assertGt(_w(ld, spotAfterPump), anchorLow + 2231, "pumped more than the slew cap");
        vm.warp(vm.getBlockTimestamp() + 3600);
        vm.prank(kp);
        ld.poke();
        assertEq(ld.anchorW(), anchorLow + 2231, "anchor rose by exactly the cap");
        (uint256 idNew,,,) = _rung(ld, 6);
        assertTrue(idNew != idOld && idNew != 0, "deep rung migrated to a new position");
        _assertBooksClose(ld);

        // the anchor keeps catching up one slew per beat (each of those beats migrates and is paid);
        // once it has caught up and nothing moves, a beat does nothing and pays nothing
        // (it stops early where the 2x-book cap binds: the market trades far above the pile)
        (int24 spotNow,) = ld.currentTick();
        int24 prevAnchor = type(int24).min;
        for (uint256 n = 0; n < 40 && ld.anchorW() != prevAnchor; n++) {
            prevAnchor = ld.anchorW();
            vm.warp(vm.getBlockTimestamp() + 3600);
            vm.prank(kp);
            ld.poke();
        }
        assertLe(ld.anchorW(), _w(ld, spotNow), "anchor never above the spot");
        assertLe(ld.anchorPrice(), 2 * ld.bookValue() + ld.bookValue() / 100, "the -50% rung never above book value");
        vm.warp(vm.getBlockTimestamp() + 3600);
        uint256 paidBefore = ld.keeperPaid();
        vm.prank(kp);
        (harvested, posted) = ld.poke();
        assertEq(harvested + posted, 0, "nothing to do");
        assertEq(ld.keeperPaid(), paidBefore, "idle beat: no bounty");
        _assertBooksClose(ld);
    }

    function test_ladder_native_splitsAcrossLayersWhenCovered() public {
        (address t, address c, WallTreasury tr, WallLadder ld) = _launch(address(0), 1e18, bytes32(uint256(43)));
        _graduate(t, c, address(0));
        vm.deal(address(tr), 150e18); // a pile big enough that the deep rung alone would cover the float
        vm.prank(kp);
        tr.fundLadder();
        vm.prank(kp);
        (, uint256 posted) = ld.poke();
        // first beat: rung 6 empty → κ = 0 → everything deep
        (,,, uint256 q6) = _rung(ld, 6);
        assertEq(q6, posted);
        // second inflow: now covered → 40% shallow / 60% middle, deep floored at 40% of the ladder
        vm.deal(address(tr), 60e18);
        vm.prank(kp);
        tr.fundLadder();
        vm.warp(vm.getBlockTimestamp() + 3600);
        vm.prank(kp);
        (, posted) = ld.poke();
        assertGt(posted, 0);
        uint256 shallow;
        uint256 middle;
        for (uint8 i = 0; i < 3; i++) {
            (uint256 id,,, uint256 q) = _rung(ld, i);
            assertGt(id, 0, "shallow rung posted");
            shallow += q;
        }
        for (uint8 i = 3; i < 6; i++) {
            (uint256 id,,, uint256 q) = _rung(ld, i);
            assertGt(id, 0, "middle rung posted");
            middle += q;
        }
        assertApproxEqRel(shallow * 3, middle * 2, 0.02e18, "40 : 60 between the shallow and middle layers");
        (,,, q6) = _rung(ld, 6);
        assertGe(q6 * 100, ld.unfilledQuote() * 39, "deep rung holds at least ~40% of the ladder");
        _assertBooksClose(ld);
    }

    // ---- ERC-20 (stock) quote ----

    function test_ladder_stockQuote_cycle() public {
        (address t, address c, WallTreasury tr, WallLadder ld) = _launch(address(stock), 5e18, bytes32(uint256(44)));
        _graduate(t, c, address(stock));
        assertEq(ld.quote(), address(stock));
        stock.mint(address(tr), 40e18);
        vm.prank(kp);
        tr.fundLadder();
        assertEq(stock.balanceOf(address(ld)), 40e18);
        vm.prank(kp);
        (, uint256 posted) = ld.poke();
        assertGt(posted, 0);
        (uint256 id6,,,) = _rung(ld, 6);
        assertGt(positionManager.getPositionLiquidity(id6), 0);
        assertEq(stock.balanceOf(kp), 1e15, "bounty in stock");
        _assertBooksClose(ld);

        uint256 aliceTokens = IERC20(t).balanceOf(alice);
        _dump(ld, t, alice, (aliceTokens * 3) / 4);
        vm.warp(vm.getBlockTimestamp() + 3600);
        uint256 supplyBefore = IERC20(t).totalSupply();
        vm.prank(kp);
        ld.poke();
        assertGt(ld.totalBurned(), 0);
        assertEq(IERC20(t).totalSupply(), supplyBefore - ld.totalBurned());
        assertEq(IERC20(t).balanceOf(address(ld)), 0, "never holds the token");
        _assertBooksClose(ld);
    }

    function test_ladder_guards() public {
        (address t, address c, WallTreasury tr, WallLadder ld) = _launch(address(0), 1e18, bytes32(uint256(45)));
        _graduate(t, c, address(0));
        vm.deal(address(tr), 2e18);
        vm.prank(alice);
        vm.expectRevert(WallTreasury.NotKeeper.selector);
        tr.fundLadder();
        vm.prank(kp);
        tr.fundLadder();
        vm.prank(alice);
        vm.expectRevert(WallLadder.NotKeeper.selector);
        ld.poke();
        vm.prank(kp);
        ld.poke();
        vm.prank(kp);
        vm.expectRevert(WallLadder.TooSoon.selector);
        ld.poke();
    }
}
