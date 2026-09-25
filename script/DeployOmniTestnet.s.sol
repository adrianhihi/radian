// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {OptionsBuilder} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OptionsBuilder.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";
import {SendParam, OFTReceipt} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {OmniAdapterFactory} from "../src/omni/OmniAdapterFactory.sol";
import {RadianOFTAdapter} from "../src/omni/RadianOFTAdapter.sol";
import {RadianOFT} from "../src/omni/RadianOFT.sol";

/// @dev The launch token's ERC-20 surface this script touches (approve for the send, metadata for the OFT).
interface IERC20Like {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function balanceOf(address) external view returns (uint256);
    function allowance(address, address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

/// @notice Omnichain phase 1, testnet demo: RHSMK (a graduated launch on the
///         Robinhood testnet) becomes an OFT on Base Sepolia.
///
///         Two legs, one chain each, both idempotent (re-running skips what is
///         already on chain), each run with that chain's `--rpc-url`:
///
///         Leg A — Robinhood testnet (46630, LayerZero eid 40451):
///           1. deploy OmniAdapterFactory (CREATE2, fixed salt → stable address)
///           2. factory.createAdapter(RHSMK)  (permissionless; owner = the launch factory's owner)
///           3. adapter.setEnforcedOptions(Base Sepolia, lzReceive 80k)  (owner)
///           4. if REMOTE_OFT is set: adapter.setPeer(40245, REMOTE_OFT), then quote
///              and send SEND_AMOUNT (default 1 RHSMK) to the deployer on Base Sepolia,
///              only if the quote succeeds (it does on the testnet, whose default
///              DVN is live; on mainnet the default is the dead DVN and setConfig
///              must come first — see docs/OMNICHAIN_PHASE1.md).
///
///         Leg B — Base Sepolia (84532, eid 40245):
///           1. deploy RadianOFT for RHSMK (CREATE2, salt = RHSMK's address)
///           2. oft.setPeer(40451, HOME_ADAPTER)
///           3. oft.setEnforcedOptions(Robinhood testnet, lzReceive 80k)
///
///         Order: A, then B, then A again with REMOTE_OFT set (wires home + sends).
///
///         Before any broadcast each leg sums the gas of the steps still
///         pending, multiplies by the chain's current gas price with a 2x
///         margin, adds the LayerZero fee when a send is due, and aborts with
///         the exact shortfall if the deployer cannot pay. Nothing secret is
///         printed; the key is only ever read by vm.envUint.
///
/// Env:
///   PRIVATE_KEY            broadcaster (its address must own the launch factory for steps 3–4 of leg A)
///   OMNI_LEG               "A" (Robinhood testnet) or "B" (Base Sepolia)
///   REMOTE_OFT             leg A, optional: the RadianOFT on Base Sepolia (printed by leg B); enables peer + send
///   HOME_ADAPTER           leg B, required: the adapter on the Robinhood testnet (printed by leg A)
///   SEND_AMOUNT            leg A, optional: wei of RHSMK to send once wired (default 1e18; 0 disables the send)
///   ROBINHOOD_TESTNET_RPC  leg B, optional: home RPC read with eth_call to check HOME_ADAPTER and read the token's name
///   BASE_SEPOLIA_RPC       leg A, optional: remote RPC read with eth_call to check REMOTE_OFT before the send
contract DeployOmniTestnet is Script {
    using OptionsBuilder for bytes;

    // Robinhood Chain testnet — docs/OMNICHAIN_FEASIBILITY.md §1, verified on chain 2026-09-24.
    uint256 constant HOME_CHAIN_ID = 46630;
    uint32 constant HOME_EID = 40451;
    address constant HOME_ENDPOINT = 0x3aCAAf60502791D199a5a5F0B173D78229eBFe32;
    address constant HOME_LAUNCH_FACTORY = 0x55622f7eD404f982cb6C5fa12268894A580848F6; // PonsV2LaunchFactory (HANDOFF.md)
    address constant RHSMK = 0x59d27C21C159AbA27206f75009506FC60B220C0E; // "Robinhood Smoke", graduated (PoolCreated)

    // Base Sepolia — LayerZero metadata API (chainKey base-sepolia), 2026-09-24.
    uint256 constant REMOTE_CHAIN_ID = 84532;
    uint32 constant REMOTE_EID = 40245;
    address constant REMOTE_ENDPOINT = 0x6EDCE65403992e310A62460808c4b910D972f10f;

    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 constant FACTORY_SALT = keccak256("radian.omni.adapter-factory.v1");
    uint128 constant LZ_RECEIVE_GAS = 80_000;

    // Gas budgets per step (units), from the forge simulation of this script
    // with a margin; the balance check multiplies them by the live gas price.
    uint256 constant GAS_DEPLOY_FACTORY = 2_900_000;
    uint256 constant GAS_CREATE_ADAPTER = 2_400_000;
    uint256 constant GAS_DEPLOY_OFT = 2_900_000;
    uint256 constant GAS_SET_PEER = 60_000;
    uint256 constant GAS_ENFORCED_OPTIONS = 110_000;
    uint256 constant GAS_APPROVE = 60_000;
    uint256 constant GAS_SEND = 400_000;

    function run() external {
        string memory leg = vm.envString("OMNI_LEG");
        if (_eq(leg, "A")) _legA();
        else if (_eq(leg, "B")) _legB();
        else revert("OMNI_LEG must be A (Robinhood testnet) or B (Base Sepolia)");
    }

    // ------------------------------------------------------------------ leg A

    function _legA() internal {
        require(block.chainid == HOME_CHAIN_ID, "leg A runs against the Robinhood testnet (chain 46630)");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address launchOwner = IOwner(HOME_LAUNCH_FACTORY).owner();
        console.log("== Leg A: Robinhood testnet ==");
        console.log("deployer:            ", deployer);
        console.log("launch factory owner:", launchOwner);

        // ---- what is still pending
        address factoryAddr = _predictedFactory();
        bool deployFactory = factoryAddr.code.length == 0;
        address adapterAddr = deployFactory ? address(0) : OmniAdapterFactory(factoryAddr).adapterOf(RHSMK);
        bool createAdapter = adapterAddr == address(0);
        if (createAdapter) adapterAddr = _predictedAdapter(factoryAddr, launchOwner);
        bytes memory enforced = _lzReceiveOptions();
        bool setEnforced = createAdapter
            || keccak256(RadianOFTAdapter(adapterAddr).enforcedOptions(REMOTE_EID, 1)) != keccak256(enforced);
        address remoteOft = vm.envOr("REMOTE_OFT", address(0));
        bool setPeer = remoteOft != address(0)
            && (createAdapter || RadianOFTAdapter(adapterAddr).peers(REMOTE_EID) != _b32(remoteOft));
        uint256 sendAmount = vm.envOr("SEND_AMOUNT", uint256(1e18));
        bool wantSend = remoteOft != address(0) && sendAmount > 0;

        console.log("factory (CREATE2):   ", factoryAddr, deployFactory ? "(to deploy)" : "(exists)");
        console.log("adapter (CREATE2):   ", adapterAddr, createAdapter ? "(to create)" : "(exists)");
        console.log("remote OFT:          ", remoteOft);
        if (remoteOft != address(0)) {
            console.log("predicted remote OFT:", _predictedRemoteOft(deployer), "(from this deployer, via leg B)");
        }

        if (createAdapter || setEnforced || setPeer) {
            require(
                launchOwner == deployer,
                "the launch factory's owner (printed above) must be the broadcaster for the owner steps"
            );
        }

        // ---- remote checks before a send (plain eth_call against Base Sepolia, no fork)
        if (wantSend) {
            string memory remoteRpc = vm.envOr("BASE_SEPOLIA_RPC", string("https://sepolia.base.org"));
            require(_peekCode(remoteRpc, remoteOft), "REMOTE_OFT has no code on Base Sepolia; run leg B first");
            bytes memory ret = _peekCall(remoteRpc, remoteOft, abi.encodeWithSignature("homeToken()"));
            require(abi.decode(ret, (address)) == RHSMK, "REMOTE_OFT is not the RHSMK OFT");
            ret = _peekCall(remoteRpc, remoteOft, abi.encodeWithSignature("peers(uint32)", HOME_EID));
            require(
                abi.decode(ret, (bytes32)) == _b32(adapterAddr),
                "REMOTE_OFT's home peer is not this adapter; run leg B with HOME_ADAPTER set to it"
            );
        }

        // ---- the LayerZero fee, quoted only once the peer is (or will be) set
        uint256 lzFee;
        bool canSend;
        string memory quoteNote = "no send (REMOTE_OFT unset or SEND_AMOUNT=0)";
        if (wantSend && !createAdapter && !setPeer) {
            (canSend, lzFee, quoteNote) = _quote(adapterAddr, deployer, sendAmount);
        } else if (wantSend) {
            quoteNote = "quote after peer set (below)";
        }

        // ---- balance check, before any broadcast
        uint256 gasUnits = (deployFactory ? GAS_DEPLOY_FACTORY : 0) + (createAdapter ? GAS_CREATE_ADAPTER : 0)
            + (setEnforced ? GAS_ENFORCED_OPTIONS : 0) + (setPeer ? GAS_SET_PEER : 0)
            + (wantSend ? GAS_APPROVE + GAS_SEND : 0);
        _requireBalance("Leg A", deployer, gasUnits, wantSend ? (lzFee > 0 ? lzFee : 0.0002 ether) : 0);
        if (gasUnits == 0) {
            console.log("Nothing to do on the Robinhood testnet.");
            return;
        }

        // ---- broadcast
        vm.startBroadcast(pk);
        OmniAdapterFactory factory_ = deployFactory
            ? new OmniAdapterFactory{salt: FACTORY_SALT}(HOME_LAUNCH_FACTORY, HOME_ENDPOINT)
            : OmniAdapterFactory(factoryAddr);
        require(address(factory_) == factoryAddr, "factory address differs from prediction");
        RadianOFTAdapter adapter = createAdapter
            ? RadianOFTAdapter(factory_.createAdapter(RHSMK))
            : RadianOFTAdapter(adapterAddr);
        require(address(adapter) == adapterAddr, "adapter address differs from prediction");
        if (setEnforced) adapter.setEnforcedOptions(_enforcedFor(REMOTE_EID));
        if (setPeer) adapter.setPeer(REMOTE_EID, _b32(remoteOft));
        vm.stopBroadcast();

        if (wantSend && (createAdapter || setPeer)) {
            (canSend, lzFee, quoteNote) = _quote(adapterAddr, deployer, sendAmount);
        }
        console.log("quote:", quoteNote);
        if (wantSend && canSend) {
            uint256 have = deployer.balance;
            if (have < lzFee + GAS_SEND * _gasPrice() * 2) {
                console.log("send skipped: fee + gas exceed the remaining balance", lzFee, have);
            } else {
                _sendHomeToRemote(pk, adapter, deployer, sendAmount, lzFee);
            }
        }

        console.log("== Leg A done ==");
        console.log("OmniAdapterFactory:", address(factory_));
        console.log("RadianOFTAdapter:  ", address(adapter), "(RHSMK)");
        console.log("adapter owner:     ", adapter.owner());
        console.log("peer 40245:        ", vm.toString(adapter.peers(REMOTE_EID)));
        console.log("Next: leg B on Base Sepolia with HOME_ADAPTER=", address(adapter));
    }

    function _sendHomeToRemote(uint256 pk, RadianOFTAdapter adapter, address deployer, uint256 amount, uint256 fee)
        internal
    {
        SendParam memory sp = _sendParam(deployer, amount);
        vm.startBroadcast(pk);
        if (IERC20Like(RHSMK).allowance(deployer, address(adapter)) < amount) {
            IERC20Like(RHSMK).approve(address(adapter), amount);
        }
        (MessagingReceipt memory mr, OFTReceipt memory r) =
            adapter.send{value: fee}(sp, MessagingFee(fee, 0), deployer);
        vm.stopBroadcast();
        console.log("sent RHSMK home -> Base Sepolia:", r.amountSentLD, "wei; guid:");
        console.logBytes32(mr.guid);
        console.log("track: https://testnet.layerzeroscan.com (search the guid or the tx hash)");
    }

    function _quote(address adapterAddr, address to, uint256 amount)
        internal
        view
        returns (bool ok, uint256 fee, string memory note)
    {
        try RadianOFTAdapter(adapterAddr).quoteSend(_sendParam(to, amount), false) returns (MessagingFee memory f) {
            return (true, f.nativeFee, string.concat("ok, native fee ", _eth(f.nativeFee), " ETH"));
        } catch (bytes memory err) {
            return (false, 0, string.concat("quoteSend reverted (DVN/executor config?): ", vm.toString(err)));
        }
    }

    function _sendParam(address to, uint256 amount) internal pure returns (SendParam memory) {
        // amount is a multiple of 1e12 (6 shared decimals) or the dust stays behind; minAmount = de-dusted amount
        uint256 dedusted = (amount / 1e12) * 1e12;
        return SendParam(REMOTE_EID, _b32(to), amount, dedusted, "", "", "");
    }

    // ------------------------------------------------------------------ leg B

    function _legB() internal {
        require(block.chainid == REMOTE_CHAIN_ID, "leg B runs against Base Sepolia (chain 84532)");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address homeAdapter = vm.envAddress("HOME_ADAPTER");

        console.log("== Leg B: Base Sepolia ==");
        console.log("deployer:    ", deployer);
        console.log("home adapter:", homeAdapter);

        // ---- read the home chain (plain eth_call, no fork): the adapter must exist and wrap RHSMK
        string memory homeRpc = vm.envOr("ROBINHOOD_TESTNET_RPC", string("https://rpc.testnet.chain.robinhood.com"));
        require(_peekCode(homeRpc, homeAdapter), "HOME_ADAPTER has no code on the Robinhood testnet; run leg A first");
        bytes memory ret = _peekCall(homeRpc, homeAdapter, abi.encodeWithSignature("token()"));
        require(abi.decode(ret, (address)) == RHSMK, "HOME_ADAPTER does not wrap RHSMK");
        ret = _peekCall(homeRpc, RHSMK, abi.encodeWithSignature("decimals()"));
        require(abi.decode(ret, (uint8)) == 18, "RHSMK decimals");
        string memory name_ = abi.decode(_peekCall(homeRpc, RHSMK, abi.encodeWithSignature("name()")), (string));
        string memory symbol_ = abi.decode(_peekCall(homeRpc, RHSMK, abi.encodeWithSignature("symbol()")), (string));
        console.log("home token:  ", name_, symbol_);

        // ---- what is still pending
        address oftAddr = _predictedRemoteOft(deployer, name_, symbol_);
        bool deployOft = oftAddr.code.length == 0;
        bool setPeer = deployOft || RadianOFT(oftAddr).peers(HOME_EID) != _b32(homeAdapter);
        bytes memory enforced = _lzReceiveOptions();
        bool setEnforced =
            deployOft || keccak256(RadianOFT(oftAddr).enforcedOptions(HOME_EID, 1)) != keccak256(enforced);
        console.log("OFT (CREATE2):", oftAddr, deployOft ? "(to deploy)" : "(exists)");

        uint256 gasUnits =
            (deployOft ? GAS_DEPLOY_OFT : 0) + (setPeer ? GAS_SET_PEER : 0) + (setEnforced ? GAS_ENFORCED_OPTIONS : 0);
        _requireBalance("Leg B", deployer, gasUnits, 0);
        if (gasUnits == 0) {
            console.log("Nothing to do on Base Sepolia.");
            return;
        }

        vm.startBroadcast(pk);
        RadianOFT oft = deployOft
            ? new RadianOFT{salt: _tokenSalt()}(name_, symbol_, REMOTE_ENDPOINT, deployer, HOME_EID, RHSMK)
            : RadianOFT(oftAddr);
        require(address(oft) == oftAddr, "OFT address differs from prediction");
        if (setPeer) oft.setPeer(HOME_EID, _b32(homeAdapter));
        if (setEnforced) oft.setEnforcedOptions(_enforcedFor(HOME_EID));
        vm.stopBroadcast();

        console.log("== Leg B done ==");
        console.log("RadianOFT:   ", address(oft), "(RHSMK on Base Sepolia)");
        console.log("owner:       ", oft.owner());
        console.log("peer 40451:  ", vm.toString(oft.peers(HOME_EID)));
        console.log("Next: leg A again on the Robinhood testnet with REMOTE_OFT=", address(oft));
    }

    // ------------------------------------------------------------ predictions

    function _predictedFactory() internal pure returns (address) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(OmniAdapterFactory).creationCode, abi.encode(HOME_LAUNCH_FACTORY, HOME_ENDPOINT)));
        return _create2(CREATE2_DEPLOYER, FACTORY_SALT, initHash);
    }

    function _predictedAdapter(address factoryAddr, address owner_) internal pure returns (address) {
        bytes32 initHash =
            keccak256(abi.encodePacked(type(RadianOFTAdapter).creationCode, abi.encode(RHSMK, HOME_ENDPOINT, owner_)));
        return _create2(factoryAddr, _tokenSalt(), initHash);
    }

    function _predictedRemoteOft(address deployer) internal pure returns (address) {
        return _predictedRemoteOft(deployer, "Robinhood Smoke", "RHSMK");
    }

    function _predictedRemoteOft(address deployer, string memory name_, string memory symbol_)
        internal
        pure
        returns (address)
    {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(RadianOFT).creationCode, abi.encode(name_, symbol_, REMOTE_ENDPOINT, deployer, HOME_EID, RHSMK)
            )
        );
        return _create2(CREATE2_DEPLOYER, _tokenSalt(), initHash);
    }

    function _tokenSalt() internal pure returns (bytes32) {
        return bytes32(uint256(uint160(RHSMK)));
    }

    function _create2(address deployer, bytes32 salt, bytes32 initHash) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initHash)))));
    }

    // ---------------------------------------------------------------- options

    function _lzReceiveOptions() internal pure returns (bytes memory) {
        return OptionsBuilder.newOptions().addExecutorLzReceiveOption(LZ_RECEIVE_GAS, 0);
    }

    function _enforcedFor(uint32 dstEid) internal pure returns (EnforcedOptionParam[] memory params) {
        bytes memory opts = _lzReceiveOptions();
        params = new EnforcedOptionParam[](2);
        params[0] = EnforcedOptionParam(dstEid, 1, opts); // SEND
        params[1] = EnforcedOptionParam(dstEid, 2, opts); // SEND_AND_CALL (compose gas comes per-tx in phase 2)
    }

    // ---------------------------------------------------------------- balance

    /// @dev Abort before any broadcast when `who` cannot pay `gasUnits` at twice
    ///      the live gas price plus `extraWei` (the LayerZero fee), naming the amounts.
    function _requireBalance(string memory leg, address who, uint256 gasUnits, uint256 extraWei) internal {
        uint256 price = _gasPrice();
        uint256 needed = gasUnits * price * 2 + extraWei;
        uint256 have = who.balance;
        console.log(
            string.concat(
                leg, ": balance ", _eth(have), " ETH; needs about ", _eth(needed), " ETH (", vm.toString(gasUnits),
                " gas x ", vm.toString(price), " wei x2", extraWei > 0 ? " + LayerZero fee" : "", ")"
            )
        );
        if (have < needed) {
            revert(
                string.concat(
                    leg, " aborted before broadcasting: deployer ", vm.toString(who), " holds ", _eth(have),
                    " ETH on chain ", vm.toString(block.chainid), " but needs about ", _eth(needed),
                    " ETH; short by ", _eth(needed - have), " ETH (", vm.toString(needed - have), " wei). Fund it and rerun."
                )
            );
        }
    }

    /// @dev The chain's current gas price: eth_gasPrice from the RPC, never below the block's base fee.
    function _gasPrice() internal returns (uint256 price) {
        try vm.rpc("eth_gasPrice", "[]") returns (bytes memory raw) {
            price = _toUint(raw);
        } catch {}
        if (price < block.basefee) price = block.basefee;
        if (price == 0) price = 1 gwei;
    }

    function _toUint(bytes memory raw) internal pure returns (uint256 v) {
        require(raw.length <= 32, "quantity too long");
        for (uint256 i = 0; i < raw.length; i++) {
            v = (v << 8) | uint8(raw[i]);
        }
    }

    // ------------------------------------------------------ cross-chain reads

    /// @dev eth_getCode on another chain's RPC (no fork: forge cannot switch
    ///      between an OP-stack fork and another chain inside one script).
    function _peekCode(string memory rpc, address who) internal returns (bool) {
        bytes memory code = vm.rpc(rpc, "eth_getCode", string.concat("[\"", vm.toString(who), "\",\"latest\"]"));
        return code.length > 0;
    }

    /// @dev eth_call on another chain's RPC; reverts with the RPC's message on failure.
    function _peekCall(string memory rpc, address to, bytes memory data) internal returns (bytes memory) {
        return vm.rpc(
            rpc,
            "eth_call",
            string.concat("[{\"to\":\"", vm.toString(to), "\",\"data\":\"", vm.toString(data), "\"},\"latest\"]")
        );
    }

    // ------------------------------------------------------------------ misc

    function _b32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /// @dev wei → "0.000262" style string with 9 decimals, trailing zeros trimmed.
    function _eth(uint256 wei_) internal pure returns (string memory) {
        uint256 whole = wei_ / 1e18;
        uint256 frac = (wei_ % 1e18) / 1e9; // 9 decimals
        bytes memory f = bytes(vm.toString(frac));
        bytes memory padded = new bytes(9);
        for (uint256 i = 0; i < 9; i++) {
            padded[i] = i < 9 - f.length ? bytes1("0") : f[i - (9 - f.length)];
        }
        uint256 end = 9;
        while (end > 1 && padded[end - 1] == "0") end--;
        bytes memory trimmed = new bytes(end);
        for (uint256 i = 0; i < end; i++) {
            trimmed[i] = padded[i];
        }
        return string.concat(vm.toString(whole), ".", string(trimmed));
    }
}

interface IOwner {
    function owner() external view returns (address);
}
