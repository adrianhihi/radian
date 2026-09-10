// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RadianStaking} from "../src/radian/RadianStaking.sol";
import {RadianTreasury} from "../src/radian/RadianTreasury.sol";

// Minimal ERC20 with burn, mirroring the launcher token surface the flywheel needs.
contract MockRadian {
    string public name = "Radian";
    string public symbol = "RADIAN";
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

// Mock bonding curve: holds a RADIAN reserve (like a real curve) and buy()
// transfers 1:1 from that reserve to the buyer — no minting, so a later burn
// genuinely reduces total supply.
contract MockCurve {
    MockRadian public radian;
    bool public graduated;

    constructor(MockRadian r) {
        radian = r;
        r.mint(address(this), 1_000_000_000e18); // curve reserve
    }

    function setGraduated(bool g) external {
        graduated = g;
    }

    function buy(uint256 quoteIn, uint256, address recipient) external payable returns (uint256) {
        require(msg.value == quoteIn, "value");
        radian.transfer(recipient, quoteIn); // 1 USDC -> 1 RADIAN from reserve
        return quoteIn;
    }
}

contract RadianFlywheelTest is Test {
    MockRadian radian;
    MockCurve curve;
    RadianStaking staking;
    RadianTreasury treasury;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        radian = new MockRadian();
        curve = new MockCurve(radian);
        vm.prank(owner);
        staking = new RadianStaking(address(radian), owner);
        vm.prank(owner);
        treasury = new RadianTreasury(address(radian), address(curve), owner);

        vm.startPrank(owner);
        treasury.setStaking(address(staking));
        staking.setRewardsDistributor(address(treasury));
        vm.stopPrank();

        radian.mint(alice, 1_000e18);
        radian.mint(bob, 1_000e18);
    }

    function _stake(address who, uint256 amt) internal {
        vm.startPrank(who);
        radian.approve(address(staking), amt);
        staking.stake(amt);
        vm.stopPrank();
    }

    function test_stakingRealYieldSplitByStake() public {
        _stake(alice, 300e18);
        _stake(bob, 100e18); // 3:1

        // fund a reward period directly (as owner/distributor)
        vm.deal(owner, 8e18);
        vm.prank(owner);
        staking.notifyReward{value: 8e18}();

        vm.warp(block.timestamp + 7 days); // full period

        uint256 aliceEarned = staking.earned(alice);
        uint256 bobEarned = staking.earned(bob);
        // ~3:1 split of ~8 USDC (minus rounding from rate = reward/DURATION)
        assertApproxEqRel(aliceEarned, 6e18, 0.01e18);
        assertApproxEqRel(bobEarned, 2e18, 0.01e18);

        uint256 balBefore = alice.balance;
        vm.prank(alice);
        staking.getReward();
        assertApproxEqRel(alice.balance - balBefore, 6e18, 0.01e18);
    }

    function test_treasuryFlushBuysBackBurnsAndFundsStakers() public {
        _stake(alice, 100e18);

        // simulate accrued protocol fees arriving at the treasury
        vm.deal(address(this), 10e18);
        (bool ok,) = address(treasury).call{value: 10e18}("");
        assertTrue(ok);

        uint256 supplyBefore = radian.totalSupply();

        vm.prank(owner);
        (uint256 burned, uint256 toStakers) = treasury.flush(0);

        // 50/50: 5 USDC buys 5 RADIAN which is burned; 5 USDC funds staking
        assertEq(burned, 5e18);
        assertEq(toStakers, 5e18);
        assertEq(radian.totalSupply(), supplyBefore - 5e18, "supply burned");
        assertEq(treasury.totalBurned(), 5e18);
        assertEq(treasury.totalToStakers(), 5e18);
        assertEq(address(staking).balance, 5e18, "staking funded in USDC");

        // alice actually earns the streamed USDC
        vm.warp(block.timestamp + 7 days);
        assertApproxEqRel(staking.earned(alice), 5e18, 0.01e18);
    }

    function test_graduatedCurveRoutesAllToStakers() public {
        _stake(alice, 100e18);
        curve.setGraduated(true);
        vm.deal(address(this), 4e18);
        (bool ok,) = address(treasury).call{value: 4e18}("");
        assertTrue(ok);

        vm.prank(owner);
        (uint256 burned, uint256 toStakers) = treasury.flush(0);
        assertEq(burned, 0);
        assertEq(toStakers, 4e18); // all to stakers, no buyback venue
    }

    function test_onlyDistributorOrOwnerNotifies() public {
        vm.deal(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert("not distributor");
        staking.notifyReward{value: 1e18}();
    }

    function test_withdrawAndExit() public {
        _stake(alice, 500e18);
        vm.deal(owner, 7e18);
        vm.prank(owner);
        staking.notifyReward{value: 7e18}();
        vm.warp(block.timestamp + 7 days);

        uint256 tokBefore = radian.balanceOf(alice);
        uint256 ethBefore = alice.balance;
        vm.prank(alice);
        staking.exit(); // withdraw all + claim
        assertEq(radian.balanceOf(alice) - tokBefore, 500e18);
        assertApproxEqRel(alice.balance - ethBefore, 7e18, 0.01e18);
        assertEq(staking.totalStaked(), 0);
    }
}
