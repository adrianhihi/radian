// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PonsV2LaunchFactory} from "../v2/PonsV2LaunchFactory.sol";

interface IRadianCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
}

/// @title RadianLaunchRouter
/// @notice One transaction: launch a token and make the creator's opening buy.
///         The factory's trusted `launchForwarder` — it calls `launchTokenFor`
///         with the real user as `originalDeployer`, so the launch is attributed
///         to the user (CREATE2 namespace, creator fees, snipe-tax exemption) and
///         the opening buy settles untaxed at the opening price. Extra wallets
///         the creator declares are exempted too, so a team can bundle its
///         opening buys without paying the snipe tax meant for bots.
/// @dev Holds nothing between calls. Native quote: `msg.value = launchFee + buyAmount`.
///      ERC-20 quote: `msg.value = launchFee`, `buyAmount` is pulled with
///      transferFrom (approve this router first). Any refund the curve sends
///      for a clamped fill is forwarded to the user in the same transaction.
contract RadianLaunchRouter {
    using SafeERC20 for IERC20;

    PonsV2LaunchFactory public immutable factory;
    uint256 private _lock = 1;

    event LaunchedAndBought(
        address indexed deployer, address indexed token, address indexed curve, address pairToken, uint256 quoteIn, uint256 tokensOut
    );

    error BadValue(uint256 expected, uint256 actual);
    error RefundFailed();

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(PonsV2LaunchFactory factory_) {
        require(address(factory_) != address(0), "zero");
        factory = factory_;
    }

    /// @param buyAmount Opening buy in the quote asset (0 = launch only).
    /// @param minTokensOut Slippage bound for the opening buy (price bound on partial fills).
    /// @param snipeTaxExemptions Extra wallets exempt from the snipe tax (the creator is always exempt).
    function launchAndBuy(
        PonsV2LaunchFactory.TokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address[] calldata snipeTaxExemptions
    ) external payable nonReentrant returns (address token, address curve, uint256 tokensOut) {
        uint256 fee = factory.launchFee();
        bool native = pairToken == address(0);
        uint256 expected = fee + (native ? buyAmount : 0);
        if (msg.value != expected) revert BadValue(expected, msg.value);

        (token, curve) = factory.launchTokenFor{value: fee}(params, launchConfigId, pairToken, msg.sender, snipeTaxExemptions);

        if (buyAmount > 0) {
            if (native) {
                tokensOut = IRadianCurve(curve).buy{value: buyAmount}(buyAmount, minTokensOut, msg.sender);
            } else {
                IERC20 quote = IERC20(pairToken);
                quote.safeTransferFrom(msg.sender, address(this), buyAmount);
                quote.forceApprove(curve, buyAmount);
                tokensOut = IRadianCurve(curve).buy(buyAmount, minTokensOut, msg.sender);
                quote.forceApprove(curve, 0);
                uint256 left = quote.balanceOf(address(this));
                if (left > 0) quote.safeTransfer(msg.sender, left);
            }
        }
        // A clamped fill refunds the buyer (this contract) — pass it straight on.
        uint256 dust = address(this).balance;
        if (dust > 0) {
            (bool ok,) = msg.sender.call{value: dust}("");
            if (!ok) revert RefundFailed();
        }
        emit LaunchedAndBought(msg.sender, token, curve, pairToken, buyAmount, tokensOut);
    }

    receive() external payable {} // curve refunds on clamped fills
}
