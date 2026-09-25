// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TestHelperOz5} from "@layerzerolabs/test-devtools-evm-foundry/contracts/TestHelperOz5.sol";
import {EndpointV2Mock} from "@layerzerolabs/test-devtools-evm-foundry/contracts/mocks/EndpointV2Mock.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import {IOFT, SendParam, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {GraduationPhase} from "../../src/v2/interfaces/ILaunchpadV2.sol";
import {PonsV2LauncherToken} from "../../src/v2/PonsV2LauncherToken.sol";
import {RadianOFTAdapter} from "../../src/omni/RadianOFTAdapter.sol";
import {RadianOFT} from "../../src/omni/RadianOFT.sol";
import {OmniAdapterFactory} from "../../src/omni/OmniAdapterFactory.sol";
import {MockLaunchFactory} from "./mocks/MockLaunchFactory.sol";

/// @dev Two LayerZero endpoints from TestHelperOz5 (UltraLightNode mocks: real
///      EndpointV2 / SendUln302 / ReceiveUln302 logic, a mock DVN and executor):
///      eid 1 is home (Robinhood Chain), eid 2 is the remote (Base). The home
///      token is a real PonsV2LauncherToken whose "curve" is `alice`, so she
///      holds the whole supply. The adapter is created through the factory,
///      exactly as on chain; the remote OFT is deployed directly.
abstract contract OmniTestBase is TestHelperOz5 {
    using OptionsBuilder for bytes;

    uint32 constant HOME_EID = 1;
    uint32 constant REMOTE_EID = 2;
    uint128 constant LZ_RECEIVE_GAS = 80_000;
    uint256 constant SUPPLY = 1_000_000_000e18;

    address owner = makeAddr("owner"); // the launch factory's owner: the Safe on mainnet
    address alice = makeAddr("alice"); // home holder
    address bob = makeAddr("bob"); // remote holder
    address carol = makeAddr("carol"); // home recipient of a sell-home

    MockLaunchFactory launchFactory;
    PonsV2LauncherToken token;
    OmniAdapterFactory omni;
    RadianOFTAdapter adapter;
    RadianOFT oft;

    function setUp() public virtual override {
        super.setUp();
        setUpEndpoints(2, LibraryType.UltraLightNode);

        launchFactory = new MockLaunchFactory(owner);
        token = new PonsV2LauncherToken(
            "Robinhood Smoke",
            "RHSMK",
            "",
            "",
            PonsV2LauncherToken.Socials("", "", "", "", ""),
            address(0xD0),
            alice,
            address(launchFactory),
            SUPPLY
        );
        launchFactory.register(address(token), GraduationPhase.PoolCreated);

        omni = new OmniAdapterFactory(address(launchFactory), endpoints[HOME_EID]);
        adapter = RadianOFTAdapter(omni.createAdapter(address(token)));
        oft = new RadianOFT("Robinhood Smoke", "RHSMK", endpoints[REMOTE_EID], owner, HOME_EID, address(token));

        _wire();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    /// @dev What the deploy script does: peers both ways, lzReceive gas enforced both ways.
    function _wire() internal {
        vm.startPrank(owner);
        adapter.setPeer(REMOTE_EID, addressToBytes32(address(oft)));
        oft.setPeer(HOME_EID, addressToBytes32(address(adapter)));
        adapter.setEnforcedOptions(_enforced(REMOTE_EID));
        oft.setEnforcedOptions(_enforced(HOME_EID));
        vm.stopPrank();
    }

    function _enforced(uint32 dstEid) internal pure returns (EnforcedOptionParam[] memory params) {
        bytes memory opts = OptionsBuilder.newOptions().addExecutorLzReceiveOption(LZ_RECEIVE_GAS, 0);
        params = new EnforcedOptionParam[](2);
        params[0] = EnforcedOptionParam(dstEid, 1, opts); // SEND
        params[1] = EnforcedOptionParam(dstEid, 2, opts); // SEND_AND_CALL
    }

    function _sendParam(uint32 dstEid, address to, uint256 amount, uint256 minAmount)
        internal
        pure
        returns (SendParam memory)
    {
        return SendParam(dstEid, addressToBytes32(to), amount, minAmount, "", "", "");
    }

    /// @dev Quote and send through `oapp` as `from`, paying the quoted native fee.
    function _send(IOFT oapp, address from, SendParam memory sp)
        internal
        returns (MessagingReceipt memory msgReceipt, OFTReceipt memory receipt)
    {
        MessagingFee memory fee = oapp.quoteSend(sp, false);
        vm.prank(from);
        (msgReceipt, receipt) = oapp.send{value: fee.nativeFee}(sp, fee, from);
    }

    /// @dev Home → remote: alice locks in the adapter, `to` is minted on the remote.
    function _bridgeOut(address to, uint256 amount) internal returns (OFTReceipt memory receipt) {
        vm.prank(alice);
        IERC20(address(token)).approve(address(adapter), amount);
        (, receipt) = _send(IOFT(address(adapter)), alice, _sendParam(REMOTE_EID, to, amount, 0));
        verifyPackets(REMOTE_EID, addressToBytes32(address(oft)));
    }

    /// @dev Remote → home: `from` burns on the remote, `to` is unlocked at home.
    function _bridgeHome(address from, address to, uint256 amount) internal returns (OFTReceipt memory receipt) {
        (, receipt) = _send(IOFT(address(oft)), from, _sendParam(HOME_EID, to, amount, 0));
        verifyPackets(HOME_EID, addressToBytes32(address(adapter)));
    }

    function _locked() internal view returns (uint256) {
        return token.balanceOf(address(adapter));
    }
}
