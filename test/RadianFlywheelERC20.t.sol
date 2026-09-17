// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RadianStakingERC20} from "../src/radian/RadianStakingERC20.sol";
import {RadianTreasuryERC20} from "../src/radian/RadianTreasuryERC20.sol";

contract MockTokenQ {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }

    function burn(uint256 v) external {
        balanceOf[msg.sender] -= v;
        totalSupply -= v;
    }
}

// ERC-20-quoted curve: buy() pulls the quote and pays RADIAN 1:1 from its reserve.
contract MockCurveQ {
    MockTokenQ public radian;
    MockTokenQ public quoteToken;
    bool public graduated;
    uint256 public quoteReserve = 1_000e6;
    uint256 public feeBps = 100;
    uint256 public creatorTaxBps = 0;
    uint256 public shortOut; // when set, buy returns this many tokens instead of the fair amount (floor tests)

    constructor(MockTokenQ r, MockTokenQ q) {
        radian = r;
        quoteToken = q;
        r.mint(address(this), 1_000_000_000e18);
    }

    function pairToken() external view returns (address) {
        return address(quoteToken);
    }

    function setGraduated(bool g) external {
        graduated = g;
    }

    function setQuoteReserve(uint256 q) external {
        quoteReserve = q;
    }

    function setShortOut(uint256 o) external {
        shortOut = o;
    }

    /// @dev simulate a trader moving the price: quote in, tokens out of the reserve
    function pump(uint256 quoteIn) external {
        uint256 t = radian.balanceOf(address(this));
        uint256 out = (t * quoteIn) / (quoteReserve + quoteIn);
        quoteReserve += quoteIn;
        radian.transfer(msg.sender, out);
    }

    function sellableTokens() external view returns (uint256) {
        return graduated ? 0 : radian.balanceOf(address(this));
    }

    function getReserves() external view returns (uint256, uint256) {
        return (quoteReserve, radian.balanceOf(address(this)));
    }

    /// @dev constant product on (quoteReserve, token balance) after a 1% fee, like the real curve
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256) {
        require(msg.value == 0, "no value");
        require(quoteToken.transferFrom(msg.sender, address(this), quoteIn), "pull");
        uint256 net = (quoteIn * (10_000 - feeBps - creatorTaxBps)) / 10_000;
        uint256 t = radian.balanceOf(address(this));
        uint256 out = shortOut > 0 ? shortOut : (t * net) / (quoteReserve + net);
        require(out >= minTokensOut, "slippage");
        quoteReserve += net;
        radian.transfer(recipient, out);
        return out;
    }
}

contract MockEscrowQ {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public balanceOfToken;

    function credit(address recipient) external payable {
        balanceOf[recipient] += msg.value;
    }

    function creditToken(address recipient, address token, uint256 amount) external {
        balanceOfToken[recipient][token] += amount;
    }

    function claim() external returns (uint256 amount) {
        amount = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send");
    }

    function claimToken(address token) external returns (uint256 amount) {
        amount = balanceOfToken[msg.sender][token];
        require(amount > 0, "NoBalance");
        balanceOfToken[msg.sender][token] = 0;
        MockTokenQ(token).transfer(msg.sender, amount);
    }
}

