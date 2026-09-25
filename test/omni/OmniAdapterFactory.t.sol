// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {OmniTestBase, EndpointV2Mock} from "./OmniTestBase.sol";
import {GraduationPhase, IPonsV2LaunchFactory} from "../../src/v2/interfaces/ILaunchpadV2.sol";
import {PonsV2LauncherToken} from "../../src/v2/PonsV2LauncherToken.sol";
import {OmniAdapterFactory} from "../../src/omni/OmniAdapterFactory.sol";
import {RadianOFTAdapter} from "../../src/omni/RadianOFTAdapter.sol";

/// The factory is permissionless and idempotent, refuses what the launch
/// factory does not vouch for, and hands ownership to the launch factory's
/// owner. Uses the mock launch factory; OmniAdapterFactoryLive.t.sol repeats
/// the eligibility checks against the real PonsV2LaunchFactory.
contract OmniAdapterFactoryTest is OmniTestBase {
    event AdapterCreated(address indexed token, address indexed adapter, address indexed owner);

    address unknown = makeAddr("unknown");
    PonsV2LauncherToken token2;

    function setUp() public override {
        super.setUp();
        token2 = new PonsV2LauncherToken(
            "Second", "TWO", "", "", PonsV2LauncherToken.Socials("", "", "", "", ""), address(0xD0), alice,
            address(launchFactory), SUPPLY
        );
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(OmniAdapterFactory.ZeroAddress.selector);
        new OmniAdapterFactory(address(0), endpoints[HOME_EID]);
        vm.expectRevert(OmniAdapterFactory.ZeroAddress.selector);
        new OmniAdapterFactory(address(launchFactory), address(0));
        assertEq(address(omni.launchFactory()), address(launchFactory));
        assertEq(omni.endpoint(), endpoints[HOME_EID]);
    }

    function test_refusesUnknownToken() public {
        vm.expectRevert(OmniAdapterFactory.UnknownToken.selector);
        omni.createAdapter(unknown);
        assertFalse(omni.isEligible(unknown));
        assertEq(omni.adapterOf(unknown), address(0));
    }

    function test_refusesRecordForAnotherToken() public {
        // a record that exists under `token2` but names a different token
        IPonsV2LaunchFactory.LaunchedToken memory L = launchFactory.getLaunchedToken(address(token));
        launchFactory.setRecord(address(token2), L);
        vm.expectRevert(OmniAdapterFactory.UnknownToken.selector);
        omni.createAdapter(address(token2));
    }

    function test_refusesUngraduated() public {
        launchFactory.register(address(token2), GraduationPhase.NotGraduated);
        vm.expectRevert(OmniAdapterFactory.NotGraduated.selector);
        omni.createAdapter(address(token2));
        assertFalse(omni.isEligible(address(token2)));

        launchFactory.register(address(token2), GraduationPhase.Swept);
        vm.expectRevert(OmniAdapterFactory.NotGraduated.selector);
        omni.createAdapter(address(token2));

        launchFactory.register(address(token2), GraduationPhase.Rescued);
        vm.expectRevert(OmniAdapterFactory.NotGraduated.selector);
        omni.createAdapter(address(token2));

        launchFactory.register(address(token2), GraduationPhase.PoolCreated);
        assertTrue(omni.isEligible(address(token2)));
        assertTrue(omni.createAdapter(address(token2)) != address(0));
    }

    function test_anyoneMayCreate_andAddressIsPredicted() public {
        launchFactory.register(address(token2), GraduationPhase.PoolCreated);
        address predicted = omni.predictAdapter(address(token2));
        assertEq(predicted.code.length, 0, "not deployed yet");

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectEmit(true, true, true, true, address(omni));
        emit AdapterCreated(address(token2), predicted, owner);
        address created = omni.createAdapter(address(token2));

        assertEq(created, predicted, "CREATE2 address");
        assertGt(created.code.length, 0);
        assertEq(omni.adapterOf(address(token2)), created);
        assertTrue(created != address(adapter), "one adapter per token");
    }

    function test_sameTokenSameAddress_idempotent() public {
        address first = omni.adapterOf(address(token));
        assertEq(first, address(adapter));
        assertEq(omni.predictAdapter(address(token)), first);

        vm.recordLogs();
        address again = omni.createAdapter(address(token));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(again, first, "same address for the same token");
        assertEq(logs.length, 0, "no second deployment, no event");
        assertEq(omni.adapterOf(address(token)), first);
    }

    function test_ownershipLandsOnLaunchFactoryOwner() public view {
        assertEq(adapter.owner(), launchFactory.owner());
        assertEq(adapter.owner(), owner);
        assertEq(adapter.pendingOwner(), address(0));
        assertEq(EndpointV2Mock(endpoints[HOME_EID]).delegates(address(adapter)), owner, "endpoint delegate");
        assertEq(address(adapter.endpoint()), endpoints[HOME_EID]);
        assertEq(adapter.token(), address(token));
        assertFalse(adapter.peersFrozen());
    }

    function test_factoryOwnerChange_appliesToLaterAdaptersOnly() public {
        address safe = makeAddr("safe");
        launchFactory.setOwner(safe);
        assertEq(adapter.owner(), owner, "existing adapter keeps its owner");

        launchFactory.register(address(token2), GraduationPhase.PoolCreated);
        address predicted = omni.predictAdapter(address(token2));
        RadianOFTAdapter a2 = RadianOFTAdapter(omni.createAdapter(address(token2)));
        assertEq(address(a2), predicted);
        assertEq(a2.owner(), safe, "new adapter owned by the new owner");
        assertEq(EndpointV2Mock(endpoints[HOME_EID]).delegates(address(a2)), safe);
    }

    function test_factoryHoldsNothingAndHasNoOwner() public {
        // nothing on the factory is callable by an owner because there is none:
        // its whole surface is createAdapter / predictAdapter / isEligible / adapterOf.
        (bool ok,) = address(omni).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "no owner()");
        assertEq(token.balanceOf(address(omni)), 0);
    }
}
