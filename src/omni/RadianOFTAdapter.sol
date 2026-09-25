// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title RadianOFTAdapter
/// @notice The home-chain half of a Radian omnichain token: a LayerZero V2
///         `OFTAdapter` that locks a graduated launch token (a
///         `PonsV2LauncherToken`: fixed supply, no owner, 18 decimals) and
///         lets a `RadianOFT` on every remote chain mint against it. The home
///         token is never modified: its pool, its holders and its supply do
///         not depend on this contract. A remote balance is a claim on tokens
///         locked here.
///
///         Only one adapter may exist per token on a mesh (a second one would
///         split the supply into incompatible representations). The canonical
///         adapter is the one `OmniAdapterFactory` deploys at the CREATE2
///         address for the token; nothing stops someone else deploying
///         another, so the web and the indexer only ever list the factory's.
///
///         Ownership, honestly: the owner (and the endpoint-level delegate,
///         set to the same address at construction) holds `setPeer`,
///         `setEnforcedOptions`, `setDelegate` and, on the endpoint,
///         `setConfig` (which DVNs verify and which executor delivers).
///         Those powers are real, so the owner is the Radian Safe on mainnet.
///         Two guards on top of stock LayerZero:
///         - `freezePeers()` is one-way. After it, `setPeer` reverts forever:
///           the owner can still rotate DVNs or libraries when LayerZero rolls
///           one forward, but can never re-route the locked supply to another
///           contract.
///         - `renounceOwnership` is disabled and transfers are two-step
///           (`Ownable2Step`). An owner-less adapter could never follow a
///           library deprecation and would strand every remote holder; a
///           mistyped transfer would do the same.
contract RadianOFTAdapter is OFTAdapter, Ownable2Step {
    /// @notice Once true, `setPeer` reverts for good.
    bool public peersFrozen;

    event PeersFrozen();

    error PeersAreFrozen();
    error OwnershipCannotBeRenounced();

    /// @param token_ the graduated launch token to lock (must expose `decimals()`)
    /// @param endpoint_ this chain's LayerZero EndpointV2
    /// @param owner_ owner and endpoint delegate: the Safe on mainnet, the deployer on a testnet
    constructor(address token_, address endpoint_, address owner_)
        OFTAdapter(token_, endpoint_, owner_)
        Ownable(owner_)
    {}

    /// @notice Lock the peer table forever. Call once every pathway has been
    ///         wired and verified end to end.
    function freezePeers() external onlyOwner {
        if (peersFrozen) revert PeersAreFrozen();
        peersFrozen = true;
        emit PeersFrozen();
    }

    /// @notice Set (or clear, with zero) the trusted peer OApp on `eid`. Owner only.
    /// @dev Reverts after `freezePeers()`.
    function setPeer(uint32 eid, bytes32 peer) public override onlyOwner {
        if (peersFrozen) revert PeersAreFrozen();
        _setPeer(eid, peer);
    }

    /// @dev A pathway with no owner can never be repaired; refuse to create one.
    function renounceOwnership() public pure override {
        revert OwnershipCannotBeRenounced();
    }

    /// @dev Two-step handover (Ownable2Step) on top of the OApp's Ownable.
    function transferOwnership(address newOwner) public override(Ownable, Ownable2Step) onlyOwner {
        Ownable2Step.transferOwnership(newOwner);
    }

    function _transferOwnership(address newOwner) internal override(Ownable, Ownable2Step) {
        Ownable2Step._transferOwnership(newOwner);
    }
}
