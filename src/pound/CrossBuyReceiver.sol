// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPonsV2LaunchFactory} from "../v2/interfaces/ILaunchpadV2.sol";

/// @dev The two router members the receiver uses (RadianLaunchRouter v4).
interface IRadianLaunchRouterBuy {
    function factory() external view returns (address);
    function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, address referrer)
        external
        payable
        returns (uint256 tokensOut);
}

/// @title CrossBuyReceiver
/// @notice The home-chain endpoint of a cross-chain buy. A bridge / intent
///         router (Relay, Across, deBridge DLN) delivers the quote asset to this
///         contract on Robinhood Chain and then calls it; the receiver spends
///         that delivery on `RadianLaunchRouter.buy` for the real buyer, tagging
///         the referrer, so a wallet on Base / BNB / Solana ends up holding a
///         Radian launch token.
///
///         The bridge leg is final by the time this contract runs, so a buy
///         that cannot be completed (unknown token, graduated curve, slippage,
///         any router revert) never reverts back to the bridge: the delivery is
///         returned to `refundTo` and `Refunded` is emitted instead.
///
///         Accounting — "atomic per call, with a parking ledger for refunds
///         that cannot be delivered":
///         - Every entry point moves exactly one delivery: the ETH sent with
///           the call, the token amount Across reports, or (for `buyFor` on an
///           ERC-20-quoted launch, where the tokens arrive as a plain transfer
///           just before the call) this contract's whole unparked balance of
///           the launch's quote asset. Whatever the buy does not consume is
///           sent to `refundTo` in the same transaction, so the contract holds
///           nothing between calls by construction.
///         - The one way funds can remain is a refund that `refundTo` cannot
///           accept (a contract rejecting ETH, a stablecoin blocklist). Such a
///           refund is recorded in `owed[asset][refundTo]` and excluded from
///           every later delivery, and `release` can only ever send it to that
///           recorded `refundTo`. There is no sweep to an arbitrary address, no
///           owner, no upgrade and no pause: nothing here can be redirected.
///         - A transfer that reaches this contract without a call in the same
///           transaction (a mis-built integration) is unattributable, exactly
///           as it would be at any other contract address; the next `buyFor`
///           of that quote asset treats it as its delivery. Integrations must
///           deliver and call atomically, which Relay, Across and deBridge do.
///
///         Router facts this contract relies on (RadianLaunchRouter v4):
///         `buy` needs `msg.value == quoteIn` for a native quote and pulls an
///         ERC-20 quote with `transferFrom(msg.sender)`; a clamped fill refunds
///         the unspent quote to `msg.sender` (this contract), which passes it
///         on; and the router attributes the trade to `msg.sender`, so the
///         PoundVault's self-referral check sees this contract, not the buyer —
///         the receiver therefore drops `referrer == recipient` itself.
contract CrossBuyReceiver {
    using SafeERC20 for IERC20;

    IRadianLaunchRouterBuy public immutable router;
    IPonsV2LaunchFactory public immutable factory;

    /// @notice Refunds that could not be delivered, claimable only by their `refundTo`.
    mapping(address asset => mapping(address refundTo => uint256)) public owed;
    /// @notice Sum of `owed[asset][*]`: the part of this contract's balance that belongs to past calls.
    mapping(address asset => uint256) public totalOwed;

    uint256 private _lock = 1;

    /// @param quoteIn the quote actually spent on the curve (a clamped fill spends less than delivered)
    event Bought(address indexed token, address indexed recipient, uint256 quoteIn, uint256 tokensOut, address referrer);
    /// @param reason the router's revert data, or a short label for a refund that is not a failure
    event Refunded(address indexed token, address indexed refundTo, address asset, uint256 amount, bytes reason);
    /// @notice A refund `refundTo` could not accept; parked under `owed` until `release`.
    event Parked(address indexed refundTo, address indexed asset, uint256 amount, bytes reason);
    event Released(address indexed refundTo, address indexed asset, uint256 amount);

    error ZeroRouter();
    error ZeroRecipient();
    error UnknownToken();
    error NothingDelivered();
    error ReleaseFailed();

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address router_) {
        if (router_ == address(0)) revert ZeroRouter();
        router = IRadianLaunchRouterBuy(router_);
        factory = IPonsV2LaunchFactory(IRadianLaunchRouterBuy(router_).factory());
    }

    /// @dev Clamped-fill refunds from the router land here.
    receive() external payable {}

    // ---- entry points ----

    /// @notice Buy `token` for `recipient` with what was delivered for this call:
    ///         the ETH sent along (native-quoted launch) or this contract's
    ///         balance of the launch's quote asset, transferred just before the
    ///         call (ERC-20-quoted launch, e.g. USDG). Never reverts for a
    ///         failed buy: the delivery goes to `refundTo` instead.
    /// @param minTokensOut the curve's price bound (a partial fill honours it pro rata)
    /// @param recipient the buyer's address on this chain (a Solana buyer's EVM smart account)
    /// @param refundTo where an unspent or failed delivery goes; zero means `recipient`
    /// @param referrer credited its referral share in the PoundVault; ignored when it is the recipient
    function buyFor(address token, uint256 minTokensOut, address recipient, address refundTo, address referrer)
        external
        payable
        nonReentrant
    {
        if (recipient == address(0)) revert ZeroRecipient();
        if (refundTo == address(0)) refundTo = recipient;
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        if (L.curve == address(0)) {
            // Nothing to buy. ETH came with the call, so it can be returned;
            // an ERC-20 delivery for an unknown token cannot be identified
            // (the factory's quote list is not enumerable), and a successful
            // no-op would strand it, so the call reverts and the delivering
            // router's own failure handling takes over.
            if (msg.value == 0) revert UnknownToken();
            _refund(token, address(0), refundTo, msg.value, "unknown token");
            return;
        }
        uint256 amount;
        if (L.pairToken == address(0)) {
            amount = msg.value;
        } else {
            // ETH sent with an ERC-20-quoted buy is not the quote; hand it back.
            if (msg.value > 0) _refund(token, address(0), refundTo, msg.value, "value with erc20 quote");
            amount = _available(L.pairToken);
        }
        if (amount == 0) revert NothingDelivered();
        _execute(token, L.pairToken, amount, minTokensOut, recipient, refundTo, referrer);
    }

    /// @notice Across V3 entry point: the SpokePool transfers `amount` of
    ///         `tokenSent` to this contract and then calls this with the
    ///         deposit's message, `abi.encode(token, minTokensOut, recipient,
    ///         refundTo, referrer)`. The asset and amount are explicit here, so
    ///         an unknown token or a wrong asset is refunded exactly.
    ///         (Interface per Across V3 `AcrossMessageHandler`; not verified
    ///         against a live SpokePool in this repository — see the docs.)
    function handleV3AcrossMessage(address tokenSent, uint256 amount, address, bytes calldata message)
        external
        nonReentrant
    {
        (address token, uint256 minTokensOut, address recipient, address refundTo, address referrer) =
            abi.decode(message, (address, uint256, address, address, address));
        if (recipient == address(0)) revert ZeroRecipient();
        if (refundTo == address(0)) refundTo = recipient;
        uint256 have = _available(tokenSent);
        if (amount > have) amount = have; // never move more than this delivery
        if (amount == 0) revert NothingDelivered();
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        if (L.curve == address(0)) {
            _refund(token, tokenSent, refundTo, amount, "unknown token");
            return;
        }
        if (L.pairToken != tokenSent) {
            _refund(token, tokenSent, refundTo, amount, "not the quote asset");
            return;
        }
        _execute(token, tokenSent, amount, minTokensOut, recipient, refundTo, referrer);
    }

    /// @notice Deliver a parked refund. Permissionless, but the only possible
    ///         destination is the `refundTo` it was recorded for.
    function release(address asset, address refundTo) external nonReentrant returns (uint256 amount) {
        amount = owed[asset][refundTo];
        if (amount == 0) return 0;
        owed[asset][refundTo] = 0;
        totalOwed[asset] -= amount;
        if (!_send(asset, refundTo, amount)) revert ReleaseFailed();
        emit Released(refundTo, asset, amount);
    }

    // ---- views ----

    /// @notice The quote asset a delivery for `token` must be in (zero = ETH), and whether the factory knows the token.
    function quoteAssetOf(address token) external view returns (bool known, address asset) {
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        return (L.curve != address(0), L.pairToken);
    }

    // ---- internals ----

    /// @dev Spend exactly `amount` of `asset` on the router for `recipient`;
    ///      return the rest (all of it on a failure, the clamped remainder on
    ///      success) to `refundTo`. The router's revert is caught, never
    ///      propagated: the bridge leg is already final.
    function _execute(
        address token,
        address asset,
        uint256 amount,
        uint256 minTokensOut,
        address recipient,
        address refundTo,
        address referrer
    ) private {
        // The router attributes to msg.sender (this contract), so the vault's
        // self-referral check cannot see the buyer; apply it here.
        if (referrer == recipient) referrer = address(0);

        uint256 before = _available(asset);
        bool ok;
        uint256 tokensOut;
        bytes memory reason;
        if (asset == address(0)) {
            try router.buy{value: amount}(token, amount, minTokensOut, recipient, referrer) returns (uint256 out) {
                ok = true;
                tokensOut = out;
            } catch (bytes memory err) {
                reason = err;
            }
        } else {
            IERC20(asset).forceApprove(address(router), amount); // exact, per call
            try router.buy(token, amount, minTokensOut, recipient, referrer) returns (uint256 out) {
                ok = true;
                tokensOut = out;
            } catch (bytes memory err) {
                reason = err;
            }
            IERC20(asset).forceApprove(address(router), 0); // nothing outstanding between calls
        }
        // A clamped fill's refund has already come back from the router, so the
        // balance drop is what the curve kept. Saturating: the router can take
        // at most `amount` (exact value / exact approval), and nothing else
        // moves this balance during the call.
        uint256 after_ = _available(asset);
        uint256 spent = after_ < before ? before - after_ : 0;
        if (spent > amount) spent = amount;
        uint256 left = amount - spent;
        if (ok) {
            emit Bought(token, recipient, spent, tokensOut, referrer);
            if (left > 0) _refund(token, asset, refundTo, left, "clamped fill");
        } else {
            _refund(token, asset, refundTo, left, reason);
        }
    }

    /// @dev Send a refund; if `to` cannot take it, park it under `owed` for `release`.
    function _refund(address token, address asset, address to, uint256 amount, bytes memory reason) private {
        if (_send(asset, to, amount)) {
            emit Refunded(token, to, asset, amount, reason);
        } else {
            owed[asset][to] += amount;
            totalOwed[asset] += amount;
            emit Parked(to, asset, amount, reason);
        }
    }

    /// @dev Non-reverting transfer of `asset` (zero = ETH). A token that returns
    ///      nothing counts as success (its call would have reverted otherwise).
    function _send(address asset, address to, uint256 amount) private returns (bool) {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            return ok;
        }
        (bool ok, bytes memory ret) = asset.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (ret.length == 0 || (ret.length >= 32 && abi.decode(ret, (bool))));
    }

    /// @dev This contract's balance of `asset` minus what is parked for earlier calls.
    function _available(address asset) private view returns (uint256) {
        uint256 bal = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 parked = totalOwed[asset];
        return bal > parked ? bal - parked : 0;
    }
}
