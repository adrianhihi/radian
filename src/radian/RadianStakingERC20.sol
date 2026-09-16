// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RadianStakingERC20
/// @notice Stake $RADIAN, earn an ERC-20 dollar (USDG, USDC…) — the flywheel for
///         chains whose gas coin is not a dollar (Robinhood Chain pays gas in
///         ETH). Same Synthetix accounting and the same user surface as the
///         native-USDC `RadianStaking` on Arc: stake / withdraw / getReward /
///         exit / stakedOf / earned. Rewards can never exceed what the treasury
///         actually deposits: real revenue, not emission.
/// @dev Two-step ownership, cannot be renounced (an ownerless pool could never
///      re-point its distributor). Rewards streamed while nobody is staked are
///      not recoverable (Synthetix semantics): fund the first period only once
///      someone has staked.
contract RadianStakingERC20 is Ownable2Step {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken; // $RADIAN
    IERC20 public immutable rewardToken; // the chain's dollar ERC-20
    address public rewardsDistributor; // RadianTreasuryERC20

    uint256 public constant DURATION = 7 days;
    uint256 public periodFinish;
    uint256 public rewardRate; // reward units per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    uint256 public totalStaked;
    mapping(address => uint256) public stakedOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    uint256 public totalDistributed; // lifetime reward deposited

    uint256 private _lock = 1;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount);
    event DistributorSet(address distributor);

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    constructor(address stakingToken_, address rewardToken_, address owner_) Ownable(owner_) {
        require(stakingToken_ != address(0) && rewardToken_ != address(0), "zero");
        require(stakingToken_ != rewardToken_, "same token");
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
    }

    function setRewardsDistributor(address d) external onlyOwner {
        rewardsDistributor = d;
        emit DistributorSet(d);
    }

    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    // ---- views ----

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (stakedOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18 + rewards[account];
    }

    /// @notice Annualized reward per staked token (1e18 scaled, in reward units).
    function rewardRatePerYear() external view returns (uint256) {
        if (totalStaked == 0) return 0;
        return (rewardRate * 365 days * 1e18) / totalStaked;
    }

    // ---- actions ----

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "zero");
        totalStaked += amount;
        stakedOf[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) public nonReentrant updateReward(msg.sender) {
        require(amount > 0 && stakedOf[msg.sender] >= amount, "bad amount");
        totalStaked -= amount;
        stakedOf[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getReward() public nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward == 0) return;
        rewards[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    /// @notice Withdraw everything and claim. Safe with nothing staked.
    function exit() external {
        uint256 staked = stakedOf[msg.sender];
        if (staked > 0) withdraw(staked);
        getReward();
    }

    /// @notice Fund a new reward period; `amount` is pulled from the caller
    ///         (approve first). Only the distributor or the owner. Streams over DURATION.
    function notifyReward(uint256 amount) external nonReentrant updateReward(address(0)) {
        require(msg.sender == rewardsDistributor || msg.sender == owner(), "not distributor");
        require(amount > 0, "zero reward");
        uint256 before = rewardToken.balanceOf(address(this));
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 reward = rewardToken.balanceOf(address(this)) - before; // fee-on-transfer safe
        if (block.timestamp >= periodFinish) {
            rewardRate = reward / DURATION;
        } else {
            uint256 leftover = (periodFinish - block.timestamp) * rewardRate;
            rewardRate = (reward + leftover) / DURATION;
        }
        require(rewardRate > 0, "reward too small");
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + DURATION;
        totalDistributed += reward;
        emit RewardAdded(reward);
    }
}
