// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {OmniTestBase, SendParam, OFTReceipt, MessagingFee, IOFT} from "./OmniTestBase.sol";
import {IOAppCore} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppCore.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";

/// Lock on home → mint on remote → burn on remote → unlock on home, with the
/// amounts and decimals checked to the wei, plus the dust rule and the
/// "locked == remote supply" invariant.
contract OmniRoundTripTest is OmniTestBase {
    using OptionsBuilder for bytes;

    // 1234.567891 tokens: a multiple of 1e12 wei, so exact under 6 shared decimals.
    uint256 constant AMOUNT = 1_234_567_891e12;

    function test_decimals() public view {
        assertEq(token.decimals(), 18, "home token decimals");
        assertEq(oft.decimals(), 18, "remote OFT decimals");
        assertEq(adapter.sharedDecimals(), 6, "adapter shared decimals");
        assertEq(oft.sharedDecimals(), 6, "OFT shared decimals");
        assertEq(adapter.decimalConversionRate(), 1e12);
        assertEq(oft.decimalConversionRate(), 1e12);
        assertEq(adapter.token(), address(token));
        assertEq(oft.token(), address(oft));
        assertTrue(adapter.approvalRequired());
        assertFalse(oft.approvalRequired());
        assertEq(oft.homeEid(), HOME_EID);
        assertEq(oft.homeToken(), address(token));
        assertEq(oft.name(), "Robinhood Smoke");
        assertEq(oft.symbol(), "RHSMK");
    }

    function test_lockHome_mintRemote() public {
        uint256 aliceBefore = token.balanceOf(alice);
        assertEq(oft.totalSupply(), 0);

        OFTReceipt memory r = _bridgeOut(bob, AMOUNT);

        assertEq(r.amountSentLD, AMOUNT, "sent");
        assertEq(r.amountReceivedLD, AMOUNT, "received");
        assertEq(token.balanceOf(alice), aliceBefore - AMOUNT, "alice debited exactly");
        assertEq(_locked(), AMOUNT, "locked in adapter");
        assertEq(oft.balanceOf(bob), AMOUNT, "bob minted exactly");
        assertEq(oft.totalSupply(), AMOUNT, "remote supply");
        assertEq(token.totalSupply(), SUPPLY, "home supply untouched");
    }

    function test_burnRemote_unlockHome() public {
        _bridgeOut(bob, AMOUNT);
        uint256 part = 400e18;

        OFTReceipt memory r = _bridgeHome(bob, carol, part);

        assertEq(r.amountSentLD, part);
        assertEq(r.amountReceivedLD, part);
        assertEq(oft.balanceOf(bob), AMOUNT - part, "bob burned exactly");
        assertEq(oft.totalSupply(), AMOUNT - part, "remote supply shrank");
        assertEq(token.balanceOf(carol), part, "carol unlocked exactly");
        assertEq(_locked(), AMOUNT - part, "adapter released exactly");
        assertEq(_locked(), oft.totalSupply(), "locked == remote supply");
    }

    function test_fullRoundTrip_returnsEverything() public {
        uint256 aliceBefore = token.balanceOf(alice);
        _bridgeOut(bob, AMOUNT);
        _bridgeHome(bob, alice, AMOUNT);
        assertEq(token.balanceOf(alice), aliceBefore, "alice whole again");
        assertEq(_locked(), 0, "nothing left locked");
        assertEq(oft.totalSupply(), 0, "remote supply back to zero");
    }

    function test_manyHops_keepInvariant() public {
        for (uint256 i = 1; i <= 5; i++) {
            _bridgeOut(bob, i * 1e18);
            assertEq(_locked(), oft.totalSupply());
        }
        for (uint256 i = 1; i <= 3; i++) {
            _bridgeHome(bob, carol, i * 1e18);
            assertEq(_locked(), oft.totalSupply());
        }
        assertEq(oft.balanceOf(bob), 15e18 - 6e18);
        assertEq(token.balanceOf(carol), 6e18);
    }

    function test_dustBelowSharedDecimals_staysWithSender() public {
        uint256 dust = 999_999_999_999; // < 1e12
        uint256 aliceBefore = token.balanceOf(alice);
        vm.prank(alice);
        IERC20(address(token)).approve(address(adapter), AMOUNT + dust);
        (, OFTReceipt memory r) = _send(IOFT(address(adapter)), alice, _sendParam(REMOTE_EID, bob, AMOUNT + dust, 0));
        verifyPackets(REMOTE_EID, addressToBytes32(address(oft)));

        assertEq(r.amountSentLD, AMOUNT, "dust removed from the debit");
        assertEq(r.amountReceivedLD, AMOUNT);
        assertEq(token.balanceOf(alice), aliceBefore - AMOUNT, "alice keeps the dust");
        assertEq(oft.balanceOf(bob), AMOUNT);
    }

    function test_minAmountAboveDedusted_reverts() public {
        uint256 dust = 5;
        vm.prank(alice);
        IERC20(address(token)).approve(address(adapter), AMOUNT + dust);
        SendParam memory sp = _sendParam(REMOTE_EID, bob, AMOUNT + dust, AMOUNT + dust);
        vm.expectRevert(abi.encodeWithSelector(IOFT.SlippageExceeded.selector, AMOUNT, AMOUNT + dust));
        adapter.quoteSend(sp, false);
    }

    function test_quoteOFT_limitsAndReceipt() public view {
        SendParam memory sp = _sendParam(REMOTE_EID, bob, AMOUNT, 0);
        (, , OFTReceipt memory r) = adapter.quoteOFT(sp);
        assertEq(r.amountSentLD, AMOUNT);
        assertEq(r.amountReceivedLD, AMOUNT);
    }

    function test_unknownDestination_reverts() public {
        vm.prank(alice);
        IERC20(address(token)).approve(address(adapter), AMOUNT);
        SendParam memory sp = _sendParam(99, bob, AMOUNT, 0);
        vm.expectRevert(abi.encodeWithSelector(IOAppCore.NoPeer.selector, uint32(99)));
        adapter.quoteSend(sp, false);
    }

    function test_enforcedOptionsAloneCarryTheMessage() public view {
        // The sends above pass empty extraOptions: delivery ran on the enforced
        // 80k lzReceive budget, which is what the deploy script sets on chain.
        assertGt(adapter.enforcedOptions(REMOTE_EID, 1).length, 0);
        assertGt(oft.enforcedOptions(HOME_EID, 1).length, 0);
    }

    function test_withoutApproval_reverts() public {
        SendParam memory sp = _sendParam(REMOTE_EID, bob, AMOUNT, 0);
        MessagingFee memory fee = adapter.quoteSend(sp, false);
        vm.prank(alice);
        vm.expectRevert();
        adapter.send{value: fee.nativeFee}(sp, fee, alice);
    }

    function test_onlyPeerCanDeliver() public {
        // If the adapter's peer for the remote is not the OFT, nothing the OFT
        // sends can unlock at home: the endpoint refuses to even open the path
        // for an unknown sender, and the packet waits. Re-pointing the peer
        // lets it through. This is the property freezePeers() makes permanent.
        _bridgeOut(bob, AMOUNT);
        uint256 lockedBefore = _locked();

        vm.prank(owner);
        adapter.setPeer(REMOTE_EID, addressToBytes32(address(0xBAD)));
        _send(IOFT(address(oft)), bob, _sendParam(HOME_EID, carol, 1e18, 0)); // burns on the remote
        assertEq(oft.balanceOf(bob), AMOUNT - 1e18);

        vm.expectRevert();
        this.verifyPackets(HOME_EID, addressToBytes32(address(adapter)));
        assertEq(token.balanceOf(carol), 0, "nothing unlocked");
        assertEq(_locked(), lockedBefore, "nothing released");
        assertTrue(hasPendingPackets(uint16(HOME_EID), addressToBytes32(address(adapter))), "packet waits");

        vm.prank(owner);
        adapter.setPeer(REMOTE_EID, addressToBytes32(address(oft)));
        verifyPackets(HOME_EID, addressToBytes32(address(adapter)));
        assertEq(token.balanceOf(carol), 1e18, "delivered once the peer is right");
        assertEq(_locked(), lockedBefore - 1e18);
    }
}
