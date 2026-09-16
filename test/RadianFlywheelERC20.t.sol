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

    function getReserves() external view returns (uint256, uint256) {
        return (quoteReserve, radian.balanceOf(address(this)));
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256) {
        require(msg.value == 0, "no value");
        require(quoteToken.transferFrom(msg.sender, address(this), quoteIn), "pull");
        uint256 out = quoteIn * 1e12; // 1 quote unit (6-dec) -> 1 RADIAN (18-dec)
        require(out >= minTokensOut, "slippage");
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
        treasury.setStaking(address(staking));
        treasury.setKeeper(keeper);
        staking.setRewardsDistributor(address(treasury));
        vm.stopPrank();
        radian.mint(alice, 1_000e18);
        radian.mint(bob, 1_000e18);
        vm.warp(1_700_000_000);
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
        assertApproxEqAbs(staking.rewardRate(), uint256(1_050e6) / 7 days, 1);
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
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertEq(burned, 50e6 * 1e12, "50 USD bought 50 RADIAN and burned them");
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
        curve.setQuoteReserve(100e6); // cap = 5% = 5 USD
        vm.prank(keeper);
        (uint256 burned, uint256 toStakers) = treasury.flush(1, _now() + 60);
        assertEq(burned, 5e6 * 1e12, "buy capped at 5% of the reserve");
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
}
