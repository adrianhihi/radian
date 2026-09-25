// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OmniTestBase} from "./OmniTestBase.sol";
import {RadianOFTAdapter} from "../../src/omni/RadianOFTAdapter.sol";
import {RadianOFT} from "../../src/omni/RadianOFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// freezePeers is one-way and owner-only; ownership cannot be renounced and
/// moves in two steps. Freezing does not disturb a wired pathway.
contract FreezePeersTest is OmniTestBase {
    address stranger = makeAddr("stranger");
    address newOwner = makeAddr("newOwner");

    event PeersFrozen();

    function test_adapter_freezeBlocksSetPeer() public {
        assertFalse(adapter.peersFrozen());
        vm.prank(owner);
        vm.expectEmit(true, true, true, true, address(adapter));
        emit PeersFrozen();
        adapter.freezePeers();
        assertTrue(adapter.peersFrozen());

        vm.prank(owner);
        vm.expectRevert(RadianOFTAdapter.PeersAreFrozen.selector);
        adapter.setPeer(REMOTE_EID, addressToBytes32(address(0xBAD)));
        vm.prank(owner);
        vm.expectRevert(RadianOFTAdapter.PeersAreFrozen.selector);
        adapter.setPeer(3, addressToBytes32(address(0xBAD)));
        vm.prank(owner);
        vm.expectRevert(RadianOFTAdapter.PeersAreFrozen.selector);
        adapter.setPeer(REMOTE_EID, bytes32(0)); // cannot even clear

        assertEq(adapter.peers(REMOTE_EID), addressToBytes32(address(oft)), "peer intact");
    }

    function test_oft_freezeBlocksSetPeer() public {
        vm.prank(owner);
        oft.freezePeers();
        vm.prank(owner);
        vm.expectRevert(RadianOFT.PeersAreFrozen.selector);
        oft.setPeer(HOME_EID, addressToBytes32(address(0xBAD)));
        assertEq(oft.peers(HOME_EID), addressToBytes32(address(adapter)));
    }

    function test_freeze_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        adapter.freezePeers();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        oft.freezePeers();
    }

    function test_freeze_twiceReverts() public {
        vm.startPrank(owner);
        adapter.freezePeers();
        vm.expectRevert(RadianOFTAdapter.PeersAreFrozen.selector);
        adapter.freezePeers();
        vm.stopPrank();
    }

    function test_frozenPathwayStillMoves() public {
        vm.startPrank(owner);
        adapter.freezePeers();
        oft.freezePeers();
        vm.stopPrank();
        _bridgeOut(bob, 10e18);
        _bridgeHome(bob, carol, 4e18);
        assertEq(oft.balanceOf(bob), 6e18);
        assertEq(token.balanceOf(carol), 4e18);
    }

    function test_setPeer_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        adapter.setPeer(REMOTE_EID, addressToBytes32(stranger));
    }

    function test_renounceOwnership_disabled() public {
        vm.prank(owner);
        vm.expectRevert(RadianOFTAdapter.OwnershipCannotBeRenounced.selector);
        adapter.renounceOwnership();
        vm.prank(owner);
        vm.expectRevert(RadianOFT.OwnershipCannotBeRenounced.selector);
        oft.renounceOwnership();
        assertEq(adapter.owner(), owner);
        assertEq(oft.owner(), owner);
    }

    function test_ownershipMovesInTwoSteps() public {
        vm.prank(owner);
        adapter.transferOwnership(newOwner);
        assertEq(adapter.owner(), owner, "unchanged until accepted");
        assertEq(adapter.pendingOwner(), newOwner);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        adapter.acceptOwnership();
        vm.prank(newOwner);
        adapter.acceptOwnership();
        assertEq(adapter.owner(), newOwner);
        assertEq(adapter.pendingOwner(), address(0));

        // the new owner can freeze; the old one cannot
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        adapter.freezePeers();
        vm.prank(newOwner);
        adapter.freezePeers();
        assertTrue(adapter.peersFrozen());
    }
}
