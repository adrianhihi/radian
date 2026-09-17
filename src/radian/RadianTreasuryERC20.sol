// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ICurveBuyQ {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function graduated() external view returns (bool);
    function sellableTokens() external view returns (uint256);
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function pairToken() external view returns (address);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
}

interface IBurnableQ {
    function burn(uint256 amount) external;
    function balanceOf(address a) external view returns (uint256);
}

interface IStakingNotifyQ {
    function notifyReward(uint256 amount) external;
    function stakingToken() external view returns (address);
    function rewardToken() external view returns (address);
    function rewardsDistributor() external view returns (address);
    function totalStaked() external view returns (uint256);
}

interface IFeeEscrowQ {
    function claim() external returns (uint256 amount);
    function claimToken(address token) external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
    function balanceOfToken(address recipient, address token) external view returns (uint256);
}

/// @title RadianTreasuryERC20
/// @notice The $RADIAN flywheel for chains whose gas coin is not a dollar. The
///         platform's protocol fees accrue to this treasury in the escrow; the
///         part denominated in `quote` (the chain's dollar ERC-20 — USDG on
///         Robinhood Chain — which is also what $RADIAN's curve is priced in)
///         is what `flush` works with: `buybackBps` buys $RADIAN on its curve
///         and BURNS it, the rest streams to stakers as real dollar yield.
///         Fees that arrive in other assets (the gas coin, stock quotes) are
///         held for the owner to route; the quote asset itself is never
///         rescuable — it can only leave through `flush`.
/// @dev Same bounds as the Arc treasury: a flush buys at most
///      `maxBuybackReserveBps` of the curve's quote reserve, flushes are
///      rate-limited, and a buyback needs an off-chain quote (`minRadianOut`).
///      The keeper's quote is a floor it can only raise: the treasury keeps the
///      curve reserves seen at the end of the previous flush and (1) skips the
///      buyback when the live price is more than `maxSlippageBps` above that
///      reference (a front-run cannot be sold into), (2) caps the buy by the
///      smaller of the live and reference quote reserves (a front-run cannot
///      enlarge the cap), and (3) requires the tokens actually received to be
///      within `maxSlippageBps` of the constant-product amount at the reference
///      reserves, whatever `minRadianOut` said. The staker share is held back
///      while nobody is staked (it would be unrecoverable in the pool).
///      On an ERC-20 quote the curve graduates at the pair token's threshold
///      (it cannot be made "never graduating" like a native launch config), so
///      after graduation everything streams to stakers until a pool-side
///      buyback module exists. Ownership is two-step and cannot be renounced.
contract RadianTreasuryERC20 is Ownable2Step {
    using SafeERC20 for IERC20;

    address public keeper;
    address public immutable radian; // $RADIAN (ERC20Burnable)
    address public immutable radianCurve; // buyback venue while on the curve
    IERC20 public immutable quote; // the dollar ERC-20 the curve is priced in
    IFeeEscrowQ public immutable feeEscrow;
    IStakingNotifyQ public staking;

    uint16 public buybackBps = 5_000;
    uint16 public maxBuybackReserveBps = 500;
    uint32 public minFlushInterval = 1 hours;
    uint64 public lastFlushAt;
    /// @notice tolerated deviation (bps) between the live curve and the reference reserves
    uint16 public maxSlippageBps = 300;
    /// @notice curve reserves recorded at the end of the last flush (or at deploy)
    uint256 public refQuoteReserve;
    uint256 public refTokenReserve;

    uint256 public totalBurned;
    uint256 public totalToStakers;
    uint256 public totalFlushed;

    event Flushed(uint256 usdcIn, uint256 radianBurned, uint256 toStakers); // same shape as the Arc treasury (indexer)
    event FeesClaimed(uint256 amount);
    event TokenFeesClaimed(address indexed token, uint256 amount);
    event NativeFeesClaimed(uint256 amount);
    event BuybackBpsSet(uint16 bps);
    event FlushLimitsSet(uint16 maxBuybackReserveBps, uint32 minFlushInterval);
    event StakingSet(address staking);
    event KeeperSet(address keeper);
    event Rescued(address indexed token, address indexed to, uint256 amount);
    event MaxSlippageSet(uint16 bps);
    event BuybackSkipped(uint256 liveQuoteReserve, uint256 liveTokenReserve);

    constructor(address radian_, address radianCurve_, address feeEscrow_, address quote_, address owner_) Ownable(owner_) {
        require(radian_ != address(0) && radianCurve_ != address(0) && feeEscrow_ != address(0) && quote_ != address(0), "zero");
        require(ICurveBuyQ(radianCurve_).pairToken() == quote_, "curve not priced in quote");
        radian = radian_;
        radianCurve = radianCurve_;
        feeEscrow = IFeeEscrowQ(feeEscrow_);
        quote = IERC20(quote_);
        (refQuoteReserve, refTokenReserve) = ICurveBuyQ(radianCurve_).getReserves();
    }

    receive() external payable {}

    // ---- fee intake ----

    /// @notice Pull this treasury's quote-asset fee balance out of the escrow.
    ///         Permissionless: the funds can only land here.
    function claimFees() external returns (uint256 amount) {
        if (feeEscrow.balanceOfToken(address(this), address(quote)) == 0) return 0;
        amount = feeEscrow.claimToken(address(quote));
        emit FeesClaimed(amount);
    }

    /// @notice Pull a non-quote ERC-20 fee balance (a stock quote…). Held for
    ///         the owner to route (see `rescueERC20`).
    function claimTokenFees(address token) external returns (uint256 amount) {
        require(token != address(quote), "use claimFees");
        amount = feeEscrow.claimToken(token);
        emit TokenFeesClaimed(token, amount);
    }

    /// @notice Pull gas-coin fees (from launches quoted in the gas coin). Held
    ///         for the owner to route (see `rescueNative`).
    function claimNativeFees() external returns (uint256 amount) {
        amount = feeEscrow.claim();
        emit NativeFeesClaimed(amount);
    }

    /// @notice Quote asset waiting in the escrow for this treasury.
    function claimableFees() external view returns (uint256) {
        return feeEscrow.balanceOfToken(address(this), address(quote));
    }

    // ---- the flywheel ----

    function flush(uint256 minRadianOut, uint256 deadline) external returns (uint256 burned, uint256 toStakers) {
        require(msg.sender == owner() || msg.sender == keeper, "not keeper");
        require(block.timestamp <= deadline, "expired");
        require(lastFlushAt == 0 || block.timestamp >= uint256(lastFlushAt) + minFlushInterval, "too soon");
        require(address(staking) != address(0), "no staking");
        uint256 bal = quote.balanceOf(address(this));
        require(bal > 0, "empty");

        uint256 buyback = (bal * buybackBps) / 10_000;
        toStakers = bal - buyback;
        uint256 spent;

        ICurveBuyQ curve = ICurveBuyQ(radianCurve);
        bool onCurve = !curve.graduated() && curve.sellableTokens() > 0;
        if (buyback > 0 && onCurve) {
            require(minRadianOut > 0, "quote required");
            (uint256 q, uint256 t) = curve.getReserves();
            // (1) live price above the reference by more than the tolerance: someone
            //     pushed it up right before us; hold the buyback share for a later flush.
            if (q * refTokenReserve > Math.mulDiv(refQuoteReserve * t, 10_000 + maxSlippageBps, 10_000)) {
                emit BuybackSkipped(q, t);
                buyback = 0;
            } else {
                // (2) the cap cannot be enlarged by a front-run
                uint256 capBase = q < refQuoteReserve ? q : refQuoteReserve;
                uint256 cap = (capBase * maxBuybackReserveBps) / 10_000;
                if (buyback > cap) buyback = cap; // the excess waits for a later flush
            }
            if (buyback > 0) {
                uint256 before = quote.balanceOf(address(this));
                quote.forceApprove(radianCurve, buyback);
                uint256 out = curve.buy(buyback, minRadianOut, address(this));
                quote.forceApprove(radianCurve, 0);
                spent = before - quote.balanceOf(address(this)); // a clamped fill refunds part
                // (3) floor on what we actually got, at the reference reserves, whatever the keeper quoted
                uint256 net = (spent * (10_000 - curve.feeBps() - curve.creatorTaxBps())) / 10_000;
                uint256 expected = Math.mulDiv(refTokenReserve, net, refQuoteReserve + net);
                require(out >= Math.mulDiv(expected, 10_000 - maxSlippageBps, 10_000), "buyback below floor");
                burned = IBurnableQ(radian).balanceOf(address(this));
                if (burned > 0) {
                    IBurnableQ(radian).burn(burned);
                    totalBurned += burned;
                }
            }
        } else if (!onCurve) {
            buyback = 0;
            toStakers = bal;
        } else {
            buyback = 0;
        }

        // the staker share is held back (not lost) while nobody is staked
        if (toStakers > 0 && staking.totalStaked() > 0) {
            quote.forceApprove(address(staking), toStakers);
            staking.notifyReward(toStakers);
            quote.forceApprove(address(staking), 0);
            totalToStakers += toStakers;
        } else {
            toStakers = 0;
        }
        (refQuoteReserve, refTokenReserve) = curve.getReserves();
        lastFlushAt = uint64(block.timestamp);
        totalFlushed += spent + toStakers;
        emit Flushed(spent + toStakers, burned, toStakers);
    }

    // ---- admin ----

    function setStaking(address s) external onlyOwner {
        require(s != address(0), "zero");
        require(IStakingNotifyQ(s).stakingToken() == radian, "wrong staking token");
        require(IStakingNotifyQ(s).rewardToken() == address(quote), "wrong reward token");
        require(IStakingNotifyQ(s).rewardsDistributor() == address(this), "pool not pointed at this treasury");
        staking = IStakingNotifyQ(s);
        emit StakingSet(s);
    }

    function setBuybackBps(uint16 bps) external onlyOwner {
        require(bps <= 10_000, "range");
        buybackBps = bps;
        emit BuybackBpsSet(bps);
    }

    function setFlushLimits(uint16 maxBuybackReserveBps_, uint32 minFlushInterval_) external onlyOwner {
        require(maxBuybackReserveBps_ > 0 && maxBuybackReserveBps_ <= 10_000, "range");
        maxBuybackReserveBps = maxBuybackReserveBps_;
        minFlushInterval = minFlushInterval_;
        emit FlushLimitsSet(maxBuybackReserveBps_, minFlushInterval_);
    }

    function setMaxSlippage(uint16 bps) external onlyOwner {
        require(bps > 0 && bps <= 2_000, "range");
        maxSlippageBps = bps;
        emit MaxSlippageSet(bps);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    /// @notice Route a non-flywheel ERC-20 (claimed stock-quote fees, mistakes)
    ///         out. $RADIAN is burn-only and the quote asset only leaves via flush.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        require(token != radian, "radian is burn-only");
        require(token != address(quote), "quote only leaves via flush");
        require(to != address(0), "zero");
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }

    /// @notice Route gas-coin fees out (they are not the flywheel's asset here).
    function rescueNative(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero");
        (bool ok,) = to.call{value: amount}("");
        require(ok, "send failed");
        emit Rescued(address(0), to, amount);
    }

    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }
}
