# Omnichain phase 1 — LayerZero OFT for graduated launch tokens

Date: **2026-09-24**. Follows `docs/OMNICHAIN_FEASIBILITY.md` (the decision: LayerZero V2 OFT; option (d) on top of (c)) and `docs/THE_POUND_RESEARCH.md` §1.3 / §2 item 5 ("launch once, trade everywhere: the main pool stays home, holders anywhere can hold and sell"). This document records what phase 1 built, what is on chain, the security-stack choices, what the Safe has to do on mainnet, and the phase-2 list.

## 0. TL;DR

- **Contracts** (`src/omni/`): `RadianOFTAdapter` (home chain, locks the graduated `PonsV2LauncherToken`), `RadianOFT` (remote chains, mint/burn), `OmniAdapterFactory` (permissionless `createAdapter(token)` at a CREATE2 address, one per graduated token, owner = the launch factory's owner). No existing contract changed.
- **Dependency**: LayerZero's audited packages vendored from npm, pinned by version in the directory name (`lib/layerzero/oft-evm-4.0.1` …), with a full OpenZeppelin 5.6.1 copy scoped to that world by context remappings. The 23-file OZ subset the rest of the repo compiles against is untouched; artifact metadata proves each side uses its own copy (§2.3).
- **Tests** (`test/omni/`, 36 tests on LayerZero's `TestHelperOz5`, which runs the real EndpointV2 / SendUln302 / ReceiveUln302 code with a mock DVN and executor): lock → mint → burn → unlock to the wei, dust rule, peer freeze, ownership, factory eligibility against both a mock and the **real** `PonsV2LaunchFactory` on the V2 harness. Whole suite: **190 tests pass** (154 before + 36).
- **Deployed on the Robinhood testnet (46630)**: `OmniAdapterFactory` `0xC2f0972296046D5ED1089d0aA9Ab5611fE039d7c`, `RadianOFTAdapter` for RHSMK `0x81CF3722aA6E4E2b01624C3E803f18B7a8Aee282` (owner = deployer, enforced `lzReceive` 80k towards Base Sepolia). **Base Sepolia leg not deployed**: the deployer holds 0 ETH there; the script's balance check aborts with the exact amount (§4.3). No cross-chain send has happened yet.
- **Mainnet**: `createAdapter` is permissionless; `setPeer` / `setConfig` (DVNs, executor) / `setEnforcedOptions` / `freezePeers` are the Safe's. Robinhood mainnet's default DVN is the dead DVN, so `setConfig` on both ends is mandatory before the first send (§5).

## 1. What was built

### 1.1 `src/omni/RadianOFTAdapter.sol` — home chain

A LayerZero `OFTAdapter` (oft-evm 4.0.1) around a graduated launch token. The token is never modified: no owner, fixed supply, `ERC20Burnable`, its V4 pool and holders do not depend on the adapter. A remote balance is a claim on tokens locked here.

On top of stock LayerZero:

| Addition | Why |
| --- | --- |
| `freezePeers()` — one-way; afterwards `setPeer` reverts (`PeersAreFrozen`), including clearing a peer | The owner keeps the power to rotate DVNs / libraries when LayerZero rolls one forward, but can never re-route the locked supply to another contract. Call it once every pathway is verified end to end. |
| `renounceOwnership()` reverts (`OwnershipCannotBeRenounced`) | An owner-less OApp cannot follow a library deprecation and would strand every remote holder (LayerZero: "renouncing is not recommended"). Same pattern as `PonsV2LaunchLocker`. |
| `Ownable2Step` on top of the OApp's `Ownable` | A mistyped `transferOwnership` cannot brick the mesh; the Safe accepts explicitly. |

Constructor `(token, endpoint, owner)`: `owner` is both the `Ownable` owner and the endpoint-level **delegate** (`endpoint.setDelegate`), so the same address holds `setConfig` / `setSendLibrary` / `setReceiveLibrary` / `skip` / `nilify` on the endpoint. `sharedDecimals` stays at LayerZero's default 6: amounts travel as `uint64` units of 1e-6 tokens (max 1.8e13 tokens; a launch's 1e9 supply fits), and anything below 1e12 wei is dust that stays with the sender (`_removeDust`).

### 1.2 `src/omni/RadianOFT.sol` — remote chains (Base, BNB)

A LayerZero `OFT` (mint on receive, burn on send), 18 decimals like every `PonsV2LauncherToken`, same three guards as the adapter, plus two immutables for explorers, the indexer and `/verify`: `homeEid` and `homeToken`. The protocol itself trusts only `peers`. Constructor `(name, symbol, endpoint, owner, homeEid, homeToken)`. There is no pool on the remote chain by design ("one pool, one price"): a remote holder holds, transfers, or sells by sending home.

### 1.3 `src/omni/OmniAdapterFactory.sol` — home chain

- `createAdapter(token)` — **anyone** may call it (keeper after `PoolGraduated`, a holder, a bot). Refuses a token the launch factory does not know (`UnknownToken`: `!exists` or a record naming another token) and a token whose graduation is not at `PoolCreated` (`NotGraduated`: still on the curve, `Swept` but not yet pooled, or `Rescued`) — the omnichain layer exists so that remote holders can sell into the home pool, so there must be one. Idempotent: a second call returns the existing adapter without deploying or emitting (keepers just retry).
- CREATE2 with `salt = bytes32(uint160(token))`, initcode = `RadianOFTAdapter(token, endpoint, launchFactory.owner())`. `predictAdapter(token)` recomputes it; `isEligible(token)` answers the eligibility rule; `adapterOf[token]` records it; `AdapterCreated(token, adapter, owner)` is the event the indexer decodes.
- The adapter's owner and endpoint delegate are the **launch factory's owner at creation time** (`PonsV2LaunchFactory` is `Ownable2Step`: the Radian Safe on mainnet, the deployer on the testnets). Consequences: the factory itself has no owner and nothing to configure; the CREATE2 address depends on (factory, token, endpoint, that owner), so `predictAdapter` is exact for as long as the launch factory's owner is unchanged, and an adapter created earlier keeps the owner it was created with (a later owner rotation on the launch factory does not move existing adapters — transfer them with `transferOwnership` + `acceptOwnership`).
- "Only one adapter per mesh" is a social fact (anyone can deploy an OFTAdapter around any ERC-20): the canonical one is the factory's, at the predictable address, which the indexer lists and `/verify` code-hash-checks. The web never links another.

Sizes (runtime / initcode): factory 12,185 / 12,441 B; adapter 9,422 / 10,124 B; OFT 11,167 / 12,600 B — all under EIP-170. Measured on the Robinhood testnet: factory deploy **3,034,176 gas**, `createAdapter` **2,066,139 gas**, `setEnforcedOptions` (two message types) **91,737 gas**; at 0.01 gwei that is 0.000052 ETH for a whole token's home side.

## 2. Dependency: how LayerZero is vendored

### 2.1 What and where

The repo manages libs as git submodules (forge-std, v4-core, v4-periphery) or vendored copies (openzeppelin-contracts, v4-hooks-public). LayerZero's `devtools` and `LayerZero-v2` monorepos are large and carry their own OZ, so the published **npm tarballs** were vendored instead — small, exactly pinned, and the same sources the audited releases ship. The version is the directory name, so `remappings.txt` is the pin (it has no comment syntax):

| Package | Version | Path | npm `dist.integrity` |
| --- | --- | --- | --- |
| `@layerzerolabs/oft-evm` | 4.0.1 | `lib/layerzero/oft-evm-4.0.1` | `sha512-GjjfnUbx77TnFFKALVRXJYb1bt1jvarcyyx/AQo6sZfJng5DIqzI9wDxEGlUz03tEnsS6ZOOLBsH+e/hYsruiA==` |
| `@layerzerolabs/oapp-evm` | 0.4.1 | `lib/layerzero/oapp-evm-0.4.1` | `sha512-eOoDepVSrUlVNIlnkH0Vd5Vt4lXBkSBh6Bb16vsLbaN9AryBjy4GDpsE7K4c8iWTFL9BiBXGsV7nJTkgqi+xRQ==` |
| `@layerzerolabs/lz-evm-protocol-v2` | 3.0.168 | `lib/layerzero/lz-evm-protocol-v2-3.0.168` | `sha512-1m9uZDcROJrFjjFZ06J6kmXIqFoJ4r2VH95bL5wsKjkmffNrRYyxbTr2pael7EP8dcq55HpCKc9dg4G1SfTOVQ==` |
| `@layerzerolabs/lz-evm-messagelib-v2` | 3.0.168 | `lib/layerzero/lz-evm-messagelib-v2-3.0.168` | `sha512-tNrpfDu9nhB+/onG3Qzby0PFqi21HpW9dI9oa4HulW5/VfiMQllj2gKOX+BEemokdq2JQhAHvj8dTkp0euXPPg==` |
| `@layerzerolabs/lz-evm-v1-0.7` | 3.0.168 | `lib/layerzero/lz-evm-v1-0.7-3.0.168` (one interface is imported) | `sha512-JE2Ogs7oKFihIcFhsN4MQ9Q9BSjIXzpYd1hztmeW2khKQOtKI8hqClwB6D252NGW1SB8Rr78RTVCcCSceY8ErA==` |
| `@layerzerolabs/test-devtools-evm-foundry` | 8.0.1 | `lib/layerzero/test-devtools-evm-foundry-8.0.1` (`TestHelperOz5` + mocks) | `sha512-oih2mReJJsSjjxFyovcOefgMmHo22f9LocHPuHNV82aGI5Sw+RR+eP6bIOuKPt/8I5cMJfusMJzQJtuvDYQhDg==` |
| `solidity-bytes-utils` | 0.8.4 | `lib/layerzero/solidity-bytes-utils-0.8.4` | `sha512-/bjac5YR12i0plOKvGlhE51F5IWGP6rI8DJetCQlXcnwKWz/Hgf/vr+Qlk1BWz56xVcwVhmhCaDkTMnx5xvt0g==` |
| `@openzeppelin/contracts` (full, for the LayerZero world only) | 5.6.1 | `lib/layerzero/openzeppelin-contracts-5.6.1` | `sha512-Ly6SlsVJ3mj+b18W3R8gNufB7dTICT105fJhodGAGgyC2oqnBAhqSiNDJ8V8DLY05cCz81GLI0CU5vNYA1EC/w==` |

Only `contracts/`, `package.json`, `LICENSE*` and `README.md` were kept from each tarball (465 `.sol` files, 3.5 MB). Re-vendor with `npm pack <pkg>@<ver>` and the same copy. Nothing in the transitive closure needs `@openzeppelin/contracts-upgradeable` or `hardhat-deploy`: the test helper's mocks replace the upgradeable `Executor` / `PriceFeed`, and the message-lib files that need Chainlink / Axelar / Optimism / Arbitrum imports are never imported, so forge never compiles them.

### 2.2 Why a second OpenZeppelin copy, and the one rule

`lib/openzeppelin-contracts` is a deliberate 23-file subset of OZ 5.6.0 (with a newer `SafeERC20`) that the source-identical Pons V2 port compiles against; its bytecode must stay reproducible. LayerZero's endpoint, ULN and test helper need `AccessControl`, `ECDSA`, `ERC165`, `Pausable`, `DoubleEndedQueue` … which the subset does not carry, and completing the subset would touch a vendored, byte-audited directory. So `remappings.txt` scopes `@openzeppelin/contracts/` to the full 5.6.1 copy **only for three contexts**: `lib/layerzero/`, `src/omni/`, `test/omni/`. Every other file keeps the subset. Solc applies the longest matching prefix *within the importing file's context*, so no existing artifact changes.

The rule this creates: **a contract lives in one world.** `src/omni` and `test/omni` files must never import the subset (they cannot, by the remapping), and no contract may inherit both `Ownable`s / `ERC20`s. A test in `test/omni` may *reference* `PonsV2LauncherToken` or `PonsV2LaunchFactory` (they compile in their own world; the ABI is what crosses) — `OmniAdapterFactoryLive.t.sol` does exactly that. `foundry.toml` carries the same note.

### 2.3 Proof the split holds

From the build's artifact metadata (`jq '.metadata.sources | keys' out/<X>.sol/<X>.json`): `PonsV2LaunchFactory` and `CrossBuyReceiver` list `lib/openzeppelin-contracts/contracts/...` only; `RadianOFTAdapter` and `OmniAdapterFactory` list `lib/layerzero/openzeppelin-contracts-5.6.1/contracts/...` only. All 154 pre-existing tests pass unchanged.

One cosmetic side effect: on every `forge build` / `test` / `script` run, foundry-compilers prints ~10 `ERROR … No such file or directory` / `Unable to resolve imports` lines naming `lib/layerzero` files and `@openzeppelin/contracts/utils/Pausable.sol`, `…/AccessControl.sol`, `…/ECDSA.sol` etc. They come from its pre-resolution pass over `lib/`, which applies the global `@openzeppelin/` remapping but not the contexts (the same lines appear with `[lint] lint_on_build = false`, so it is not the linter). Solc itself receives the contexts, resolves everything (§2.3), and the run continues: compilation, tests, scripts and broadcasts are unaffected. Vendoring the LayerZero packages with a rewritten import prefix would remove the noise at the cost of patched vendor sources; not done.

## 3. Tests (`test/omni/`)

`OmniTestBase.sol` extends LayerZero's `TestHelperOz5` (two endpoints, UltraLightNode libraries: the real `EndpointV2Mock` / `SendUln302Mock` / `ReceiveUln302Mock` code with a mock DVN and executor), deploys a **real** `PonsV2LauncherToken` (its "curve" is `alice`, so she holds the supply), creates the adapter **through the factory** (mock launch factory reporting `PoolCreated`, owner = `owner`), deploys the remote `RadianOFT`, and wires exactly what the deploy script does (peers both ways, enforced `lzReceive` 80k both ways). Delivery in the helper runs `endpoint.lzReceive{gas: <enforced gas>}`, so the 80k budget is exercised, including a mint to a fresh address.

| Suite | Tests | What is pinned |
| --- | --- | --- |
| `OmniRoundTrip.t.sol` | 12 | lock 1234.567891 tokens home → exact mint remote; burn 400 remote → exact unlock home to a third party; full round trip returns everything; five hops keep `locked == remote totalSupply`; decimals 18/18, shared 6, conversion rate 1e12; dust below 1e12 wei stays with the sender and a `minAmountLD` above the de-dusted amount reverts `SlippageExceeded`; `quoteOFT`; no peer → `NoPeer`; no approval → revert; enforced options alone carry the message; a packet from a non-peer waits at the endpoint and delivers once the peer is right (the property `freezePeers` makes permanent). |
| `FreezePeers.t.sol` | 8 | freeze blocks `setPeer` (new eid, existing eid, clearing) on adapter and OFT; owner-only; second freeze reverts; a frozen pathway still moves tokens both ways; `setPeer` owner-only; `renounceOwnership` reverts; two-step transfer (`pendingOwner`, `acceptOwnership`, old owner loses `freezePeers`). |
| `OmniAdapterFactory.t.sol` | 9 | zero-address constructor guards; unknown token; record naming another token; `NotGraduated` for NotGraduated / Swept / Rescued and success for PoolCreated; anyone may create and the address equals `predictAdapter`; same token → same address, no second deploy, no event; owner and endpoint delegate = launch factory's owner; a later owner change applies to later adapters only; the factory has no `owner()`. |
| `OmniAdapterFactoryLive.t.sol` | 3 (+4 inherited) | on the real V2 harness (real `PonsV2LaunchFactory`, curve, V4 graduation): refused while on the curve, refused for an unknown token, created once `createGraduatedPool` ran, owner = `factory.owner()`, delegate set, idempotent. |

Run: `forge test --match-path "test/omni/*"` (36 pass). Whole repo: `forge test` → **190 passed, 0 failed**.

## 4. Testnet deployment (`script/DeployOmniTestnet.s.sol`)

### 4.1 Shape

Two legs, one chain each, both idempotent (re-runs skip what is already on chain), each run with that chain's `--rpc-url`; the third step is leg A again:

```
# leg A — Robinhood testnet: factory, adapter for RHSMK, enforced options
OMNI_LEG=A forge script script/DeployOmniTestnet.s.sol --rpc-url robinhood_testnet            # simulate
OMNI_LEG=A forge script script/DeployOmniTestnet.s.sol --rpc-url robinhood_testnet --broadcast

# leg B — Base Sepolia: RadianOFT for RHSMK, peer → home adapter, enforced options
OMNI_LEG=B HOME_ADAPTER=0x81CF3722aA6E4E2b01624C3E803f18B7a8Aee282 \
  forge script script/DeployOmniTestnet.s.sol --rpc-url https://sepolia.base.org [--broadcast]

# leg A again — home peer → the OFT, quote, send 1 RHSMK to the deployer on Base Sepolia
OMNI_LEG=A REMOTE_OFT=<printed by leg B> [SEND_AMOUNT=1000000000000000000] \
  forge script script/DeployOmniTestnet.s.sol --rpc-url robinhood_testnet [--broadcast]
```

Env: `PRIVATE_KEY` (read only through `vm.envUint`; never printed), `OMNI_LEG`, `REMOTE_OFT` / `HOME_ADAPTER`, `SEND_AMOUNT` (0 disables the send), and the read-only RPCs `ROBINHOOD_TESTNET_RPC` / `BASE_SEPOLIA_RPC` (defaults to the public ones). Cross-chain checks (does `HOME_ADAPTER` have code and wrap RHSMK; does `REMOTE_OFT` exist, name RHSMK as `homeToken`, and point its home peer at this adapter) are plain `eth_call`s through `vm.rpc(url, …)`, **not** fork switches: forge 1.7.1 panics ("Missing operator fee scalar for isthmus L1 Block", op-revm) when a script started on an OP-stack fork (Base Sepolia) switches to a non-OP fork and back.

Addresses are CREATE2 and predictable before deployment: the factory from the canonical deployer `0x4e59b4…956C` with salt `keccak256("radian.omni.adapter-factory.v1")`; the adapter from the factory with salt = RHSMK; the OFT from the canonical deployer with salt = RHSMK and the deployer as owner. Each leg prints the predictions and refuses to continue if a deployment lands elsewhere.

### 4.2 The balance check

Before any `vm.startBroadcast`, each leg sums the gas of the steps still pending (constants measured from the simulation with margin: factory 2.9M, `createAdapter` 2.4M, OFT 2.9M, `setPeer` 60k, `setEnforcedOptions` 110k, approve 60k, `send` 400k), multiplies by the chain's live gas price (`eth_gasPrice`, never below `block.basefee`) **times two**, adds the quoted LayerZero fee when a send is due, and reverts with the exact shortfall:

```
Leg B aborted before broadcasting: deployer 0x13E6…b11C holds 0 ETH on chain 84532 but needs about 0.0000368 ETH; short by 0.0000368 ETH (36840000000000 wei). Fund it and rerun.
```

### 4.3 What happened on 2026-09-24

**Leg A — broadcast on the Robinhood testnet (46630).** Balance 0.000262 ETH, needed about 0.000108 ETH (5.41M gas × 0.01 gwei × 2). Block 123949026, all three status 1:

| Step | Address / result | Tx | Gas |
| --- | --- | --- | --- |
| `OmniAdapterFactory` (CREATE2) | `0xC2f0972296046D5ED1089d0aA9Ab5611fE039d7c` — `launchFactory` `0x55622f7e…48F6`, `endpoint` `0x3aCAAf60…Fe32` | `0x496ce562de085c91ba617e5efb908d554ac38a6b756aac69856e89f1518331ad` | 3,034,176 |
| `createAdapter(RHSMK)` | `RadianOFTAdapter` `0x81CF3722aA6E4E2b01624C3E803f18B7a8Aee282` = `predictAdapter(RHSMK)`; `token()` = RHSMK, `owner()` = `0x13E6…b11C` (the launch factory's owner), `endpoint.delegates(adapter)` = same, `sharedDecimals` 6, `peersFrozen` false | `0x101044a578f8486a613f39c267ab5f06214444f493121ad8a2048acadf5f78f3` | 2,066,139 |
| `setEnforcedOptions` → Base Sepolia (40245), msg types 1 and 2 | `0x00030100110100000000000000000000000000013880` (type-3 options, `lzReceive` gas 0x13880 = 80,000) | `0x8e4f7fab520ad849714efac90229c3e4fab8b8e3d9c6e1efe995cc0ab3a0656c` | 91,737 |

Balance after: 0.000210 ETH. Receipts: `broadcast/DeployOmniTestnet.s.sol/46630/run-latest.json`. The pathway quotes with the testnet's default security stack: `EndpointV2.quote(adapter → 40245, 40-byte OFT message, lzReceive 80k)` = **103,066,260,146,105 wei ≈ 0.000103 ETH** (LayerZero Labs DVN, 1 confirmation, executor `0x701f39…d243`), matching the feasibility doc's 0.000104 ETH.

**Leg B — simulated, not broadcast.** The dry run reads the home chain over `vm.rpc` (adapter has code, wraps RHSMK, "Robinhood Smoke" / RHSMK / 18 decimals), predicts the OFT at **`0x18470896002b95F0A1135F2e515051561b8e6D26`** (CREATE2, salt = RHSMK, owner = deployer), and then stops at the balance check because the deployer has **0 ETH on Base Sepolia**:

```
Leg B: balance 0.0 ETH; needs about 0.00003684 ETH (3070000 gas x 6000000 wei x2)
Error: script failed: Leg B aborted before broadcasting: deployer 0x13E6b6C635CAcD4B27C9309251A4D083457eb11C holds 0.0 ETH on chain 84532 but needs about 0.00003684 ETH; short by 0.00003684 ETH (36840000000000 wei). Fund it and rerun.
```

Until it runs there is no OFT on Base Sepolia, the home adapter's peer for 40245 is unset, and **no send has happened**. To finish the demo: fund `0x13E6b6C635CAcD4B27C9309251A4D083457eb11C` on Base Sepolia (a human at a faucet; 0.0001 ETH is plenty), run leg B with `--broadcast`, then leg A with `REMOTE_OFT=0x18470896002b95F0A1135F2e515051561b8e6D26 --broadcast` (the home side still holds 0.000210 ETH against ≈ 0.000103 ETH fee + ≈ 0.00001 ETH gas), and watch the message on LayerZero Scan (testnet). A leg A re-run today reports "Nothing to do" (idempotent), and a leg A run with a `REMOTE_OFT` that has no code on Base Sepolia stops before any broadcast with "REMOTE_OFT has no code on Base Sepolia; run leg B first".

## 5. Security stack: DVN / executor / options choices

### 5.1 Testnet (what the deployed adapter uses)

Nothing set explicitly: the Robinhood testnet's defaults are live. `SendUln302.getUlnConfig(adapter, 40245)` = (1 confirmation, 1 required DVN = LayerZero Labs `0xa78A78a1…feC2`, no optional); executor config = (maxMessageSize 10000, `0x701f39…d243`); Base Sepolia's default receive config for 40451 = (1 confirmation, LayerZero Labs `0xe1a125…B2d6`). Enforced options: `lzReceive` gas **80,000** for both message types (SEND and SEND_AND_CALL); the compose gas budget for phase-2 sells is supplied per transaction in `extraOptions`, not enforced, so plain transfers stay cheap. The tests deliver on exactly this budget, mint-to-fresh-address included.

### 5.2 Mainnet (what the Safe must set before the first send)

Robinhood mainnet ships with the **dead DVN** as its default required DVN, so `EndpointV2.quote` reverts ("Please set your OApp's DVNs and/or Executor") until the OApp pins its own stack; the default *executor* is real. Template from the feasibility doc: **2 required DVNs, LayerZero Labs + Nethermind**, 5 confirmations on Robinhood (≈ 0.5 s blocks), LayerZero's recommended confirmations on the remote side; review quarterly (LayerZero can roll libraries forward).

Addresses (LayerZero metadata API, 2026-09-24; the `lzReadCompatible` duplicates on Base/BSC are for lzRead, not for OFT messaging):

| Chain | EID | EndpointV2 | SendUln302 | ReceiveUln302 | Executor | DVN LayerZero Labs | DVN Nethermind |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Robinhood | 30416 | `0x6f475642a6e85809b1c36fa62763669b1b48dd5b` | `0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7` | `0xe1844c5d63a9543023008d332bd3d2e6f1fe1043` | `0x4208d6e27538189bb48e603d6123a94b8abe0a0b` | `0xd01ae6905d48315f7be10c7330aecf8360ef5b12` | `0x0ffe02df012299a370d5dd69298a5826eacafdf8` |
| Base | 30184 | `0x1a44076050125825900e736c501f859c50fe728c` | `0xb5320b0b3a13cc860893e2bd79fcd7e13484dda2` | `0xc70ab6f32772f59fbfc23889caf4ba3376c84baf` | `0x2cca08ae69e0c44b18a57ab2a87644234daebae4` | `0x9e059a54699a285714207b43b055483e78faac25` | `0xcd37ca043f8479064e10635020c65ffc005d36f6` |
| BSC | 30102 | `0x1a44076050125825900e736c501f859c50fe728c` | `0x9f8c645f2d0b2159767bd6e0839de4be49e823de` | `0xb217266c3a98c8b2709ee26836c98cf12f6ccec1` | `0x3ebd570ed38b1b3b4bc886999fcf507e9d584859` | `0xfd6865c841c2d64565562fcc7e05e619a30615f0` | `0x31f748a368a893bdb5abb67ec95f232507601a73` |

The calls, per pathway and per side (all on the **endpoint**, from the OApp's owner/delegate — the Safe; `requiredDVNs` sorted ascending):

```
// home (Robinhood) → remote: send side
endpoint.setConfig(adapter, SendUln302, [
  { eid: remoteEid, configType: 2 /* ULN */,      config: abi.encode(UlnConfig{ confirmations: 5, requiredDVNCount: 2, optionalDVNCount: 0, optionalDVNThreshold: 0, requiredDVNs: [nethermind, layerzeroLabs] /* sorted */, optionalDVNs: [] }) },
  { eid: remoteEid, configType: 1 /* EXECUTOR */, config: abi.encode(ExecutorConfig{ maxMessageSize: 10000, executor: robinhoodExecutor }) }
]);
// home: receive side (messages from the remote)
endpoint.setConfig(adapter, ReceiveUln302, [
  { eid: remoteEid, configType: 2, config: abi.encode(UlnConfig{ confirmations: <remote chain's recommended>, requiredDVNCount: 2, ..., requiredDVNs: [robinhood DVN addresses, sorted] }) }
]);
// remote (Base / BSC): the mirror image on the OFT with that chain's libraries, executor and DVN addresses.
```

Then, per side: `setPeer(remoteEid, bytes32(remoteAddress))`, `setEnforcedOptions([{eid, msgType 1, lzReceive 80k}, {eid, msgType 2, lzReceive 80k}])`, verify with `quoteSend` and one small round trip, then `freezePeers()` on both ends. LayerZero's CLI does the same wiring from a `layerzero.config.ts` (`npx hardhat lz:oapp:wire --safe` routes it through the Safe Transaction Service; `lz:oapp:config:get`, `lz:oapp:peers:get`, `lz:oapp:enforced-opts:get` verify) — the contracts here are stock OApps, so either path works.

### 5.3 Who does what on mainnet

| Action | Who | Notes |
| --- | --- | --- |
| Deploy `OmniAdapterFactory(launchFactory, endpoint)` | anyone (deployer EOA) | no owner; CREATE2 from the canonical deployer with the fixed salt so the address is stable |
| `createAdapter(token)` | **anyone** — keeper `omniTick` after `PoolGraduated` | owner/delegate = `PonsV2LaunchFactory.owner()` = the Safe |
| Deploy `RadianOFT` on Base / BSC | anyone (phase 2: `OmniOFTFactory.mirror`) | owner = a Safe with the same signers on that chain |
| `setConfig` (DVNs, executor) both sides, `setPeer` both sides, `setEnforcedOptions` | **the Safe** (delegate) | Safe batches proposed via the Transaction Service API, as for THE POUND |
| `freezePeers()` both sides | the Safe | after one verified round trip |
| `transferOwnership` / `acceptOwnership` | the Safe / the new Safe | two-step; `renounceOwnership` is impossible |
| `setDelegate` | the Safe | only if the endpoint-side operator should differ from the owner |
| Disclosure | web `/verify`, token page | "Your Base/BNB balance is a claim on tokens locked in the adapter on Robinhood Chain; the adapter is governed by the Radian Safe (address, code hash); the home pool does not depend on it." |

Costs (feasibility doc, measured 2026-09-24): ≈ $0.25 per hop Robinhood → Base, $0.26 → BSC, executor-dominated; deployment of a token's EVM mesh < $2.

## 6. Phase 2 — the rest of the omnichain layer (estimates from `docs/OMNICHAIN_FEASIBILITY.md` §6)

| # | Item | What | Estimate |
| --- | --- | --- | --- |
| 1 | `CrossSellReceiver` (home) + `lzCompose` sell-home | An `ILayerZeroComposer` the adapter delivers to: a remote holder `send`s home with a `composeMsg` (minOut, deadline, referrer, payout address); after the tokens are credited on Robinhood, `lzCompose` sells through `RadianLaunchRouter` into the V4 pool with the referrer tag and pays USDG to the seller's Robinhood address (later: bridge it back via Relay/Across). Compose is decoupled from delivery, so a failed sell leaves the tokens safely on Robinhood and is retried independently. Enforced options gain no compose budget; the caller supplies it per tx. | 2 d |
| 2 | `OmniOFTFactory` (Base, BNB) | `mirror(homeToken, name, symbol)`, permissionless, CREATE2 with the same salt, wires the peer to the deterministic home adapter and applies the Safe-set config template. | 1.5 d |
| 3 | Factory config template | `OmniAdapterFactory` v2 applying the Safe-set template (DVNs, confirmations, executor, enforced options, deterministic remote peers) inside `createAdapter`, so the keeper's call is the only step; one-shot `setSolanaPeer`. Phase 1 deliberately leaves configuration to the owner. | 1.5 d |
| 4 | `OmniBuyForwarder` (optional) | A `recipient` for `CrossBuyReceiver.buyFor` that immediately `send`s the bought tokens to the buyer's chain in the same transaction (adds ≈ $0.25–0.50, paid from the delivery). | 0.5 d |
| 5 | Tests | Compose failure → retry, `RateLimiter` per pathway sized to the float, reconcile invariant `adapter balance == Σ remote totalSupply` across three mocked endpoints. | 1.5 d |
| 6 | Keeper `omniTick` (`indexer/src/keeper.ts`) | After `PoolGraduated`: `createAdapter` on Robinhood, `mirror` on Base and BNB (new funded keys, `viem` clients per chain, simulate-then-send), poll LayerZero Scan for the wiring messages, `omni.status` per token in `store`; idempotent retries. | 5 d EVM (+4 d Solana) |
| 7 | Indexer `GET /omni/:token` | Decode `AdapterCreated`; adapter, per-chain OFT, locked supply, per-chain circulating supply (remote `totalSupply` via Base/BNB RPC), recent LayerZero messages, status; `/reconcile` gains "locked == Σ remote supply"; remote holder counts from remote `Transfer` logs. | 5 d |
| 8 | Web "Everywhere" block | Token page (Spectrum bundle IA): one price (home pool), per-chain share bars, per-chain contract + explorer link, "Bridge to Base/BNB" (adapter `send`, fee from `quoteSend`), "Sell from Base" (OFT send + compose, wagmi multi-chain); `/verify` lists the omni contracts, code hashes and the ownership disclosure; portfolio rows "on Base"; `/api-docs` gains `/omni`. | 7 d EVM (+4 d Solana) |
| 9 | Ops | Safes on Base and BNB (same signers), keeper gas there, LayerZero Scan API key, quarterly DVN template review. | 1–2 d |

Sequencing (feasibility doc): testnet demo 2–3 weeks (this phase 1 is its contract core: items 1–5 remain), mainnet EVM after audit ≈ 1 week of deployment/verification on top, Solana +2–3 weeks (OFT program once ≈ 3.9 SOL, per-token init in the keeper, Squads multisig, deBridge hook for the buy leg). EVM omnichain layer ≈ 5–6 engineer-weeks including tests; Solana +2–3 weeks. Phase 0 (`CrossBuyReceiver`, the buy leg) is contract-complete and a prerequisite for both.

## 7. Files

- Contracts: `src/omni/RadianOFTAdapter.sol`, `src/omni/RadianOFT.sol`, `src/omni/OmniAdapterFactory.sol`
- Tests: `test/omni/OmniTestBase.sol`, `test/omni/mocks/MockLaunchFactory.sol`, `test/omni/OmniRoundTrip.t.sol`, `test/omni/FreezePeers.t.sol`, `test/omni/OmniAdapterFactory.t.sol`, `test/omni/OmniAdapterFactoryLive.t.sol`
- Script: `script/DeployOmniTestnet.s.sol`; receipts `broadcast/DeployOmniTestnet.s.sol/46630/run-latest.json`
- Dependency: `lib/layerzero/*` (vendored, §2), `remappings.txt` (pins + contexts), `foundry.toml` (note)
- Facts: `docs/OMNICHAIN_FEASIBILITY.md`, `MULTICHAIN.md`, `HANDOFF.md` (Robinhood testnet factory `0x55622f7e…48F6`)
