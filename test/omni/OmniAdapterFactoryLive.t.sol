// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PonsV2IntegrationTest} from "../PonsV2Integration.t.sol";
import {PonsV2BondingCurve} from "../../src/v2/PonsV2BondingCurve.sol";
import {GraduationPhase, IPonsV2LaunchFactory} from "../../src/v2/interfaces/ILaunchpadV2.sol";
import {EndpointV2Mock} from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import {OmniAdapterFactory} from "../../src/omni/OmniAdapterFactory.sol";
import {RadianOFTAdapter} from "../../src/omni/RadianOFTAdapter.sol";

/// The eligibility rule against the real PonsV2LaunchFactory on the V2
/// harness (real curve, real graduation into a V4 pool): a launch still on
/// its curve is refused, the same launch is accepted once its pool exists,
/// and the adapter's owner is the launch factory's owner.
contract OmniAdapterFactoryLiveTest is PonsV2IntegrationTest {
    EndpointV2Mock endpoint;
    OmniAdapterFactory omni;

    function setUp() public override {
        super.setUp();
        endpoint = new EndpointV2Mock(40451, address(this));
        omni = new OmniAdapterFactory(address(factory), address(endpoint));
    }

    function _graduate() internal {
        vm.warp(block.timestamp + 16);
        vm.prank(alice);
        PonsV2BondingCurve(curve).buy{value: 40e18}(40e18, 0, alice);
        if (!locker.isLocked(token)) factory.createGraduatedPool(token);
        assertTrue(locker.isLocked(token), "pool created");
    }

    function test_refusesWhileOnCurve() public {
        IPonsV2LaunchFactory.LaunchedToken memory L = factory.getLaunchedToken(token);
        assertTrue(L.exists);
        assertTrue(L.phase == GraduationPhase.NotGraduated);
        assertFalse(omni.isEligible(token));
        vm.expectRevert(OmniAdapterFactory.NotGraduated.selector);
        omni.createAdapter(token);
    }

    function test_refusesUnknownToken() public {
        vm.expectRevert(OmniAdapterFactory.UnknownToken.selector);
        omni.createAdapter(makeAddr("not-a-launch"));
    }

    function test_createsOnceThePoolExists() public {
        _graduate();
        assertTrue(factory.getLaunchedToken(token).phase == GraduationPhase.PoolCreated);
        assertTrue(omni.isEligible(token));

        address predicted = omni.predictAdapter(token);
        RadianOFTAdapter adapter = RadianOFTAdapter(omni.createAdapter(token));
        assertEq(address(adapter), predicted);
        assertEq(adapter.owner(), factory.owner(), "owned by the launch factory's owner");
        assertEq(adapter.owner(), owner);
        assertEq(endpoint.delegates(address(adapter)), owner, "endpoint delegate");
        assertEq(adapter.token(), token);
        assertEq(adapter.sharedDecimals(), 6);
        assertEq(omni.createAdapter(token), address(adapter), "idempotent");
    }
}
