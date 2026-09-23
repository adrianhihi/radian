// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PonsV2LaunchFactory} from "../v2/PonsV2LaunchFactory.sol";
import {IPonsV2LaunchFactory} from "../v2/interfaces/ILaunchpadV2.sol";
import {Clones1167} from "./lib/Clones1167.sol";
import {WallTreasury} from "./wall/WallTreasury.sol";
import {WallStaking} from "./wall/WallStaking.sol";
import {WallLadder} from "./wall/WallLadder.sol";
import {PoFVault} from "./pof/PoFVault.sol";
import {PoFRouter} from "./pof/PoFRouter.sol";

interface IRadianCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
    function feeBps() external view returns (uint256);
}

interface IPoundVaultAttribution {
    function attribute(address asset, address user, address referrer, address launcherRef, uint256 fee) external;
}

/// @title RadianLaunchRouter (v4)
/// @notice The factory's trusted `launchForwarder`, the trade entry point that
///         carries referral tags, and the home of launch templates. Every path
///         is one transaction for the user:
///         - `buy` / `sell`: a curve trade with an optional referrer; the fee's
///           referral shares are attributed to the PoundVault (the buyer's
///           referrer and the creator's referrer, recorded at launch).
///         - `launchAndBuy`: a standard launch plus the creator's opening buy.
///         - `launchWall`: a "stock treasury" launch — creator fees flow to a
///           per-launch WallTreasury (never sold, defends book value on the
///           curve) and a WallStaking pool that pays stakers in the quote asset.
///         - `launchPoF`: a Proof-of-Fee launch — creator fees buy the token
///           back and the buybacks are distributed by round to the traders who
///           paid the fees, through PoFRouter.
///         Launches are attributed to the real user (creator, CREATE2 namespace,
///         snipe-tax exemption); the router holds nothing between calls.
contract RadianLaunchRouter {
    using SafeERC20 for IERC20;

    PonsV2LaunchFactory public immutable factory;
    address public immutable wallTreasuryImpl;
    address public immutable wallStakingImpl;
    address public immutable wallLadderImpl;
    address public immutable pofVaultImpl;
    PoFRouter public immutable pofRouter;
    address public keeper; // platform keeper for template treasuries (defend / claimAndBuy)
    address public vault; // PoundVault: receives referral attribution (zero = attribution off)
    bool public templatesEnabled; // Wall / Proof-of-Fee launches (off until their fixes ship)
    mapping(address token => address) public launcherRef; // who brought the creator, per token

    uint256 private _lock = 1;

    event LaunchedAndBought(
        address indexed deployer, address indexed token, address indexed curve, address pairToken, uint256 quoteIn, uint256 tokensOut
    );
    event WallLaunched(address indexed deployer, address indexed token, address curve, address treasury, address staking, address pairToken);
    event WallLadderCreated(address indexed token, address ladder);
    event PoFLaunched(address indexed deployer, address indexed token, address curve, address vault, address pairToken);
    event KeeperSet(address keeper);
    event VaultSet(address vault);
    event TemplatesEnabledSet(bool enabled);
    event Bought(address indexed token, address indexed buyer, address indexed recipient, address referrer, uint256 quoteIn, uint256 tokensOut, uint256 fee);
    event Sold(address indexed token, address indexed seller, address indexed recipient, address referrer, uint256 tokensIn, uint256 quoteOut, uint256 fee);

    error BadValue(uint256 expected, uint256 actual);
    error RefundFailed();
    error NotOwner();
    error TemplatesDisabled();
    error UnknownToken();

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(PonsV2LaunchFactory factory_, address wallTreasuryImpl_, address wallStakingImpl_, address wallLadderImpl_, address pofVaultImpl_) {
        require(address(factory_) != address(0), "zero");
        require(
            wallTreasuryImpl_.code.length > 0 && wallStakingImpl_.code.length > 0 && wallLadderImpl_.code.length > 0 && pofVaultImpl_.code.length > 0,
            "impl has no code"
        );
        factory = factory_;
        wallTreasuryImpl = wallTreasuryImpl_;
        wallStakingImpl = wallStakingImpl_;
        wallLadderImpl = wallLadderImpl_;
        pofVaultImpl = pofVaultImpl_;
        pofRouter = new PoFRouter(address(this));
    }

    function platformOwner() public view returns (address) {
        return factory.owner();
    }

    function setKeeper(address k) external {
        if (msg.sender != platformOwner()) revert NotOwner();
        keeper = k;
        emit KeeperSet(k);
    }

    function setVault(address v) external {
        if (msg.sender != platformOwner()) revert NotOwner();
        vault = v;
        emit VaultSet(v);
    }

    function setTemplatesEnabled(bool on) external {
        if (msg.sender != platformOwner()) revert NotOwner();
        templatesEnabled = on;
        emit TemplatesEnabledSet(on);
    }

    // ---- trades with referral tags ----

    /// @notice Buy `token` on its curve. Tokens go to `recipient`; a clamped fill
    ///         refunds the unspent quote to the caller. `referrer` (optional) is
    ///         credited its share of the fee in the PoundVault.
    function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, address referrer)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        if (L.curve == address(0)) revert UnknownToken();
        if (recipient == address(0)) recipient = msg.sender;
        uint256 spent;
        if (L.pairToken == address(0)) {
            if (msg.value != quoteIn) revert BadValue(quoteIn, msg.value);
            uint256 baseline = address(this).balance - msg.value;
            tokensOut = IRadianCurve(L.curve).buy{value: quoteIn}(quoteIn, minTokensOut, recipient);
            spent = quoteIn - _refundNative(baseline);
        } else {
            if (msg.value != 0) revert BadValue(0, msg.value);
            IERC20 quote = IERC20(L.pairToken);
            uint256 baseline = quote.balanceOf(address(this));
            quote.safeTransferFrom(msg.sender, address(this), quoteIn);
            quote.forceApprove(L.curve, quoteIn);
            tokensOut = IRadianCurve(L.curve).buy(quoteIn, minTokensOut, recipient);
            quote.forceApprove(L.curve, 0);
            spent = quoteIn - _refundToken(quote, baseline);
        }
        uint256 fee = (spent * IRadianCurve(L.curve).feeBps()) / 10_000;
        _attribute(L.pairToken, msg.sender, referrer, token, fee);
        emit Bought(token, msg.sender, recipient, referrer, spent, tokensOut, fee);
    }

    /// @notice Sell `tokensIn` of `token` on its curve; the quote goes to `recipient`.
    function sell(address token, uint256 tokensIn, uint256 minQuoteOut, address recipient, address referrer)
        external
        nonReentrant
        returns (uint256 quoteOut)
    {
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        if (L.curve == address(0)) revert UnknownToken();
        if (recipient == address(0)) recipient = msg.sender;
        IERC20 t = IERC20(token);
        t.safeTransferFrom(msg.sender, address(this), tokensIn);
        t.forceApprove(L.curve, tokensIn);
        quoteOut = IRadianCurve(L.curve).sell(tokensIn, minQuoteOut, recipient);
        t.forceApprove(L.curve, 0);
        uint256 feeBps = IRadianCurve(L.curve).feeBps();
        uint256 fee = (quoteOut * feeBps) / (10_000 - feeBps); // the fee came off the gross quote
        _attribute(L.pairToken, msg.sender, referrer, token, fee);
        emit Sold(token, msg.sender, recipient, referrer, tokensIn, quoteOut, fee);
    }

    // ---- standard launch ----

    /// @param referrer who brought the creator: recorded as the token's launcher
    ///        reference and credited on every router trade of this token.
    function launchAndBuy(
        PonsV2LaunchFactory.TokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address[] calldata snipeTaxExemptions,
        address referrer
    ) external payable nonReentrant returns (address token, address curve, uint256 tokensOut) {
        uint256 baseline = address(this).balance - msg.value;
        uint256 fee = _checkValue(pairToken, buyAmount);
        (token, curve) = factory.launchTokenFor{value: fee}(params, launchConfigId, pairToken, msg.sender, snipeTaxExemptions);
        if (referrer != address(0) && referrer != msg.sender) launcherRef[token] = referrer;
        uint256 spent;
        (tokensOut, spent) = _openingBuy(curve, pairToken, buyAmount, minTokensOut);
        _refundNative(baseline);
        uint256 tradeFee = (spent * IRadianCurve(curve).feeBps()) / 10_000;
        _attribute(pairToken, msg.sender, referrer, token, tradeFee);
        emit LaunchedAndBought(msg.sender, token, curve, pairToken, spent, tokensOut);
    }

    // ---- template: stock treasury (The Wall) ----

    function predictWall(address creator, bytes32 salt) public view returns (address treasury, address staking) {
        bytes32 s = keccak256(abi.encode(creator, salt, "wall"));
        treasury = Clones1167.predict(wallTreasuryImpl, s, address(this));
        staking = Clones1167.predict(wallStakingImpl, keccak256(abi.encode(s, "staking")), address(this));
    }

    function predictWallLadder(address creator, bytes32 salt) public view returns (address) {
        bytes32 s = keccak256(abi.encode(creator, salt, "wall"));
        return Clones1167.predict(wallLadderImpl, keccak256(abi.encode(s, "ladder")), address(this));
    }

    function launchWall(
        PonsV2LaunchFactory.TokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address[] calldata snipeTaxExemptions,
        WallTreasury.Config calldata cfg
    ) external payable nonReentrant returns (address token, address curve, address treasury, address staking) {
        if (!templatesEnabled) revert TemplatesDisabled();
        uint256 baseline = address(this).balance - msg.value;
        uint256 fee = _checkValue(pairToken, buyAmount);
        bytes32 s = keccak256(abi.encode(msg.sender, params.salt, "wall"));
        treasury = Clones1167.clone(wallTreasuryImpl, s);
        staking = Clones1167.clone(wallStakingImpl, keccak256(abi.encode(s, "staking")));
        address ladder = Clones1167.clone(wallLadderImpl, keccak256(abi.encode(s, "ladder")));

        PonsV2LaunchFactory.TokenParams memory p = params;
        p.creatorFeeRecipient = treasury;
        p.buybackEnabled = false; // the creator share must reach the treasury, not the platform vault
        (token, curve) = factory.launchTokenFor{value: fee}(p, launchConfigId, pairToken, msg.sender, snipeTaxExemptions);

        WallStaking(payable(staking)).initialize(token, pairToken, treasury);
        WallTreasury(payable(treasury)).initialize(
            address(this), token, curve, pairToken, address(factory.feeEscrow()), address(factory.buybackVault()), staking, ladder, cfg
        );
        _initLadder(ladder, treasury, token, pairToken, launchConfigId, cfg);
        emit WallLadderCreated(token, ladder);
        _openingBuy(curve, pairToken, buyAmount, minTokensOut);
        _refundNative(baseline);
        emit WallLaunched(msg.sender, token, curve, treasury, staking, pairToken);
    }

    // ---- template: Proof-of-Fee ----

    function predictPoF(address creator, bytes32 salt) public view returns (address pofVault) {
        pofVault = Clones1167.predict(pofVaultImpl, keccak256(abi.encode(creator, salt, "pof")), address(this));
    }

    function launchPoF(
        PonsV2LaunchFactory.TokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address[] calldata snipeTaxExemptions,
        PoFVault.Config calldata cfg
    ) external payable nonReentrant returns (address token, address curve, address pofVault) {
        if (!templatesEnabled) revert TemplatesDisabled();
        uint256 baseline = address(this).balance - msg.value;
        uint256 fee = _checkValue(pairToken, buyAmount);
        pofVault = Clones1167.clone(pofVaultImpl, keccak256(abi.encode(msg.sender, params.salt, "pof")));

        PonsV2LaunchFactory.TokenParams memory p = params;
        p.creatorFeeRecipient = pofVault;
        p.buybackEnabled = false;
        (token, curve) = factory.launchTokenFor{value: fee}(p, launchConfigId, pairToken, msg.sender, snipeTaxExemptions);

        PoFVault(payable(pofVault)).initialize(address(this), token, curve, pairToken, address(factory.feeEscrow()), address(pofRouter), cfg);
        pofRouter.register(token, pofVault, curve, pairToken);

        // The opening buy goes through the official path so it earns Work.
        if (buyAmount > 0) {
            if (pairToken == address(0)) {
                pofRouter.buyFor{value: buyAmount}(token, buyAmount, minTokensOut, msg.sender);
            } else {
                IERC20 quote = IERC20(pairToken);
                uint256 qBaseline = quote.balanceOf(address(this));
                quote.safeTransferFrom(msg.sender, address(this), buyAmount);
                quote.forceApprove(address(pofRouter), buyAmount);
                pofRouter.buyFor(token, buyAmount, minTokensOut, msg.sender);
                quote.forceApprove(address(pofRouter), 0);
                _refundToken(quote, qBaseline);
            }
        }
        _refundNative(baseline);
        emit PoFLaunched(msg.sender, token, curve, pofVault, pairToken);
    }

    /// @dev The ladder's knobs derive from the treasury's: same bounty, at least an
    ///      hourly beat, 2% of inflow to the keeper escrow, anchor slew ≤ ×1.25 per beat.
    function _initLadder(address ladder, address treasury, address token, address pairToken, uint256 launchConfigId, WallTreasury.Config calldata cfg)
        private
    {
        PonsV2LaunchFactory.LaunchConfig memory lc = factory.getLaunchConfig(launchConfigId);
        WallLadder(payable(ladder)).initialize(
            address(this),
            treasury,
            token,
            pairToken,
            address(factory.poolManager()),
            address(factory.positionManager()),
            address(factory.permit2()),
            address(factory.memeHook()),
            lc.poolFee,
            lc.tickSpacing,
            WallLadder.Config({keeperInflowBps: 200, keeperBounty: cfg.keeperBounty, minInterval: cfg.minInterval < 3600 ? 3600 : cfg.minInterval, maxSlewBps: 2500})
        );
    }

    // ---- internals ----

    function _checkValue(address pairToken, uint256 buyAmount) private view returns (uint256 fee) {
        fee = factory.launchFee();
        uint256 expected = fee + (pairToken == address(0) ? buyAmount : 0);
        if (msg.value != expected) revert BadValue(expected, msg.value);
    }

    function _openingBuy(address curve, address pairToken, uint256 buyAmount, uint256 minTokensOut)
        private
        returns (uint256 tokensOut, uint256 spent)
    {
        if (buyAmount == 0) return (0, 0);
        if (pairToken == address(0)) {
            uint256 before = address(this).balance;
            tokensOut = IRadianCurve(curve).buy{value: buyAmount}(buyAmount, minTokensOut, msg.sender);
            // a clamped fill refunds part of it to this contract; the caller's baseline sweep returns it
            spent = buyAmount - (address(this).balance - (before - buyAmount));
        } else {
            IERC20 quote = IERC20(pairToken);
            uint256 baseline = quote.balanceOf(address(this));
            quote.safeTransferFrom(msg.sender, address(this), buyAmount);
            quote.forceApprove(curve, buyAmount);
            tokensOut = IRadianCurve(curve).buy(buyAmount, minTokensOut, msg.sender);
            quote.forceApprove(curve, 0);
            spent = buyAmount - _refundToken(quote, baseline);
        }
    }

    function _attribute(address pairToken, address user, address referrer, address token, uint256 fee) private {
        if (vault == address(0) || fee == 0) return;
        IPoundVaultAttribution(vault).attribute(pairToken, user, referrer, launcherRef[token], fee);
    }

    /// @dev Return whatever this call added to the router's native balance (a
    ///      clamped fill's refund); anything that was here before stays untouched.
    function _refundNative(uint256 baseline) private returns (uint256 refunded) {
        uint256 bal = address(this).balance;
        if (bal <= baseline) return 0;
        refunded = bal - baseline;
        (bool ok,) = msg.sender.call{value: refunded}("");
        if (!ok) revert RefundFailed();
    }

    function _refundToken(IERC20 quote, uint256 baseline) private returns (uint256 refunded) {
        uint256 bal = quote.balanceOf(address(this));
        if (bal <= baseline) return 0;
        refunded = bal - baseline;
        quote.safeTransfer(msg.sender, refunded);
    }

    receive() external payable {}
}
