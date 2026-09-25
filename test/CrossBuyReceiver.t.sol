// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";
import {PonsV2IntegrationTest} from "./PonsV2Integration.t.sol";
import {PonsV2LaunchFactory} from "../src/v2/PonsV2LaunchFactory.sol";
import {PonsV2BondingCurve} from "../src/v2/PonsV2BondingCurve.sol";
import {RadianLaunchRouter} from "../src/radian/RadianLaunchRouter.sol";
import {WallTreasury} from "../src/radian/wall/WallTreasury.sol";
import {WallStaking} from "../src/radian/wall/WallStaking.sol";
import {WallLadder} from "../src/radian/wall/WallLadder.sol";
import {PoFVault} from "../src/radian/pof/PoFVault.sol";
import {PoundVault} from "../src/pound/PoundVault.sol";
import {CrossBuyReceiver} from "../src/pound/CrossBuyReceiver.sol";
import {MockUSD} from "../src/mock/MockUSD.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A `refundTo` that cannot take ETH until told to: the parked-refund path.
contract Rejecter {
    bool public accept;

    function setAccept(bool a) external {
        accept = a;
    }

    receive() external payable {
        require(accept, "no");
    }
}

/// A `refundTo` that tries to re-enter the receiver from the refund callback.
contract Reenterer {
    CrossBuyReceiver immutable receiver;
    address immutable token;
    bool public tried;
    bool public reentered;

    constructor(CrossBuyReceiver r, address t) {
        receiver = r;
        token = t;
    }

    receive() external payable {
        tried = true;
        try receiver.buyFor{value: 0}(token, 0, address(this), address(this), address(0)) {
            reentered = true;
        } catch {}
    }
}

