// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

interface ILadderTreasury {
    function circulating() external view returns (uint256);
    function reserve() external view returns (uint256);
}

interface ILadderLauncher {
    function keeper() external view returns (address);
    function platformOwner() external view returns (address);
}

interface IWallBurn {
    function burn(uint256) external;
    function balanceOf(address) external view returns (uint256);
}

/// @title WallLadder
/// @notice The post-graduation half of a Stock Treasury launch: the treasury's
///         quote pile becomes a ladder of seven single-sided bids in the
///         token's Uniswap V4 pool, at nominal drawdowns of 5 / 10 / 15 / 20 /
///         30 / 40 / 50% below an anchor. The ladder never swaps: sellers fill
///         it, and everything it is filled with is burned on the next
///         maintenance beat. Freed quote is re-posted.
///
///         Anchor = high-water mark of the token's value, in ticks, that only
///         moves toward higher value and by at most `maxSlewBps` per beat
///         (a dump never lowers it; a wash pump moves it a bounded step). The
///         deepest rung never sits above book value (reserve ÷ circulating),
///         so the ladder always ends at or under the fundamental floor.
///         Allocation: κ = tokens the deepest rung can absorb at its price ÷
///         circulating supply; κ < 1 sends every new dollar to the deep rung,
///         otherwise 40% to the shallow layer, 60% to the middle, with the deep
///         rung floored at 40% of the ladder.
///
///         A fixed keeper bounty is paid last, from an escrow fed by at most
///         `keeperInflowBps` of inflow and capped at 30 bounties; a beat that
///         does nothing pays nothing. Conservation: totalIn == pending +
///         unfilled + converted + keeperEscrow + keeperPaid (view).
contract WallLadder {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct Config {
        uint16 keeperInflowBps; // ≤ 200 (2%) of every deposit feeds the keeper escrow
        uint128 keeperBounty; // quote units per productive beat
        uint32 minInterval; // seconds between beats; ≥ 3600
        uint16 maxSlewBps; // anchor may rise at most this much per beat; ≤ 5000 (≈ ×1.5)
    }

    struct Rung {
        uint256 tokenId; // 0 = no position
        int24 tickLower;
        int24 tickUpper;
        uint256 quoteIn; // quote posted into the position (ledger, not live balance)
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q192 = 1 << 192;
    int24 private constant DEEP_OFFSET = 6931; // ln(2)/ln(1.0001): the −50% rung
    uint256 private constant ESCROW_CAP_X = 30;

    // ---- identity ----
    address public launcher;
    address public treasury;
    address public token;
    address public quote; // address(0) = native
    IPoolManager public poolManager;
    IPositionManager public positionManager;
    IAllowanceTransfer public permit2;
    PoolKey public key;
    bool public quoteIsCurrency0;
    int24 public spacing;
    Config public config;
    bool public initialized;

    // ---- ladder state ----
    uint32 public generation;
    bool public anchored;
    int24 public anchorW; // anchor in "value ticks": higher = higher token value
    Rung[7] public rungs;
    uint256 public pending; // quote waiting to be posted
    uint256 public keeperEscrow;
    uint64 public lastPokeAt;

    // ---- ledger (quote units) ----
    uint256 public totalIn;
    uint256 public totalConverted; // quote that became tokens (then burned)
    uint256 public keeperPaid;
    uint256 public totalBurned; // tokens burned

    uint256 private _lock = 1;

    event Initialized(address token, address quote, PoolId poolId, Config config);
    event Deposited(uint256 amount, uint256 toEscrow);
    event Anchored(uint32 indexed generation, int24 anchorTick, int24 spotTick, bool reset);
    event RungPosted(uint32 indexed generation, uint8 indexed rung, uint256 tokenId, int24 tickLower, int24 tickUpper, uint256 quoteIn);
    event RungHarvested(uint32 indexed generation, uint8 indexed rung, uint256 tokenId, uint256 quoteBack, uint256 tokensBurned);
    event Beat(address indexed keeper, uint256 harvested, uint256 posted, uint256 bounty);

    error NotKeeper();
    error TooSoon();
    error PoolNotLive();
    error NotTreasury();
    error BadValue();

    modifier nonReentrant() {
        require(_lock != 2, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    function initialize(
        address launcher_,
        address treasury_,
        address token_,
        address quote_,
        address poolManager_,
        address positionManager_,
        address permit2_,
        address hooks_,
        uint24 fee_,
        int24 tickSpacing_,
        Config calldata cfg
    ) external {
        require(!initialized, "initialized");
        require(treasury_ != address(0) && token_ != address(0) && poolManager_ != address(0) && positionManager_ != address(0), "zero");
        require(cfg.keeperInflowBps <= 200 && cfg.minInterval >= 3600 && cfg.maxSlewBps <= 5000 && cfg.maxSlewBps > 0, "config");
        require(tickSpacing_ > 0, "spacing");
        initialized = true;
        launcher = launcher_;
        treasury = treasury_;
        token = token_;
        quote = quote_;
        poolManager = IPoolManager(poolManager_);
        positionManager = IPositionManager(positionManager_);
        permit2 = IAllowanceTransfer(permit2_);
        spacing = tickSpacing_;
        config = cfg;
        (Currency c0, Currency c1, bool q0) = quote_ < token_
            ? (Currency.wrap(quote_), Currency.wrap(token_), true)
            : (Currency.wrap(token_), Currency.wrap(quote_), false);
        quoteIsCurrency0 = q0;
        key = PoolKey({currency0: c0, currency1: c1, fee: fee_, tickSpacing: tickSpacing_, hooks: IHooks(hooks_)});
        emit Initialized(token_, quote_, key.toId(), cfg);
    }

    // ---- funding ----

    /// @notice The treasury hands over quote. `keeperInflowBps` of it feeds the
    ///         keeper escrow (capped), the rest waits to be posted on the next beat.
    function deposit(uint256 amount) external payable nonReentrant {
        if (msg.sender != treasury) revert NotTreasury();
        if (quote == address(0)) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            uint256 before = IERC20(quote).balanceOf(address(this));
            IERC20(quote).safeTransferFrom(msg.sender, address(this), amount);
            amount = IERC20(quote).balanceOf(address(this)) - before;
        }
        uint256 cap = uint256(config.keeperBounty) * ESCROW_CAP_X;
        uint256 toEscrow = (amount * config.keeperInflowBps) / BPS;
        if (keeperEscrow + toEscrow > cap) toEscrow = cap > keeperEscrow ? cap - keeperEscrow : 0;
        keeperEscrow += toEscrow;
        pending += amount - toEscrow;
        totalIn += amount;
        emit Deposited(amount, toEscrow);
    }

    // ---- views ----

    function currentTick() public view returns (int24 tick, bool live) {
        (uint160 sqrtP, int24 t,,) = poolManager.getSlot0(key.toId());
        return (t, sqrtP != 0);
    }

    function anchorTick() public view returns (int24) {
        return _tickOf(anchorW);
    }

    /// @notice Quote posted in positions, by the ledger (a partially filled rung
    ///         counts in full until it is harvested).
    function unfilledQuote() public view returns (uint256 s) {
        for (uint256 i = 0; i < 7; i++) s += rungs[i].quoteIn;
    }

    /// @notice All quote this ladder is responsible for.
    function quoteHeld() public view returns (uint256) {
        return pending + unfilledQuote() + keeperEscrow;
    }

    /// @notice Book value in quote units per 1e18 tokens: treasury pile + ladder, over circulating.
    function bookValue() public view returns (uint256) {
        uint256 c = ILadderTreasury(treasury).circulating();
        if (c == 0) return 0;
        return ((ILadderTreasury(treasury).reserve() + quoteHeld()) * 1e18) / c;
    }

    /// @notice Anchor price in quote units per 1e18 tokens (0 before the first anchor).
    function anchorPrice() public view returns (uint256) {
        if (!anchored) return 0;
        return _pricePer1e18(TickMath.getSqrtPriceAtTick(_tickOf(anchorW)));
    }

    /// @notice totalIn − (pending + unfilled + converted + escrow + paid); zero when the books close.
    function ledgerGap() external view returns (int256) {
        return int256(totalIn) - int256(pending + unfilledQuote() + totalConverted + keeperEscrow + keeperPaid);
    }

    // ---- the beat ----

    /// @notice Maintenance: harvest filled rungs (burn what they bought), ratchet
    ///         the anchor, migrate survivors if it moved, post pending quote, pay
    ///         the bounty last — and only for a beat that did something.
    function poke() external nonReentrant returns (uint256 harvested, uint256 posted) {
        if (msg.sender != ILadderLauncher(launcher).keeper() && msg.sender != ILadderLauncher(launcher).platformOwner()) revert NotKeeper();
        if (lastPokeAt != 0 && block.timestamp < uint256(lastPokeAt) + config.minInterval) revert TooSoon();
        (int24 spot, bool live) = currentTick();
        if (!live) revert PoolNotLive();
        int24 wSpot = _wOf(spot);

        // 1. harvest every rung the market has reached — crossed or partly
        //    filled (the spot sits inside it): what it bought is burned, the
        //    unfilled quote returns to pending and is re-posted once the band is
        //    clear again. Rungs still entirely on the bid side stand.
        bool anyPlaced;
        for (uint8 i = 0; i < 7; i++) {
            Rung storage r = rungs[i];
            if (r.tokenId == 0) continue;
            if (_touched(r, spot)) {
                harvested += _harvest(i);
            } else {
                anyPlaced = true;
            }
        }

        // 2. anchor: first beat / stall re-base / ratchet up with a slew cap, capped by book value
        bool reset;
        if (!anchored) {
            anchorW = wSpot;
            anchored = true;
            reset = true;
        } else if (!anyPlaced && wSpot < anchorW - DEEP_OFFSET - spacing) {
            // the market fell through the whole ladder and nothing stands: new generation at the spot
            generation += 1;
            anchorW = wSpot;
            reset = true;
        } else if (wSpot > anchorW) {
            int24 slew = _slewTicks();
            anchorW = wSpot - anchorW > slew ? anchorW + slew : wSpot;
        }
        int24 bookW;
        bool haveBook;
        (bookW, haveBook) = _bookW();
        if (haveBook && anchorW > bookW + DEEP_OFFSET) anchorW = bookW + DEEP_OFFSET; // the −50% rung never above book
        emit Anchored(generation, _tickOf(anchorW), spot, reset);

        // 3. migrate: if the anchor moved, every standing rung is pulled and re-posted below the new anchor
        for (uint8 i = 0; i < 7; i++) {
            Rung storage r = rungs[i];
            if (r.tokenId == 0) continue;
            (int24 lo, int24 hi) = _rungTicks(i);
            if (lo != r.tickLower || hi != r.tickUpper) harvested += _harvest(i);
        }

        // 4. post pending quote
        posted = _post(spot);

        // 5. bounty, last, only for a productive beat
        uint256 bounty;
        if (harvested > 0 || posted > 0 || reset) {
            bounty = config.keeperBounty;
            if (bounty > keeperEscrow) bounty = keeperEscrow;
            if (bounty > 0) {
                keeperEscrow -= bounty;
                keeperPaid += bounty;
                _pay(msg.sender, bounty);
            }
        }
        lastPokeAt = uint64(block.timestamp);
        emit Beat(msg.sender, harvested, posted, bounty);
    }

    // ---- internals: geometry ----

    /// @dev "value ticks": higher = higher token value, regardless of currency order.
    function _wOf(int24 tick) private view returns (int24) {
        return quoteIsCurrency0 ? -tick : tick;
    }

    function _tickOf(int24 w) private view returns (int24) {
        return quoteIsCurrency0 ? -w : w;
    }

    function _offset(uint8 i) private pure returns (int24) {
        // ln(1/(1−d)) / ln(1.0001) for d = 5, 10, 15, 20, 30, 40, 50%
        if (i == 0) return 513;
        if (i == 1) return 1054;
        if (i == 2) return 1625;
        if (i == 3) return 2231;
        if (i == 4) return 3567;
        if (i == 5) return 5108;
        return 6931;
    }

    function _slewTicks() private view returns (int24) {
        // ln(1 + maxSlewBps/1e4) / ln(1.0001), linearised well enough for ≤ 50%: use exact table points
        uint256 b = config.maxSlewBps;
        if (b >= 5000) return 4055; // ×1.5
        if (b >= 2500) return 2231; // ×1.25
        if (b >= 1000) return 953; // ×1.10
        return int24(int256((b * 953) / 1000)); // ≈ linear below 10%
    }

    /// @dev Rung i spans one tick spacing just below its nominal drawdown from the anchor.
    function _rungTicks(uint8 i) private view returns (int24 lo, int24 hi) {
        int24 wTop = anchorW - _offset(i);
        int24 t = _tickOf(wTop);
        if (quoteIsCurrency0) {
            lo = _ceilTo(t);
            hi = lo + spacing;
        } else {
            hi = _floorTo(t);
            lo = hi - spacing;
        }
    }

    function _ceilTo(int24 t) private view returns (int24) {
        int24 r = t % spacing;
        if (r == 0) return t;
        return r > 0 ? t - r + spacing : t - r;
    }

    function _floorTo(int24 t) private view returns (int24) {
        int24 r = t % spacing;
        if (r == 0) return t;
        return r > 0 ? t - r : t - r - spacing;
    }

    /// @dev A quote-only position must sit entirely on the bid side of the spot.
    function _placeable(int24 lo, int24 hi, int24 spot) private view returns (bool) {
        return quoteIsCurrency0 ? lo > spot : hi <= spot;
    }

    /// @dev The spot has entered or passed the rung (it is no longer a pure bid).
    function _touched(Rung storage r, int24 spot) private view returns (bool) {
        return quoteIsCurrency0 ? spot >= r.tickLower : spot < r.tickUpper;
    }

    function _pricePer1e18(uint160 sqrtP) private view returns (uint256) {
        // quote units per 1e18 tokens
        if (quoteIsCurrency0) {
            // pool price = token per quote → invert
            return Math.mulDiv(Math.mulDiv(1e18, Q96, sqrtP), Q96, sqrtP);
        }
        return Math.mulDiv(Math.mulDiv(1e18, sqrtP, Q96), sqrtP, Q96);
    }

    function _bookW() private view returns (int24 w, bool ok) {
        uint256 bv = bookValue();
        if (bv == 0) return (0, false);
        uint256 s = quoteIsCurrency0 ? Math.sqrt(Math.mulDiv(1e18, Q192, bv)) : Math.sqrt(Math.mulDiv(bv, Q192, 1e18));
        if (s <= TickMath.MIN_SQRT_PRICE) s = TickMath.MIN_SQRT_PRICE + 1;
        if (s >= TickMath.MAX_SQRT_PRICE) s = TickMath.MAX_SQRT_PRICE - 1;
        return (_wOf(TickMath.getTickAtSqrtPrice(uint160(s))), true);
    }

    // ---- internals: positions ----

    function _post(int24 spot) private returns (uint256 posted) {
        uint256 fund = pending;
        if (fund == 0) return 0;
        // κ: can the deep rung absorb the float at its price?
        uint256 circ = ILadderTreasury(treasury).circulating();
        uint256 aP = anchorPrice();
        uint256 deepTokens = aP == 0 ? 0 : (rungs[6].quoteIn * 2 * 1e18) / aP;
        uint256 toL3;
        uint256 toL1;
        uint256 toL2;
        if (circ == 0 || deepTokens < circ) {
            toL3 = fund;
        } else {
            toL1 = (fund * 40) / 100;
            toL2 = fund - toL1;
            // the deep rung is floored at 40% of the whole ladder
            uint256 total = unfilledQuote() + fund;
            uint256 floorL3 = (total * 40) / 100;
            uint256 l3After = rungs[6].quoteIn + toL3;
            if (l3After < floorL3) {
                uint256 need = floorL3 - l3After;
                uint256 fromL2 = need > toL2 ? toL2 : need;
                toL2 -= fromL2;
                need -= fromL2;
                uint256 fromL1 = need > toL1 ? toL1 : need;
                toL1 -= fromL1;
                toL3 += fromL2 + fromL1;
            }
        }
        posted += _postLayer(6, 6, toL3, spot);
        posted += _postLayer(0, 2, toL1, spot);
        posted += _postLayer(3, 5, toL2, spot);
    }

    /// @dev Splits `amount` equally over the empty, placeable rungs of a layer; the
    ///      rest stays pending (a band the spot currently sits in is skipped until clear).
    function _postLayer(uint8 from, uint8 to, uint256 amount, int24 spot) private returns (uint256 posted) {
        if (amount == 0) return 0;
        uint8 n;
        for (uint8 i = from; i <= to; i++) {
            if (rungs[i].tokenId != 0) continue;
            (int24 lo, int24 hi) = _rungTicks(i);
            if (_placeable(lo, hi, spot)) n++;
        }
        if (n == 0) return 0;
        uint256 each = amount / n;
        for (uint8 i = from; i <= to; i++) {
            if (rungs[i].tokenId != 0) continue;
            (int24 lo, int24 hi) = _rungTicks(i);
            if (!_placeable(lo, hi, spot)) continue;
            posted += _mint(i, lo, hi, each);
        }
    }

    function _mint(uint8 i, int24 lo, int24 hi, uint256 amount) private returns (uint256 used) {
        if (amount == 0 || amount > pending) return 0;
        uint160 sA = TickMath.getSqrtPriceAtTick(lo);
        uint160 sB = TickMath.getSqrtPriceAtTick(hi);
        uint128 liquidity = quoteIsCurrency0
            ? LiquidityAmounts.getLiquidityForAmount0(sA, sB, amount)
            : LiquidityAmounts.getLiquidityForAmount1(sA, sB, amount);
        if (liquidity == 0) return 0;
        uint256 before = _quoteBalance();
        uint256 tokenId = positionManager.nextTokenId();
        bool native = quote == address(0);
        if (!native) {
            IERC20(quote).forceApprove(address(permit2), amount);
            permit2.approve(quote, address(positionManager), uint160(amount), uint48(block.timestamp + 300));
        }
        bytes memory actions = native
            ? abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR), uint8(Actions.SWEEP))
            : abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](native ? 3 : 2);
        params[0] = abi.encode(
            key,
            lo,
            hi,
            uint256(liquidity),
            uint128(quoteIsCurrency0 ? amount : 0),
            uint128(quoteIsCurrency0 ? 0 : amount),
            address(this),
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        if (native) params[2] = abi.encode(key.currency0, address(this));
        positionManager.modifyLiquidities{value: native ? amount : 0}(abi.encode(actions, params), block.timestamp + 300);
        if (!native) {
            IERC20(quote).forceApprove(address(permit2), 0);
            permit2.approve(quote, address(positionManager), 0, 0);
        }
        used = before - _quoteBalance(); // what the position actually took
        rungs[i] = Rung({tokenId: tokenId, tickLower: lo, tickUpper: hi, quoteIn: used});
        pending -= used;
        emit RungPosted(generation, i, tokenId, lo, hi, used);
    }

    function _harvest(uint8 i) private returns (uint256 quoteBack) {
        Rung storage r = rungs[i];
        uint256 tokenId = r.tokenId;
        uint256 qBefore = _quoteBalance();
        uint256 tBefore = IWallBurn(token).balanceOf(address(this));
        bytes memory actions = abi.encodePacked(uint8(Actions.BURN_POSITION), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp + 300);
        quoteBack = _quoteBalance() - qBefore;
        uint256 got = IWallBurn(token).balanceOf(address(this)) - tBefore;
        uint256 posted_ = r.quoteIn;
        // what did not come back as quote was converted into tokens
        totalConverted += posted_ > quoteBack ? posted_ - quoteBack : 0;
        pending += quoteBack;
        if (got > 0) {
            IWallBurn(token).burn(got);
            totalBurned += got;
        }
        emit RungHarvested(generation, i, tokenId, quoteBack, got);
        delete rungs[i];
    }

    function _quoteBalance() private view returns (uint256) {
        return quote == address(0) ? address(this).balance : IERC20(quote).balanceOf(address(this));
    }

    function _pay(address to, uint256 amount) private {
        if (quote == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "send failed");
        } else {
            IERC20(quote).safeTransfer(to, amount);
        }
    }

    function onERC721Received(address, address, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == address(positionManager), "not position manager");
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
