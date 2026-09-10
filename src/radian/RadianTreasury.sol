// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ICurveBuy {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function graduated() external view returns (bool);
}

interface IBurnable {
    function burn(uint256 amount) external;
    function balanceOf(address a) external view returns (uint256);
}

interface IStakingNotify {
    function notifyReward() external payable;
}

/// @title RadianTreasury
/// @notice Collects platform fees (native USDC) and, on `flush`, splits them:
///         `buybackBps` buys $RADIAN on its bonding curve and BURNS it (scarcity),
///         the remainder is streamed to stakers as real USDC yield. This is the
///         closed loop — real revenue in, buyback + real yield out.
contract RadianTreasury {
    address public owner;
    address public keeper; // may call flush (e.g. a cron)
    address public immutable radian; // $RADIAN launcher token (ERC20Burnable)
    address public immutable radianCurve; // its bonding curve (buyback venue)
    IStakingNotify public staking;

    uint16 public buybackBps = 5_000; // 50% buyback+burn, 50% to stakers

    uint256 public totalBurned; // lifetime $RADIAN burned
    uint256 public totalToStakers; // lifetime USDC streamed to stakers
    uint256 public totalFlushed; // lifetime USDC processed

    event Flushed(uint256 usdcIn, uint256 radianBurned, uint256 toStakers);
    event BuybackBpsSet(uint16 bps);
    event StakingSet(address staking);
    event KeeperSet(address keeper);

    modifier onlyOwner() {
        require(msg.sender == owner, "only owner");
        _;
    }

    constructor(address radian_, address radianCurve_, address owner_) {
        require(radian_ != address(0) && radianCurve_ != address(0) && owner_ != address(0), "zero");
        radian = radian_;
        radianCurve = radianCurve_;
        owner = owner_;
    }

    receive() external payable {}

    /// @notice Split the treasury's USDC: buyback+burn + fund staker rewards.
    /// @param minRadianOut slippage guard for the curve buy.
    function flush(uint256 minRadianOut) external returns (uint256 burned, uint256 toStakers) {
        require(msg.sender == owner || msg.sender == keeper, "not keeper");
        require(address(staking) != address(0), "no staking");
        uint256 bal = address(this).balance;
        require(bal > 0, "empty");

        uint256 buyback = (bal * buybackBps) / 10_000;
        toStakers = bal - buyback;

        if (buyback > 0 && !ICurveBuy(radianCurve).graduated()) {
            ICurveBuy(radianCurve).buy{value: buyback}(buyback, minRadianOut, address(this));
            burned = IBurnable(radian).balanceOf(address(this));
            if (burned > 0) {
                IBurnable(radian).burn(burned);
                totalBurned += burned;
            }
        } else {
            // curve graduated (buyback venue moved to V4) — route all to stakers for now
            toStakers = bal;
        }

        if (toStakers > 0) {
            staking.notifyReward{value: toStakers}();
            totalToStakers += toStakers;
        }
        totalFlushed += bal;
        emit Flushed(bal, burned, toStakers);
    }

    // ---- admin ----

    function setStaking(address s) external onlyOwner {
        staking = IStakingNotify(s);
        emit StakingSet(s);
    }

    function setBuybackBps(uint16 bps) external onlyOwner {
        require(bps <= 10_000, "range");
        buybackBps = bps;
        emit BuybackBpsSet(bps);
    }

    function setKeeper(address k) external onlyOwner {
        keeper = k;
        emit KeeperSet(k);
    }

    function transferOwnership(address n) external onlyOwner {
        require(n != address(0), "zero");
        owner = n;
    }
}
