// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {IPonsV2LaunchFactory, GraduationPhase} from "../v2/interfaces/ILaunchpadV2.sol";
import {RadianOFTAdapter} from "./RadianOFTAdapter.sol";

/// @dev The one member of the launch factory's Ownable2Step surface this contract reads.
interface IOwnableLike {
    function owner() external view returns (address);
}

/// @title OmniAdapterFactory
/// @notice Deploys the canonical `RadianOFTAdapter` for a graduated launch
///         token, one per token, at a CREATE2 address anyone can recompute.
///
///         Permissionless by design: `createAdapter(token)` may be called by
///         anyone (the keeper after `PoolGraduated`, a holder, a bot). It
///         refuses a token the launch factory does not know and a token whose
///         graduation has not reached `PoolCreated` (still on the curve, swept
///         but not yet pooled, or rescued): the omnichain layer exists so that
///         remote holders can sell into the home pool, so there must be one.
///
///         Nothing here is configurable and there is no owner. The adapter it
///         deploys is owned by the launch factory's owner at that moment (the
///         Radian Safe on mainnet, the deployer on a testnet), who alone wires
///         peers, picks DVNs and freezes the pathway. The address depends on
///         (this factory, token, endpoint, that owner), so `predictAdapter`
///         is exact for as long as the launch factory's owner is unchanged;
///         an adapter created earlier keeps the owner it was created with.
contract OmniAdapterFactory {
    IPonsV2LaunchFactory public immutable launchFactory;
    /// @notice This chain's LayerZero EndpointV2.
    address public immutable endpoint;

    /// @notice The canonical adapter for a token, or zero if none has been created.
    mapping(address token => address adapter) public adapterOf;

    event AdapterCreated(address indexed token, address indexed adapter, address indexed owner);

    error ZeroAddress();
    error UnknownToken();
    error NotGraduated();

    constructor(address launchFactory_, address endpoint_) {
        if (launchFactory_ == address(0) || endpoint_ == address(0)) revert ZeroAddress();
        launchFactory = IPonsV2LaunchFactory(launchFactory_);
        endpoint = endpoint_;
    }

    /// @notice Deploy the adapter for `token`, or return the existing one.
    ///         Idempotent, so a keeper may simply retry.
    function createAdapter(address token) external returns (address adapter) {
        adapter = adapterOf[token];
        if (adapter != address(0)) return adapter;
        _requireGraduated(token);
        address owner_ = IOwnableLike(address(launchFactory)).owner();
        adapter = address(new RadianOFTAdapter{salt: _salt(token)}(token, endpoint, owner_));
        adapterOf[token] = adapter;
        emit AdapterCreated(token, adapter, owner_);
    }

    /// @notice The address `createAdapter(token)` deploys to, given the launch
    ///         factory's current owner. Does not check eligibility.
    function predictAdapter(address token) external view returns (address) {
        address owner_ = IOwnableLike(address(launchFactory)).owner();
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(RadianOFTAdapter).creationCode, abi.encode(token, endpoint, owner_)));
        return Create2.computeAddress(_salt(token), initCodeHash, address(this));
    }

    /// @notice Whether `createAdapter(token)` would deploy (or has deployed).
    function isEligible(address token) external view returns (bool) {
        if (adapterOf[token] != address(0)) return true;
        IPonsV2LaunchFactory.LaunchedToken memory L = launchFactory.getLaunchedToken(token);
        return L.exists && L.token == token && L.phase == GraduationPhase.PoolCreated;
    }

    function _requireGraduated(address token) private view {
        IPonsV2LaunchFactory.LaunchedToken memory L = launchFactory.getLaunchedToken(token);
        if (!L.exists || L.token != token) revert UnknownToken();
        if (L.phase != GraduationPhase.PoolCreated) revert NotGraduated();
    }

    function _salt(address token) private pure returns (bytes32) {
        return bytes32(uint256(uint160(token)));
    }
}
