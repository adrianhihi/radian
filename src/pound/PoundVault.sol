// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPoundEscrow {
    function claim() external returns (uint256 amount);
    function claimToken(address token) external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
}

interface IPackBurnerDeposit {
    function deposit(address asset, uint256 amount) external payable;
}

/// @title PoundVault
/// @notice The Pound's protocol-fee recipient. The hook credits the protocol
///         share of every curve trade to this vault (through the fee escrow);
///         launch fees land here directly. `settle` pulls the balance and runs
///         the waterfall for one asset:
///           1. referral accruals the router attributed (buyer's referrer and
///              the creator's referrer, REFERRAL_BPS / LAUNCHER_BPS of the fee)
///              are funded first and pulled by their owners;
///           2. `burnShareBps` of what remains goes to the PackBurner, which
///              buys and burns the rotating Pack of existing coins;
///           3. the rest goes to the treasury.
///         There is no platform token: fees buy and burn other people's coins.
///         Two-step ownership (a Safe), not renounceable. Assets only ever move
///         to referrers, the burner and the treasury.
contract PoundVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant REFERRAL_BPS = 555; // of the trade fee, to whoever brought the buyer
    uint256 public constant LAUNCHER_BPS = 555; // of the trade fee, to whoever brought the creator
    uint16 public constant MIN_BURN_SHARE_BPS = 5_000;
    uint256 private constant BPS = 10_000;

    IPoundEscrow public immutable escrow;
    address public router; // the only attribution source
    address public burner; // PackBurner
    address public treasury;
    uint16 public burnShareBps = 7_000; // of the post-referral remainder

    // referral accruals, per asset (address(0) = the gas coin)
    mapping(address asset => mapping(address referrer => uint256)) public pending;
    mapping(address asset => uint256) public totalPending;
    mapping(address asset => uint256) public reserve; // the funded part of totalPending

    mapping(address asset => uint256) public totalReferrals;
    mapping(address asset => uint256) public totalBurned; // sent to the burner
    mapping(address asset => uint256) public totalTreasury;

    uint256 private _lock = 1;

    event Attributed(address indexed asset, address indexed referrer, address indexed user, uint256 amount, bool launcher);
    event ReferralClaimed(address indexed asset, address indexed referrer, uint256 amount);
    event Settled(address indexed asset, uint256 intake, uint256 toReferrals, uint256 toBurn, uint256 toTreasury);
    event RouterSet(address router);
    event BurnerSet(address burner);
    event TreasurySet(address treasury);
    event BurnShareSet(uint16 bps);

    error NotRouter();
    error Zero();

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address escrow_, address treasury_, address owner_) Ownable(owner_) {
        if (escrow_ == address(0) || treasury_ == address(0)) revert Zero();
        escrow = IPoundEscrow(escrow_);
        treasury = treasury_;
    }

    receive() external payable {} // launch fees (hook pays the recipient directly) and escrow native claims

    // ---- attribution (router only) ----

    /// @notice Credit the referral shares of a trade fee. `referrer` brought the
    ///         buyer, `launcherRef` brought the token's creator. Self-referrals
    ///         are ignored. Accruals are paid from this vault's intake in
    ///         `settle`, so they can never exceed what the protocol earned.
    function attribute(address asset, address user, address referrer, address launcherRef, uint256 fee) external {
        if (msg.sender != router) revert NotRouter();
        if (fee == 0) return;
        if (referrer != address(0) && referrer != user) _credit(asset, referrer, user, (fee * REFERRAL_BPS) / BPS, false);
        if (launcherRef != address(0) && launcherRef != user) _credit(asset, launcherRef, user, (fee * LAUNCHER_BPS) / BPS, true);
    }

    function _credit(address asset, address to, address user, uint256 amount, bool launcher) private {
        if (amount == 0) return;
        pending[asset][to] += amount;
        totalPending[asset] += amount;
        emit Attributed(asset, to, user, amount, launcher);
    }

    // ---- the waterfall ----

    /// @notice Pull this vault's balance of `asset` out of the escrow and run the
    ///         waterfall. Permissionless: every destination is fixed.
    function settle(address asset) external nonReentrant returns (uint256 intake, uint256 toReferrals, uint256 toBurn, uint256 toTreasury) {
        if (asset == address(0)) {
            if (escrow.balanceOf(address(this)) > 0) escrow.claim();
        } else {
            if (escrow.balanceOfToken(address(this), asset) > 0) escrow.claimToken(asset);
        }
        uint256 balance = _balance(asset);
        uint256 available = balance - reserve[asset]; // reserve is always funded from balance
        intake = available;
        uint256 need = totalPending[asset] - reserve[asset];
        toReferrals = need < available ? need : available;
        reserve[asset] += toReferrals;
        available -= toReferrals;
        toBurn = burner == address(0) ? 0 : (available * burnShareBps) / BPS;
        toTreasury = available - toBurn;
        if (toBurn > 0) {
            totalBurned[asset] += toBurn;
            if (asset == address(0)) {
                IPackBurnerDeposit(burner).deposit{value: toBurn}(asset, toBurn);
            } else {
                IERC20(asset).forceApprove(burner, toBurn);
                IPackBurnerDeposit(burner).deposit(asset, toBurn);
                IERC20(asset).forceApprove(burner, 0);
            }
        }
        if (toTreasury > 0) {
            totalTreasury[asset] += toTreasury;
            _send(asset, treasury, toTreasury);
        }
        emit Settled(asset, intake, toReferrals, toBurn, toTreasury);
    }

    /// @notice Pull your funded referral accruals of `asset`.
    function claimReferral(address asset) external nonReentrant returns (uint256 amount) {
        uint256 p = pending[asset][msg.sender];
        uint256 r = reserve[asset];
        amount = p < r ? p : r;
        if (amount == 0) return 0;
        pending[asset][msg.sender] = p - amount;
        totalPending[asset] -= amount;
        reserve[asset] = r - amount;
        totalReferrals[asset] += amount;
        _send(asset, msg.sender, amount);
        emit ReferralClaimed(asset, msg.sender, amount);
    }

    /// @notice What `referrer` could pull right now (funded) and in total (accrued).
    function referralOf(address asset, address referrer) external view returns (uint256 claimable, uint256 accrued) {
        accrued = pending[asset][referrer];
        uint256 r = reserve[asset];
        claimable = accrued < r ? accrued : r;
    }

    // ---- admin ----

    function setRouter(address r) external onlyOwner {
        router = r;
        emit RouterSet(r);
    }

    function setBurner(address b) external onlyOwner {
        burner = b;
        emit BurnerSet(b);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert Zero();
        treasury = t;
        emit TreasurySet(t);
    }

    function setBurnShare(uint16 bps) external onlyOwner {
        require(bps >= MIN_BURN_SHARE_BPS && bps <= BPS, "range");
        burnShareBps = bps;
        emit BurnShareSet(bps);
    }

    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    // ---- internals ----

    function _balance(address asset) private view returns (uint256) {
        return asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
    }

    function _send(address asset, address to, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "send failed");
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }
}