/// The cross-chain receiver on the real V2 harness: router v4 + PoundVault,
/// one ETH-quoted and one USDG-style (6-dec ERC-20) launch. `solver` plays the
/// bridge executor on the home chain: it delivers and calls in one go.
contract CrossBuyReceiverTest is PonsV2IntegrationTest {
    event Attributed(address indexed asset, address indexed referrer, address indexed user, uint256 amount, bool launcher);
    event Bought(address indexed token, address indexed recipient, uint256 quoteIn, uint256 tokensOut, address referrer);
    event Refunded(address indexed token, address indexed refundTo, address asset, uint256 amount, bytes reason);
    event Parked(address indexed refundTo, address indexed asset, uint256 amount, bytes reason);

    RadianLaunchRouter router;
    PoundVault pv;
    CrossBuyReceiver receiver;
    MockUSD usd;

    address dana = makeAddr("dana"); // creator
    address solver = makeAddr("solver"); // bridge executor on the home chain
    address buyer = makeAddr("buyer"); // the cross-chain buyer's address here
    address refund = makeAddr("refund"); // refundTo
    address ref1 = makeAddr("ref1"); // brought the creator
    address ref2 = makeAddr("ref2"); // brought the buyer
    address treasury = makeAddr("treasury");
    address nope = makeAddr("not-a-launch");
    address[] noExempt;

    address ethToken;
    address usdToken;

    uint256 constant REF_SHARE_NATIVE = (1e16 * 555) / 10_000; // 1% fee on 1 ETH, 555 bps of it
    uint256 constant USD_IN = 500e6;
    uint256 constant REF_SHARE_USD = ((USD_IN / 100) * 555) / 10_000;
    // A bound no fill can meet. (The uint256 maximum would overflow the curve's
    // price check and surface as a Panic rather than SlippageExceeded.)
    uint256 constant TOO_MANY = SUPPLY;

    function setUp() public override {
        super.setUp();
        router = new RadianLaunchRouter(factory, address(new WallTreasury()), address(new WallStaking()), address(new WallLadder()), address(new PoFVault()));
        pv = new PoundVault(address(feeEscrow), treasury, owner);
        usd = new MockUSD("USDG stand-in", "USDGx");
        vm.startPrank(owner);
        factory.setLaunchForwarder(address(router));
        router.setVault(address(pv));
        pv.setRouter(address(router));
        hook.setProtocolFeeRecipient(address(pv));
        hook.setProtocolFeeShareBps(5_000);
        factory.setPairTokenEconomics(address(usd), 4_000e6, 10_000e6, 6);
        factory.setPairTokenApproved(address(usd), true);
        vm.stopPrank();

        receiver = new CrossBuyReceiver(address(router));

        vm.deal(dana, 100e18);
        vm.deal(solver, 100e18);
        usd.mint(solver, 1_000_000e6);

        ethToken = _launch(bytes32(uint256(31)), address(0), ref1);
        usdToken = _launch(bytes32(uint256(32)), address(usd), ref1);
    }

    /// The launch second taxes buyers at 99%; every receiver test runs after it
    /// (not in setUp, which would break the harness's own snipe-window test).
    modifier pastSnipeWindow() {
        vm.warp(vm.getBlockTimestamp() + 20);
        _;
    }

    function _launch(bytes32 salt, address pairToken, address referrer) internal returns (address t) {
        PonsV2LaunchFactory.TokenParams memory p = _params(salt);
        p.creatorFeeRecipient = dana;
        vm.prank(dana);
        (t,,) = router.launchAndBuy{value: LAUNCH_FEE}(p, 0, pairToken, 0, 0, noExempt, referrer);
    }

    function _lastRefunded() internal view returns (address asset, uint256 amount, bytes memory reason) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 sig = keccak256("Refunded(address,address,address,uint256,bytes)");
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == sig) return abi.decode(logs[i - 1].data, (address, uint256, bytes));
        }
        revert("no Refunded");
    }

    function _assertClean() internal view {
        assertEq(address(receiver).balance, receiver.totalOwed(address(0)), "no unparked ETH left");
        assertEq(usd.balanceOf(address(receiver)), receiver.totalOwed(address(usd)), "no unparked USD left");
        assertEq(usd.allowance(address(receiver), address(router)), 0, "no approval left");
        assertEq(IERC20(ethToken).balanceOf(address(receiver)), 0);
        assertEq(IERC20(usdToken).balanceOf(address(receiver)), 0);
    }

    // ---- happy paths ----

    function test_native_happyPath() public pastSnipeWindow {
        vm.expectEmit(true, true, true, true, address(pv));
        emit Attributed(address(0), ref2, address(receiver), REF_SHARE_NATIVE, false);
        vm.expectEmit(true, true, false, false, address(receiver));
        emit Bought(ethToken, buyer, 1e18, 0, ref2);

        vm.prank(solver);
        uint256 g = gasleft();
        receiver.buyFor{value: 1e18}(ethToken, 0, buyer, refund, ref2);
        console.log("gas buyFor native:", g - gasleft());

        assertGt(IERC20(ethToken).balanceOf(buyer), 0, "tokens land on the buyer");
        assertEq(solver.balance, 100e18 - 1e18, "the delivery was spent in full");
        assertEq(refund.balance, 0, "nothing to refund");
        assertEq(pv.pending(address(0), ref2), REF_SHARE_NATIVE, "buyer's referrer credited");
        assertEq(pv.pending(address(0), ref1), REF_SHARE_NATIVE, "creator's referrer credited");
        _assertClean();
    }

    function test_erc20_happyPath() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN); // the bridge delivers first ...
        vm.expectEmit(true, true, true, true, address(pv));
        emit Attributed(address(usd), ref2, address(receiver), REF_SHARE_USD, false);
        vm.expectEmit(true, true, false, false, address(receiver));
        emit Bought(usdToken, buyer, USD_IN, 0, ref2);
        uint256 g = gasleft();
        receiver.buyFor(usdToken, 0, buyer, refund, ref2); // ... then calls
        console.log("gas buyFor erc20:", g - gasleft());
        vm.stopPrank();

        assertGt(IERC20(usdToken).balanceOf(buyer), 0, "tokens land on the buyer");
        assertEq(usd.balanceOf(refund), 0, "nothing to refund");
        assertEq(pv.pending(address(usd), ref2), REF_SHARE_USD, "buyer's referrer credited in USD");
        assertEq(pv.pending(address(usd), ref1), REF_SHARE_USD, "creator's referrer credited in USD");
        _assertClean();
    }

    function test_native_clampedFillReturnsLeftover() public pastSnipeWindow {
        uint256 offer = GRADUATION * 3;
        vm.recordLogs();
        vm.prank(solver);
        receiver.buyFor{value: offer}(ethToken, 0, buyer, refund, address(0));
        (address asset, uint256 amount, bytes memory reason) = _lastRefunded();
        assertEq(asset, address(0));
        assertEq(reason, bytes("clamped fill"));
        assertGt(amount, 0, "part of the offer was not needed");
        assertEq(refund.balance, amount, "leftover went to refundTo, not the solver");
        assertEq(solver.balance, 100e18 - offer);
        assertGt(IERC20(ethToken).balanceOf(buyer), 0);
        _assertClean();
    }

    function test_selfReferralIgnored() public pastSnipeWindow {
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, 0, buyer, refund, buyer);
        assertEq(pv.pending(address(0), buyer), 0, "the buyer cannot refer itself through the receiver");
        assertEq(pv.pending(address(0), ref1), REF_SHARE_NATIVE, "launcher share unaffected");
    }

    function test_erc20_ethSentAlongIsReturned() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, true, true, address(receiver));
        emit Refunded(usdToken, refund, address(0), 0.5e18, bytes("value with erc20 quote"));
        receiver.buyFor{value: 0.5e18}(usdToken, 0, buyer, refund, address(0));
        vm.stopPrank();
        assertEq(refund.balance, 0.5e18);
        assertGt(IERC20(usdToken).balanceOf(buyer), 0, "the USD buy still went through");
        _assertClean();
    }

    // ---- failures refund instead of reverting ----

    function test_native_slippageRefunds() public pastSnipeWindow {
        vm.recordLogs();
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, TOO_MANY, buyer, refund, ref2);
        (address asset, uint256 amount, bytes memory reason) = _lastRefunded();
        assertEq(asset, address(0));
        assertEq(amount, 1e18);
        assertEq(bytes4(reason), PonsV2BondingCurve.SlippageExceeded.selector, "the curve's revert is the reason");
        assertEq(refund.balance, 1e18, "the whole delivery went to refundTo");
        assertEq(IERC20(ethToken).balanceOf(buyer), 0);
        assertEq(pv.pending(address(0), ref2), 0, "no attribution on a failed buy");
        _assertClean();
    }

    function test_erc20_slippageRefunds() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.recordLogs();
        receiver.buyFor(usdToken, TOO_MANY, buyer, refund, ref2);
        vm.stopPrank();
        (address asset, uint256 amount, bytes memory reason) = _lastRefunded();
        assertEq(asset, address(usd));
        assertEq(amount, USD_IN);
        assertEq(bytes4(reason), PonsV2BondingCurve.SlippageExceeded.selector);
        assertEq(usd.balanceOf(refund), USD_IN);
        assertEq(IERC20(usdToken).balanceOf(buyer), 0);
        _assertClean();
    }

    function test_unknownToken_nativeRefunds() public pastSnipeWindow {
        vm.expectEmit(true, true, true, true, address(receiver));
        emit Refunded(nope, refund, address(0), 1e18, bytes("unknown token"));
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(nope, 0, buyer, refund, ref2);
        assertEq(refund.balance, 1e18);
        _assertClean();
    }

    function test_unknownToken_erc20Reverts() public pastSnipeWindow {
        // The receiver cannot tell which asset arrived for a token it does not
        // know, so a no-op would strand it: the call reverts and the delivering
        // router's own failure path applies.
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectRevert(CrossBuyReceiver.UnknownToken.selector);
        receiver.buyFor(nope, 0, buyer, refund, ref2);
        vm.stopPrank();
    }

    function test_zeroRecipientReverts() public pastSnipeWindow {
        vm.prank(solver);
        vm.expectRevert(CrossBuyReceiver.ZeroRecipient.selector);
        receiver.buyFor{value: 1e18}(ethToken, 0, address(0), refund, ref2);
        assertEq(solver.balance, 100e18, "a revert never takes the ETH");
    }

    function test_nothingDeliveredReverts() public pastSnipeWindow {
        vm.startPrank(solver);
        vm.expectRevert(CrossBuyReceiver.NothingDelivered.selector);
        receiver.buyFor(usdToken, 0, buyer, refund, ref2);
        vm.expectRevert(CrossBuyReceiver.NothingDelivered.selector);
        receiver.buyFor{value: 0}(ethToken, 0, buyer, refund, ref2);
        vm.stopPrank();
    }

    function test_refundToDefaultsToRecipient() public pastSnipeWindow {
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, TOO_MANY, buyer, address(0), ref2);
        assertEq(buyer.balance, 1e18, "refund went to the recipient");
    }

    // ---- reentrancy and the parking ledger ----

    function test_reentrancyFromRefundIsBlocked() public pastSnipeWindow {
        Reenterer r = new Reenterer(receiver, ethToken);
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, TOO_MANY, buyer, address(r), address(0));
        assertTrue(r.tried(), "the callback ran");
        assertFalse(r.reentered(), "the nested buyFor was rejected");
        assertEq(address(r).balance, 1e18, "the refund itself was delivered");
        _assertClean();
    }

    function test_rejectedRefundIsParkedAndOnlyReleasableToItsRefundTo() public pastSnipeWindow {
        Rejecter r = new Rejecter();
        vm.expectEmit(true, true, false, false, address(receiver));
        emit Parked(address(r), address(0), 1e18, "");
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, TOO_MANY, buyer, address(r), address(0));
        assertEq(receiver.owed(address(0), address(r)), 1e18, "parked for its refundTo");
        assertEq(receiver.totalOwed(address(0)), 1e18);
        assertEq(address(receiver).balance, 1e18);

        // A later call moves only its own delivery: the parked ETH is invisible to it.
        address other = makeAddr("other");
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, 0, other, other, address(0));
        assertGt(IERC20(ethToken).balanceOf(other), 0);
        assertEq(address(receiver).balance, 1e18, "the parked ETH was not spent");
        vm.prank(solver);
        receiver.buyFor{value: 1e18}(ethToken, TOO_MANY, other, other, address(0));
        assertEq(other.balance, 1e18, "a later refund does not sweep the parked ETH");
        assertEq(address(receiver).balance, 1e18);

        // Nobody else can release it, and it can only go to the recorded refundTo.
        vm.prank(other);
        assertEq(receiver.release(address(0), other), 0, "nothing owed to a stranger");
        assertEq(address(receiver).balance, 1e18);
        vm.expectRevert(CrossBuyReceiver.ReleaseFailed.selector);
        receiver.release(address(0), address(r)); // still rejecting: the record stays
        assertEq(receiver.owed(address(0), address(r)), 1e18);

        r.setAccept(true);
        vm.prank(other); // permissionless, destination fixed
        assertEq(receiver.release(address(0), address(r)), 1e18);
        assertEq(address(r).balance, 1e18);
        assertEq(receiver.owed(address(0), address(r)), 0);
        assertEq(receiver.totalOwed(address(0)), 0);
        _assertClean();
    }

    function test_orphanTransferBecomesTheNextDelivery() public pastSnipeWindow {
        // Documented limitation: tokens that arrive without a call in the same
        // transaction are unattributable; the next buyFor of that quote asset
        // treats them as its delivery (and they go to that call's outcome).
        vm.prank(solver);
        usd.transfer(address(receiver), 100e6);
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, false, false, address(receiver));
        emit Bought(usdToken, buyer, USD_IN + 100e6, 0, address(0));
        receiver.buyFor(usdToken, 0, buyer, refund, address(0));
        vm.stopPrank();
        _assertClean();
    }

    // ---- Across V3 adapter ----

    function _acrossMsg(address token, uint256 minOut, address rcpt, address rf, address referrer) internal pure returns (bytes memory) {
        return abi.encode(token, minOut, rcpt, rf, referrer);
    }

    function test_across_erc20_happyPath() public pastSnipeWindow {
        vm.startPrank(solver); // plays the SpokePool
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, false, false, address(receiver));
        emit Bought(usdToken, buyer, USD_IN, 0, ref2);
        uint256 g = gasleft();
        receiver.handleV3AcrossMessage(address(usd), USD_IN, solver, _acrossMsg(usdToken, 0, buyer, refund, ref2));
        console.log("gas handleV3AcrossMessage erc20:", g - gasleft());
        vm.stopPrank();
        assertGt(IERC20(usdToken).balanceOf(buyer), 0);
        assertEq(pv.pending(address(usd), ref2), REF_SHARE_USD);
        _assertClean();
    }

    function test_across_wrongAssetRefundsExactly() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, true, true, address(receiver));
        emit Refunded(ethToken, refund, address(usd), USD_IN, bytes("not the quote asset"));
        receiver.handleV3AcrossMessage(address(usd), USD_IN, solver, _acrossMsg(ethToken, 0, buyer, refund, ref2));
        vm.stopPrank();
        assertEq(usd.balanceOf(refund), USD_IN);
        _assertClean();
    }

    function test_across_unknownTokenRefundsExactly() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, true, true, address(receiver));
        emit Refunded(nope, refund, address(usd), USD_IN, bytes("unknown token"));
        receiver.handleV3AcrossMessage(address(usd), USD_IN, solver, _acrossMsg(nope, 0, buyer, refund, ref2));
        vm.stopPrank();
        assertEq(usd.balanceOf(refund), USD_IN);
        _assertClean();
    }

    function test_across_amountCappedByDelivery() public pastSnipeWindow {
        vm.startPrank(solver);
        usd.transfer(address(receiver), USD_IN);
        vm.expectEmit(true, true, true, true, address(receiver));
        emit Refunded(nope, refund, address(usd), USD_IN, bytes("unknown token"));
        receiver.handleV3AcrossMessage(address(usd), USD_IN * 10, solver, _acrossMsg(nope, 0, buyer, refund, ref2));
        vm.stopPrank();
        assertEq(usd.balanceOf(refund), USD_IN, "never more than what is here");
    }

    // ---- views ----

    function test_quoteAssetOf() public view {
        (bool known, address asset) = receiver.quoteAssetOf(ethToken);
        assertTrue(known);
        assertEq(asset, address(0));
        (known, asset) = receiver.quoteAssetOf(usdToken);
        assertTrue(known);
        assertEq(asset, address(usd));
        (known,) = receiver.quoteAssetOf(nope);
        assertFalse(known);
        assertEq(address(receiver.factory()), address(factory));
        assertEq(address(receiver.router()), address(router));
    }
}