contract RadianFlywheelERC20Test is Test {
    MockTokenQ radian;
    MockTokenQ usd; // 6-dec dollar
    MockTokenQ other; // some stock quote
    MockCurveQ curve;
    MockEscrowQ escrow;
    RadianStakingERC20 staking;
    RadianTreasuryERC20 treasury;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        radian = new MockTokenQ("Radian", "RADIAN", 18);
        usd = new MockTokenQ("Dollar", "USDGx", 6);
        other = new MockTokenQ("Stock", "NVDAx", 18);
        curve = new MockCurveQ(radian, usd);
        escrow = new MockEscrowQ();
        staking = new RadianStakingERC20(address(radian), address(usd), owner);
        treasury = new RadianTreasuryERC20(address(radian), address(curve), address(escrow), address(usd), owner);
        vm.startPrank(owner);
        staking.setRewardsDistributor(address(treasury));
        treasury.setStaking(address(staking));
        treasury.setKeeper(keeper);
        vm.stopPrank();
        radian.mint(alice, 1_000e18);
        radian.mint(bob, 1_000e18);
        vm.warp(1_700_000_000);
    }


    /// @dev what the mock curve pays for `quoteIn` at reserves (q, t) after its 1% fee
    function _cpOut(uint256 quoteIn, uint256 q, uint256 t) internal pure returns (uint256) {
        uint256 net = (quoteIn * 9_900) / 10_000;
        return (t * net) / (q + net);
    }

    function _stake(address who, uint256 amt) internal {
        vm.startPrank(who);
        radian.approve(address(staking), amt);
        staking.stake(amt);
        vm.stopPrank();
    }

    function _fund(uint256 amt) internal {
        usd.mint(address(escrow), amt);
        escrow.creditToken(address(treasury), address(usd), amt);
    }

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    // ---- staking ----

    function test_stakingRealYieldSplitByStake() public {
        _stake(alice, 300e18);
        _stake(bob, 100e18);
        usd.mint(owner, 400e6);
        vm.startPrank(owner);
        usd.approve(address(staking), 400e6);
        staking.notifyReward(400e6);
        vm.stopPrank();
        vm.warp(_now() + 7 days);
        vm.prank(alice);
        staking.getReward();
        vm.prank(bob);
        staking.getReward();
        assertApproxEqRel(usd.balanceOf(alice), 300e6, 0.001e18, "alice 3/4 (integer streaming dust)");
        assertApproxEqRel(usd.balanceOf(bob), 100e6, 0.001e18, "bob 1/4");
        assertEq(staking.totalDistributed(), 400e6);
    }

    function test_stakingSecondNotifyMidPeriodRollsLeftover() public {
        _stake(alice, 100e18);
        usd.mint(owner, 1_400e6);
        vm.startPrank(owner);
        usd.approve(address(staking), 1_400e6);
        staking.notifyReward(700e6);
        vm.warp(_now() + 3 days + 12 hours); // half streamed
        staking.notifyReward(700e6); // 350 leftover + 700 over a fresh 7 days
        vm.stopPrank();
        assertApproxEqAbs(staking.rewardRate(), (uint256(1_050e6) * 1e18) / 7 days, 1e18);
        vm.warp(_now() + 7 days);
        vm.prank(alice);
        staking.getReward();
        assertApproxEqRel(usd.balanceOf(alice), 1_400e6, 0.001e18);
    }

    function test_onlyDistributorOrOwnerNotifies() public {
        usd.mint(alice, 1e6);
        vm.startPrank(alice);
        usd.approve(address(staking), 1e6);
        vm.expectRevert(bytes("not distributor"));
        staking.notifyReward(1e6);
        vm.stopPrank();
    }

    function test_withdrawAndExit() public {
        _stake(alice, 100e18);
        vm.prank(alice);
        staking.withdraw(40e18);
        assertEq(staking.stakedOf(alice), 60e18);
        assertEq(radian.balanceOf(alice), 940e18);
        vm.prank(alice);
        staking.exit();
        assertEq(staking.stakedOf(alice), 0);
        assertEq(radian.balanceOf(alice), 1_000e18);
        vm.prank(bob);
        staking.exit(); // nothing staked: still fine
    }

    function test_stakingTwoStepOwnership() public {
        vm.prank(owner);
        staking.transferOwnership(bob);
        assertEq(staking.owner(), owner);
        vm.prank(bob);
        staking.acceptOwnership();
        assertEq(staking.owner(), bob);
        vm.prank(bob);
        vm.expectRevert(bytes("renounce disabled"));
        staking.renounceOwnership();
    }

    // ---- treasury ----

    function test_treasuryFlushBuysBackBurnsAndFundsStakers() public {
        _stake(alice, 100e18);
        _fund(100e6);
        assertEq(treasury.claimableFees(), 100e6);
        treasury.claimFees();
        assertEq(usd.balanceOf(address(treasury)), 100e6);
        uint256 supply = radian.totalSupply();
        (uint256 q0, uint256 t0) = curve.getReserves();
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertEq(burned, _cpOut(50e6, q0, t0), "50 USD bought at the curve price and burned");
        assertEq(radian.totalSupply(), supply - burned);
        assertEq(toStakers, 50e6);
        assertEq(usd.balanceOf(address(staking)), 50e6);
        assertGt(staking.rewardRate(), 0);
        assertEq(usd.balanceOf(address(treasury)), 0);
        assertEq(treasury.totalBurned(), burned);
        assertEq(treasury.totalToStakers(), 50e6);
        assertEq(treasury.totalFlushed(), 100e6);
        assertEq(usd.allowance(address(treasury), address(curve)), 0, "approvals cleared");
    }

    function test_claimFeesIsSafeWhenEmpty() public {
        assertEq(treasury.claimFees(), 0, "nothing to claim: no revert");
        _fund(5e6);
        assertEq(treasury.claimFees(), 5e6);
    }

    function test_claimOtherFeesAndRescue() public {
        other.mint(address(escrow), 3e18);
        escrow.creditToken(address(treasury), address(other), 3e18);
        assertEq(treasury.claimTokenFees(address(other)), 3e18);
        vm.prank(owner);
        vm.expectRevert(bytes("use claimFees"));
        treasury.claimTokenFees(address(usd));
        vm.prank(owner);
        treasury.rescueERC20(address(other), bob, 3e18);
        assertEq(other.balanceOf(bob), 3e18);
        _fund(1e6);
        treasury.claimFees();
        vm.prank(owner);
        vm.expectRevert(bytes("quote only leaves via flush"));
        treasury.rescueERC20(address(usd), bob, 1e6);
        vm.prank(owner);
        vm.expectRevert(bytes("radian is burn-only"));
        treasury.rescueERC20(address(radian), bob, 1);
        // gas-coin fees: claimable and routable by the owner
        vm.deal(address(escrow), 1 ether);
        escrow.credit{value: 0}(address(treasury));
        vm.deal(address(this), 1 ether);
        escrow.credit{value: 1 ether}(address(treasury));
        assertEq(treasury.claimNativeFees(), 1 ether);
        vm.prank(owner);
        treasury.rescueNative(bob, 1 ether);
        assertEq(bob.balance, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        treasury.rescueNative(alice, 1);
    }

    function test_flushRequiresQuoteAndDeadline() public {
        _stake(alice, 1e18);
        _fund(10e6);
        treasury.claimFees();
        vm.prank(keeper);
        vm.expectRevert(bytes("quote required"));
        treasury.flush(0, _now() + 60);
        vm.prank(keeper);
        vm.expectRevert(bytes("expired"));
        treasury.flush(1, _now() - 1);
    }

    function test_flushCapsBuybackToReserveShare() public {
        _stake(alice, 1e18);
        _fund(100e6);
        treasury.claimFees();
        curve.setQuoteReserve(100e6); // cap = 5% = 5 USD (live reserve below the reference: price fell, allowed)
        (, uint256 t0) = curve.getReserves();
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertEq(burned, _cpOut(5e6, 100e6, t0), "buy capped at 5% of the reserve");
        assertEq(toStakers, 50e6);
        assertEq(usd.balanceOf(address(treasury)), 45e6, "excess waits for a later flush");
    }

    function test_flushRateLimited() public {
        _stake(alice, 1e18);
        _fund(10e6);
        treasury.claimFees();
        vm.prank(keeper);
        treasury.flush(1, _now() + 60);
        _fund(10e6);
        treasury.claimFees();
        vm.prank(keeper);
        vm.expectRevert(bytes("too soon"));
        treasury.flush(1, _now() + 60);
        vm.warp(_now() + 1 hours);
        vm.prank(keeper);
        treasury.flush(1, _now() + 60);
    }

    function test_flushOnlyOwnerOrKeeper() public {
        _fund(10e6);
        treasury.claimFees();
        vm.prank(alice);
        vm.expectRevert(bytes("not keeper"));
        treasury.flush(1, _now() + 60);
    }

    function test_graduatedCurveRoutesAllToStakers() public {
        _stake(alice, 1e18);
        _fund(10e6);
        treasury.claimFees();
        curve.setGraduated(true);
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(0, _now() + 60);
        assertEq(burned, 0);
        assertEq(toStakers, 10e6);
    }

    function test_setStakingValidatesTokens() public {
        RadianStakingERC20 wrongStake = new RadianStakingERC20(address(other), address(usd), owner);
        RadianStakingERC20 wrongReward = new RadianStakingERC20(address(radian), address(other), owner);
        vm.startPrank(owner);
        vm.expectRevert(bytes("wrong staking token"));
        treasury.setStaking(address(wrongStake));
        vm.expectRevert(bytes("wrong reward token"));
        treasury.setStaking(address(wrongReward));
        vm.stopPrank();
    }

    function test_constructorRejectsCurveNotPricedInQuote() public {
        vm.expectRevert(bytes("curve not priced in quote"));
        new RadianTreasuryERC20(address(radian), address(curve), address(escrow), address(other), owner);
    }

    function test_treasuryTwoStepOwnership() public {
        vm.prank(owner);
        treasury.transferOwnership(bob);
        assertEq(treasury.owner(), owner);
        vm.prank(bob);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), bob);
        vm.prank(bob);
        vm.expectRevert(bytes("renounce disabled"));
        treasury.renounceOwnership();
    }

    receive() external payable {}

    // ---- review 2026-09-17 regressions ----

    /// Critical: 6-dec rewards over an 18-dec stake at a realistic scale must not truncate away.
    function test_precisionAtRealisticScaleWithHourlyNotifiesAndPokes() public {
        radian.mint(alice, 100_000_000e18);
        _stake(alice, 100_000_000e18); // 10% of supply
        address poker = makeAddr("poker"); // never stakes, just touches updateReward
        usd.mint(owner, 10_000e6);
        vm.prank(owner);
        usd.approve(address(staking), 10_000e6);
        uint256 deposited;
        // one week: a 1 USDG notify every hour (the treasury's hourly flush) and a poke every 10 minutes
        for (uint256 h = 0; h < 168; h++) {
            vm.prank(owner);
            staking.notifyReward(1e6);
            deposited += 1e6;
            for (uint256 m = 0; m < 6; m++) {
                vm.warp(vm.getBlockTimestamp() + 10 minutes);
                vm.prank(poker);
                staking.getReward();
            }
        }
        vm.warp(vm.getBlockTimestamp() + 8 days); // let the last period finish
        uint256 e = staking.earned(alice);
        assertGe(e, (deposited * 9_990) / 10_000, "at least 99.9% of the stream reaches the staker");
        assertLe(e, deposited);
        vm.prank(alice);
        staking.getReward();
        assertEq(usd.balanceOf(alice), e);
    }

    function test_notifyRefusesWithoutStakers() public {
        usd.mint(owner, 10e6);
        vm.startPrank(owner);
        usd.approve(address(staking), 10e6);
        vm.expectRevert("no stakers");
        staking.notifyReward(10e6);
        vm.stopPrank();
    }

    /// Medium: the staker share is held in the treasury (not streamed into a void) while nobody is staked.
    function test_flushHoldsStakerShareWithoutStakers() public {
        _fund(100e6);
        treasury.claimFees();
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertGt(burned, 0, "buyback still happens");
        assertEq(toStakers, 0, "nothing streamed");
        assertEq(usd.balanceOf(address(staking)), 0);
        assertEq(usd.balanceOf(address(treasury)), 50e6, "staker share waits in the treasury");
        // once someone stakes, the next flush streams it
        _stake(alice, 1e18);
        vm.warp(_now() + 1 hours);
        vm.prank(keeper);
        (, toStakers) = treasury.flush(1, _now() + 60);
        assertEq(toStakers, 25e6, "half of the held 50 goes to stakers, half to buyback");
    }

    /// High: a price pushed above the reference right before the flush is not bought into.
    function test_flushSkipsBuybackWhenPriceAboveReference() public {
        _stake(alice, 1e18);
        _fund(100e6);
        treasury.claimFees();
        address whale = makeAddr("whale");
        usd.mint(whale, 300e6);
        vm.prank(whale);
        curve.pump(300e6); // price up ~30%: a front-run
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertEq(burned, 0, "no buyback into a pumped price");
        assertEq(toStakers, 50e6, "stakers still paid");
        assertEq(usd.balanceOf(address(treasury)), 50e6, "buyback share held");
        // the reference follows the market after the flush, so a stable price buys next time
        (uint256 q, uint256 t) = curve.getReserves();
        assertEq(treasury.refQuoteReserve(), q);
        assertEq(treasury.refTokenReserve(), t);
        vm.warp(_now() + 1 hours);
        vm.prank(keeper);
        (burned,) = treasury.flush(1, _now() + 60);
        assertGt(burned, 0);
    }

    /// High: whatever the keeper quotes, tokens received below the reference-price floor revert.
    function test_flushRevertsWhenCurvePaysBelowFloor() public {
        _stake(alice, 1e18);
        _fund(100e6);
        treasury.claimFees();
        curve.setShortOut(1); // the curve (or a sandwich) hands back almost nothing
        vm.prank(keeper);
        vm.expectRevert("buyback below floor");
        treasury.flush(1, _now() + 60);
    }

    /// High: the reserve cap uses the smaller of the live and reference reserves, so a front-run cannot enlarge it.
    function test_capCannotBeEnlargedByLiveReserve() public {
        _stake(alice, 1e18);
        _fund(2_000e6);
        treasury.claimFees();
        // same price, both reserves doubled: live cap would be 100 USD, the reference cap is 50 USD
        curve.setQuoteReserve(2_000e6);
        radian.mint(address(curve), 1_000_000_000e18);
        vm.prank(keeper);
        treasury.flush(1, _now() + 60);
        // 2,000 in: 1,000 to stakers, buyback capped at 50 (5% of the 1,000 reference), 950 waits
        assertEq(usd.balanceOf(address(treasury)), 950e6, "buyback capped by the reference reserve");
    }

    function test_setMaxSlippageBounds() public {
        vm.startPrank(owner);
        vm.expectRevert("range");
        treasury.setMaxSlippage(0);
        vm.expectRevert("range");
        treasury.setMaxSlippage(2_001);
        treasury.setMaxSlippage(300);
        vm.stopPrank();
        assertEq(treasury.maxSlippageBps(), 300);
    }
}
