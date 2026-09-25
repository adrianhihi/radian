// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title RadianOFT
/// @notice The remote-chain half of a Radian omnichain token (Base, BNB, …):
///         a LayerZero V2 mint/burn `OFT`. Every unit minted here is backed
///         one-for-one by a unit locked in the `RadianOFTAdapter` on the home
///         chain; burning here (an OFT `send` home) unlocks it there. There is
///         no pool on this chain by design ("one pool, one price"): a holder
///         here holds, transfers, or sells by sending home.
///
///         `homeEid` / `homeToken` are reference data for explorers, the
///         indexer and `/verify`; the protocol itself only trusts `peers`.
///         Decimals are 18, like every `PonsV2LauncherToken`; `sharedDecimals`
///         stays at LayerZero's default 6, so amounts cross the wire as
///         `uint64` units of 1e-6 and anything below that is dust the sender
///         keeps (the launch supply of 1e9 fits with room to spare).
///
///         Same ownership guards as the adapter: one-way `freezePeers()`,
///         no `renounceOwnership`, two-step transfers.
contract RadianOFT is OFT, Ownable2Step {
    /// @notice LayerZero endpoint id of the home chain (Robinhood Chain: 30416 mainnet, 40451 testnet).
    uint32 public immutable homeEid;
    /// @notice The launch token on the home chain this OFT represents.
    address public immutable homeToken;

    /// @notice Once true, `setPeer` reverts for good.
    bool public peersFrozen;

    event PeersFrozen();

    error PeersAreFrozen();
    error OwnershipCannotBeRenounced();
    error ZeroHomeToken();

    /// @param name_ token name, normally the home token's
    /// @param symbol_ token symbol, normally the home token's
    /// @param endpoint_ this chain's LayerZero EndpointV2
    /// @param owner_ owner and endpoint delegate: a Safe on mainnet, the deployer on a testnet
    /// @param homeEid_ the home chain's endpoint id
    /// @param homeToken_ the launch token's address on the home chain
    constructor(
        string memory name_,
        string memory symbol_,
        address endpoint_,
        address owner_,
        uint32 homeEid_,
        address homeToken_
    ) OFT(name_, symbol_, endpoint_, owner_) Ownable(owner_) {
        if (homeToken_ == address(0)) revert ZeroHomeToken();
        homeEid = homeEid_;
        homeToken = homeToken_;
    }

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
