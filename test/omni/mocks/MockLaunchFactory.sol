// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPonsV2LaunchFactory, GraduationPhase} from "../../../src/v2/interfaces/ILaunchpadV2.sol";

/// @dev The two things OmniAdapterFactory reads from PonsV2LaunchFactory:
///      `getLaunchedToken(token)` and `owner()`. Records are set by the test.
contract MockLaunchFactory {
    address public owner;
    mapping(address => IPonsV2LaunchFactory.LaunchedToken) private _records;

    constructor(address owner_) {
        owner = owner_;
    }

    function setOwner(address owner_) external {
        owner = owner_;
    }

    /// @dev Register `token` as a launch in `phase` with a plausible record.
    function register(address token, GraduationPhase phase) external {
        _records[token] = IPonsV2LaunchFactory.LaunchedToken({
            token: token,
            curve: address(0xC0FFEE),
            deployer: address(0xD0),
            creatorFeeRecipient: address(0xD0),
            pairToken: address(0),
            graduationThreshold: 20e18,
            poolFee: 0,
            tickSpacing: 200,
            creatorTaxBps: 0,
            buybackEnabled: true,
            phase: phase,
            sweptQuote: 0,
            sweptTokens: 0,
            sweptAt: 0,
            exists: true
        });
    }

    /// @dev Store an arbitrary record under `key` (for the mismatch case).
    function setRecord(address key, IPonsV2LaunchFactory.LaunchedToken memory record) external {
        _records[key] = record;
    }

    function getLaunchedToken(address token) external view returns (IPonsV2LaunchFactory.LaunchedToken memory) {
        return _records[token];
    }
}
