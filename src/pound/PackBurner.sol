// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

/// @title PackBurner
/// @notice Holds The Pound's burn pool and spends it, in rotation, on the Pack:
///         a Safe-curated list of existing coins with a Uniswap V4 pool on this
///         chain. `burn` buys the next coin in rotation with `amount` of its
///         quote asset and sends what it bought to the dead address. Each burn
///         is at least the coin's floor and at most its per-burn cap, the fill
///         must land within `maxSlippageBps` of the pool's spot price, and the
///         caller is paid a bounty from the same pool. Burns are keeper-run
///         until `permissionless` is switched on; the checks are the same
///         either way. Deposits come from the PoundVault.
contract PackBurner is Ownable2Step, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    struct Pack {
        address token;
        PoolKey key;
        address asset; // the pool's other currency: the burn pool's asset (address(0) = gas coin)
        uint128 floor; // minimum quote per burn
        uint128 maxPerBurn; // maximum quote per burn (bounds the price impact)
        bool active;
    }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant BPS = 10_000;

    IPoolManager public immutable poolManager;
    Pack[] internal _packs;
    uint256 public cursor; // next rotation index
    uint64 public lastBurnAt;
    uint32 public minInterval = 1 days;
    uint16 public bountyBps = 50;
    uint16 public maxSlippageBps = 500;
    bool public permissionless;
    address public keeper;

    mapping(address asset => uint256) public pool; // burn pool per quote asset
    mapping(address token => uint256) public burnedOf; // tokens sent to DEAD
    mapping(address asset => uint256) public spentOf;

    uint256 private _lock = 1;

    event Deposited(address indexed asset, uint256 amount, address from);
    event PackAdded(uint256 indexed index, address indexed token, address asset, uint128 floor, uint128 maxPerBurn);
    event PackSet(uint256 indexed index, uint128 floor, uint128 maxPerBurn, bool active);
    event Burned(uint256 indexed index, address indexed token, address indexed asset, uint256 quoteIn, uint256 tokensOut, address caller, uint256 bounty);
    event ParamsSet(uint32 minInterval, uint16 bountyBps, uint16 maxSlippageBps, bool permissionless, address keeper);
    event CursorSet(uint256 cursor);

    error NotAllowed();
    error TooSoon();
    error NoActivePack();
    error BadAmount();
    error BelowFloor(uint256 minOut, uint256 floorOut);
    error BadKey();
    error BadValue();

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address poolManager_, address owner_) Ownable(owner_) {
        require(poolManager_ != address(0), "zero");
        poolManager = IPoolManager(poolManager_);
    }

    receive() external payable {}

    // ---- pool ----

    /// @notice Add `amount` of `asset` to the burn pool (the PoundVault calls this).
    function deposit(address asset, uint256 amount) external payable {
        if (asset == address(0)) {
            if (msg.value != amount) revert BadValue();
        } else {
            if (msg.value != 0) revert BadValue();
            uint256 before = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
            amount = IERC20(asset).balanceOf(address(this)) - before;
        }
        pool[asset] += amount;
        emit Deposited(asset, amount, msg.sender);
    }

    // ---- registry ----

    function packCount() external view returns (uint256) {
        return _packs.length;
    }

    function packAt(uint256 i) external view returns (Pack memory) {
        return _packs[i];
    }

    /// @notice The rotation index `burn` would use now, or reverts if nothing is active.
    function nextPack() public view returns (uint256) {
        uint256 n = _packs.length;
        for (uint256 k = 0; k < n; k++) {
            uint256 i = (cursor + k) % n;
            if (_packs[i].active) return i;
        }
        revert NoActivePack();
    }

    function addPack(address token, PoolKey calldata key, uint128 floor, uint128 maxPerBurn) external onlyOwner returns (uint256 index) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address asset;
        if (c0 == token) asset = c1;
        else if (c1 == token) asset = c0;
        else revert BadKey();
        require(floor > 0 && maxPerBurn >= floor, "bounds");
        (uint160 sqrtP,,,) = poolManager.getSlot0(key.toId());
        require(sqrtP != 0, "pool not initialized");
        _packs.push(Pack({token: token, key: key, asset: asset, floor: floor, maxPerBurn: maxPerBurn, active: true}));
        index = _packs.length - 1;
        emit PackAdded(index, token, asset, floor, maxPerBurn);
    }

    function setPack(uint256 index, uint128 floor, uint128 maxPerBurn, bool active) external onlyOwner {
        Pack storage p = _packs[index];
        require(floor > 0 && maxPerBurn >= floor, "bounds");
        p.floor = floor;
        p.maxPerBurn = maxPerBurn;
        p.active = active;
        emit PackSet(index, floor, maxPerBurn, active);
    }

    function setCursor(uint256 c) external onlyOwner {
        require(c < _packs.length, "range");
        cursor = c;
        emit CursorSet(c);
    }

    function setParams(uint32 minInterval_, uint16 bountyBps_, uint16 maxSlippageBps_, bool permissionless_, address keeper_) external onlyOwner {
        require(bountyBps_ <= 200 && maxSlippageBps_ > 0 && maxSlippageBps_ <= 2_000, "range");
        minInterval = minInterval_;
        bountyBps = bountyBps_;
        maxSlippageBps = maxSlippageBps_;
        permissionless = permissionless_;
        keeper = keeper_;
        emit ParamsSet(minInterval_, bountyBps_, maxSlippageBps_, permissionless_, keeper_);
    }

    function renounceOwnership() public pure override {
        revert("renounce disabled");
    }

    // ---- the burn ----

    /// @notice Tokens the pool would hand out for `quoteIn` at its spot price
    ///         (no fee, no impact). The floor a burn's `minOut` must clear.
    function spotOut(uint256 index, uint256 quoteIn) public view returns (uint256) {
        Pack storage p = _packs[index];
        (uint160 sqrtP,,,) = poolManager.getSlot0(p.key.toId());
        bool assetIs0 = Currency.unwrap(p.key.currency0) == p.asset;
        if (assetIs0) {
            // token1 per token0 = (sqrtP / 2^96)^2
            return FullMath.mulDiv(FullMath.mulDiv(quoteIn, sqrtP, FixedPoint96.Q96), sqrtP, FixedPoint96.Q96);
        }
        return FullMath.mulDiv(FullMath.mulDiv(quoteIn, FixedPoint96.Q96, sqrtP), FixedPoint96.Q96, sqrtP);
    }

    /// @notice Buy the next Pack coin with `amount` of its quote asset and burn it.
    ///         `minOut` is the caller's quote and must clear the spot floor.
    function burn(uint256 amount, uint256 minOut) external nonReentrant returns (uint256 index, uint256 tokensOut) {
        if (!permissionless && msg.sender != keeper && msg.sender != owner()) revert NotAllowed();
        if (lastBurnAt != 0 && block.timestamp < uint256(lastBurnAt) + minInterval) revert TooSoon();
        index = nextPack();
        Pack storage p = _packs[index];
        if (amount < p.floor || amount > p.maxPerBurn || amount > pool[p.asset]) revert BadAmount();
        uint256 bounty = (amount * bountyBps) / BPS;
        uint256 quoteIn = amount - bounty;
        uint256 floorOut = (spotOut(index, quoteIn) * (BPS - maxSlippageBps)) / BPS;
        if (minOut < floorOut) revert BelowFloor(minOut, floorOut);

        pool[p.asset] -= amount;
        spentOf[p.asset] += quoteIn;
        tokensOut = abi.decode(poolManager.unlock(abi.encode(index, quoteIn, minOut)), (uint256));
        burnedOf[p.token] += tokensOut;
        if (bounty > 0) _send(p.asset, msg.sender, bounty);
        lastBurnAt = uint64(block.timestamp);
        cursor = (index + 1) % _packs.length;
        emit Burned(index, p.token, p.asset, quoteIn, tokensOut, msg.sender, bounty);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (uint256 index, uint256 quoteIn, uint256 minOut) = abi.decode(data, (uint256, uint256, uint256));
        Pack storage p = _packs[index];
        bool zeroForOne = Currency.unwrap(p.key.currency0) == p.asset;
        BalanceDelta delta = poolManager.swap(
            p.key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(quoteIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 outSigned = zeroForOne ? delta.amount1() : delta.amount0();
        int128 inSigned = zeroForOne ? delta.amount0() : delta.amount1();
        require(outSigned > 0 && inSigned < 0, "bad delta");
        uint256 tokensOut = uint256(uint128(outSigned));
        uint256 owed = uint256(uint128(-inSigned));
        require(tokensOut >= minOut, "slippage");
        // pay the quote
        Currency quote = zeroForOne ? p.key.currency0 : p.key.currency1;
        if (quote.isAddressZero()) {
            poolManager.settle{value: owed}();
        } else {
            poolManager.sync(quote);
            IERC20(Currency.unwrap(quote)).safeTransfer(address(poolManager), owed);
            poolManager.settle();
        }
        // take the coin straight to the dead address
        poolManager.take(zeroForOne ? p.key.currency1 : p.key.currency0, DEAD, tokensOut);
        return abi.encode(tokensOut);
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
