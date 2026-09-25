# Omnichain feasibility on Robinhood Chain — what is deployable today

Date: **2026-09-24**. Scope: can a token graduated on Robinhood Chain (mainnet **4663**, testnet **46630**, Arbitrum Orbit) become an omnichain asset — "launch once, trade everywhere", main pool stays home, holders on Solana / Base / BNB can hold and sell — and which routers carry the cross-chain **buy** leg. Every row below was checked against a live API, a docs page, or an `eth_call` on 2026-09-24; nothing is assumed. Companion docs: `MULTICHAIN.md` (Arc-side interop table), `docs/THE_POUND_RESEARCH.md` §1.2–1.3 and §2 item 5 (the product intent).

## 0. TL;DR

- **LayerZero V2 is live on both Robinhood networks.** Mainnet EID **30416**, EndpointV2 `0x6f475642a6e85809b1c36fa62763669b1b48dd5b`; testnet EID **40451**, EndpointV2 `0x3acaaf60502791d199a5a5f0b173d78229ebfe32`. Both verified with `eid()` on-chain. 13 live DVNs on mainnet (LayerZero Labs, Nethermind, Horizen, BitGo, Paxos, Canary, …), 4 on testnet. One catch: on **mainnet the default required DVN is the `LZDeadDVN`**, so every OApp must pin its own DVN set (testnet defaults work as-is). Paxos already runs USDG as an OFT there (peers: Solana, Ethereum).
- **Chainlink CCIP is live on both networks too**, with lanes to Base, BSC and Solana on mainnet **and** to Base Sepolia, BSC testnet and Solana devnet on testnet. But its Cross-Chain Token standard needs `owner()` / `getCCIPAdmin()` on the token or a manual request to Chainlink — our graduated tokens expose neither, so it cannot be automated at graduation.
- **Hyperlane** (mailbox verified) and **Wormhole NTT** (core verified) exist on **mainnet only**; Wormhole has no relayer there. **CCTP: not on Robinhood** (and there is no native USDC there anyway; USDG is the dollar).
- **Buy leg:** Relay, deBridge DLN, Across and LI.FI all support **4663**, with live quotes today (Relay and deBridge from **Solana** too, both with destination calls). **None of them supports 46630.** The testnet demo has to carry the buy leg with an OFT'd stand-in + `lzCompose` (or a CCIP test lane), not with a router.
- **Recommendation:** ship the home-chain `CrossBuyReceiver` as planned (alternative (c) — it is the base layer regardless), then add the omnichain layer with **LayerZero OFT: `OFTAdapter` locking on Robinhood + mint/burn OFTs on Base and BNB, then a Solana OFT**; no remote pools, selling from a remote chain = OFT send home with a compose message that sells into the V4 pool. It is the only stack that (i) exists on the testnet we demo on, (ii) wraps an already-deployed, owner-less ERC-20 without anyone's permission, and (iii) reaches Solana. Measured cost per transfer ≈ **$0.25 (Base/BNB) – $0.50 (Solana)**; per-token enablement gas < $2 on the EVM side.

## 1. Facts table

| Provider | Mainnet 4663 | Testnet 46630 | Evidence |
| --- | --- | --- | --- |
| **LayerZero V2** | **Yes.** EID 30416; EndpointV2 `0x6f475642a6e85809b1c36fa62763669b1b48dd5b` (`eid()`=30416, 48 KB code); SendUln302 `0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7`; ReceiveUln302 `0xe1844c5d63a9543023008d332bd3d2e6f1fe1043`; Executor `0x4208d6e27538189bb48e603d6123a94b8abe0a0b`; V1 endpoint also present (eid 416). Default required DVN = **LZDeadDVN** `0x6788f524…E842` (5 conf) → OApps must `setConfig`. | **Yes.** EID 40451; EndpointV2 `0x3acaaf60502791d199a5a5f0b173d78229ebfe32` (`eid()`=40451); SendUln302 `0x45841dd1ca50265da7614fc43a361e526c0e6160`; ReceiveUln302 `0xd682ecf100f6f4284138aa925348633b0611ae21`; Executor `0x701f3927871efcea1235db722f9e608ae120d243`. Default required DVN = LayerZero Labs `0xa78a78a1…feC2` (1 conf) → quotes work with defaults. | `https://metadata.layerzero-api.com/v1/metadata` (keys `robinhood`, `robinhood-testnet`); `https://docs.layerzero.network/v2/deployments/chains/robinhood`; on-chain `eid()`, `defaultSendLibrary()`, `getUlnConfig()` reads (this doc §2.1) |
| **Hyperlane** | **Yes.** Mailbox `0x3a867fCfFeC2B790970eeBDC9023E75B0a172aa7` (`localDomain()`=4663, `nonce()`=77), IGP `0x3862A9B1aCd89245a59002C2a08658EC1d5690E3`, deployer Abacus Works, indexed from block 47247 | **No.** No `robinhoodtestnet` chain in the registry; the mainnet mailbox address has no code on 46630 | `https://github.com/hyperlane-xyz/hyperlane-registry/tree/main/chains/robinhood` (`metadata.yaml`, `addresses.yaml`); on-chain reads |
| **Wormhole (core / NTT)** | **Core yes** `0x141fBa8AD5D61bdaB45A047cF60b5Ad9784987FB` (`chainId()`=72, guardian set 7). **NTT: listed, mainnet only.** No Wormhole Relayer, Token Bridge or NTT transceiver entries for Robinhood in the SDK → NTT needs a custom relayer / Executor. | **Core contract present** `0xBB73cB66C26740F31d1FabDC6b7A46a038A300dd` (`chainId()`=72) but NTT's supported-networks page lists Robinhood **mainnet only** | `wormhole-sdk-ts` `core/base/src/constants/contracts/core.ts` (+ `relayer.ts`, `tokenBridge.ts`: no Robinhood); `https://wormhole.com/docs/products/token-transfers/native-token-transfers/reference/supported-networks/` |
| **Chainlink CCIP** | **Yes.** Router `0x06fC836cf9839B1cd891C440A0a45242DA6Ae1c9`, selector `6180753054346818345`, TokenAdminRegistry `0x1912C3cFafE8A76A32a92861d815aC2837F237Ca`, RegistryModule `0x3237c0D7B58BEc8Dc17F00103B784Bd6678f789E`, TokenPoolFactory `0x614B367841ec854994706f06AAB4aA2C80Fe06D9`; `isChainSupported()` true for Base, BSC, Solana, Ethereum, Arbitrum; Base lane already carries VIRTUAL, cbBTC, …; Solana lane carries USDUC | **Yes.** Router `0x30D197C6F5bE050D5525dD94d01760FaCdB67e7C`, selector `2032988798112970440`, TokenAdminRegistry `0xad4c7a1430D140Fc5121C0697B2f7Efc655c0070`, TokenPoolFactory `0x3e9299b3A6D4B1f5AC9d11A115386845ECc74450`; `isChainSupported()` true for Base Sepolia, BNB testnet, Solana devnet, Sepolia | `https://docs.chain.link/ccip/directory/mainnet/chain/robinhood-mainnet`, `…/testnet/chain/robinhood-testnet`; data files `smartcontractkit/documentation` `src/config/data/ccip/v1_2_0/{mainnet,testnet}/{chains,lanes}.json`; on-chain `isChainSupported`, `getFee` |
| **Circle CCTP** | **No.** Robinhood absent from the 28-chain V2 table; no native USDC on Robinhood (docs list USDG + WETH only) | **No** | `https://developers.circle.com/cctp/cctp-supported-blockchains`; `https://docs.robinhood.com/chain/contracts/` |
| **Relay** | **Yes.** `depositEnabled`, ETH + USDG, v3 erc20Router `0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f`, approvalProxy `0xccc88a9d1b4ed6b0eaba998850414b24f1c315be`; live quotes from Base, **Solana** and BNB, incl. destination `txs` | **No.** Testnet API lists only `base-sepolia` and `sepolia` | `https://api.relay.link/chains`, `https://api.testnets.relay.link/chains`, `POST https://api.relay.link/quote` |
| **Across** | **Yes.** SpokePool `0xD29C85F15DF544bA632C9E25829fd29d767d7978`, SpokePoolPeriphery `0x97CCDBea4632140639aD5eA9b944aa034eb15fD4`, **no MulticallHandler**; routes: USDC→USDG from 13 chains incl. Base, ETH/WETH from Base and BSC; **no Solana→4663 route** | **No.** 46630 absent from the testnet table and API | `https://docs.across.to/reference/supported-chains`; `https://app.across.to/api/available-routes?destinationChainId=4663`; `https://testnet.across.to/api/available-routes?destinationChainId=46630` → `[]` |
| **deBridge DLN** | **Yes.** Chain 4663 in `supported-chains-info` (18 chains incl. Solana, Base, BSC, Arc); token list has ETH, USDG, PONS, NVDA, …; live Solana→Robinhood and Base→Robinhood estimates; hooks (external calls) on EVM and Solana | **No.** DLN's API and fee table are mainnet-only; no testnet host documented | `https://dln.debridge.finance/v1.0/supported-chains-info`; `https://docs.debridge.com/dln-details/overview/fees-supported-chains.md`; `…/dln-details/overview/deBridge-hooks.md` |
| **LI.FI** | **Yes** (id 4663, key `out`, mainnet) | not listed | `https://li.quest/v1/chains` |

Robinhood's own bridging page names exactly this set: canonical Arbitrum bridge, LayerZero OFT / Stargate ("moving WBTC, USDG, and other OFTs"), Chainlink CCIP / Transporter, Relay ("bridge-and-execute … in one step"), Across, LI.FI / 0x — `https://docs.robinhood.com/chain/bridging/`. Prices used for USD figures: ETH $2,676, SOL $116.7, BNB $773 (CoinGecko, 2026-09-24). Gas: Robinhood 0.041 gwei, Base 0.006 gwei.

## 2. Provider detail

### 2.1 LayerZero V2 (the recommended rail)

**Verified on-chain (2026-09-24):**

```
cast call 0x6f475642a6e85809b1c36fa62763669b1b48dd5b "eid()(uint32)" --rpc-url https://rpc.mainnet.chain.robinhood.com   → 30416
cast call 0x3acaaf60502791d199a5a5f0b173d78229ebfe32 "eid()(uint32)" --rpc-url https://rpc.testnet.chain.robinhood.com   → 40451
SendUln302.getUlnConfig(0xdead, 30184) on mainnet → (5 conf, 1 required, [0x6788f524…E842 = LZDeadDVN], [])
SendUln302.getUlnConfig(0xdead, 40245) on testnet → (1 conf, 1 required, [0xa78a78a1…feC2 = LayerZero Labs], [])
EndpointV2.quote(…, sender=0xdead) mainnet → reverts "Please set your OApp's DVNs and/or Executor"
EndpointV2.quote(…, sender=0xdead) testnet → 0.000104 ETH (Base Sepolia), 0.000224 ETH (BSC testnet), 0.0000278 ETH (Solana devnet)
```

The mainnet revert is by design: LayerZero ships new chains with a placeholder security stack; "You should always set your DVN configuration explicitly. Defaults are placeholder configurations" and "a Dead DVN for all practical purposes should be considered a null address" (docs: `v2/developers/evm/protocol-gas-settings/default-config`, `v2/concepts/modular-security/security-stack-dvns`). The default **executor** config on mainnet is real (`0x4208…0A0b`, maxMessageSize 10000); only the DVN default is dead. Every pathway we use must therefore be wired with `setConfig` on both ends — the LayerZero CLI does this (`npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts`, verify with `lz:oapp:peers:get`, `lz:oapp:config:get`, `lz:oapp:enforced-opts:get`; `--safe` routes the txs through Safe Transaction Service).

**DVNs on Robinhood mainnet** (metadata API, all `version 2`, none deprecated except the dead one): LayerZero Labs `0xd01ae6905d48315f7be10c7330aecf8360ef5b12`, Nethermind `0x0ffe02df012299a370d5dd69298a5826eacafdf8`, Horizen `0x1258a278519c7f4bd997a9c3bfd4aa802a028d89`, BitGo `0xdde8de68deb0080572e252f855d0485e8bbde14c`, Paxos `0x2832b240200c13d02250ec39bd0c20c199757891`, Canary `0x8d77d35604a9f37f488e41d1d916b2a0088f82dd`, StablecoinX, Luganodes, P2P, Superform, ApeDVN, Frax, Nansen. Testnet: LayerZero Labs `0xa78a78a13074ed93ad447a26ec57121f29e8fec2`, Nethermind `0xcde82f74624525e24853b1f59c8b20a162a3d297`, Horizen `0x52f615ecbcbf40e47a315c2d84d14fa2851e55b7`, Paxos `0x771d83e953ca8f113f02f18206ecf8bb93da3f0a`. The docs' production advice is "at least one required DVN that is not operated by LayerZero Labs" → our template: **2 required DVNs, LayerZero Labs + Nethermind** (both quote every pathway we need, see fees).

**Production OFTs already on 30416:** Paxos's USDG OFT `0x0d54755f5106BfdB43f7a35f5D49a23F940628d1` (`token()` = USDG, `endpoint()` = `0x6f47…dd5b`, owner `0x3Af3e85f…024B`, peers set for Solana 30168 and Ethereum 30101 — *not* Base/BSC — with 3 required DVNs Paxos + Canary + LayerZero Labs at 40 confirmations; `https://docs.paxos.com/guides/stablecoin/usdg/mainnet`). LayerZero's announcement: "Robinhood Chain is now live and connected to every blockchain via LayerZero. OFT-enabled tokens like USDG are available to bridge via Stargate" (`https://x.com/LayerZero_Core/status/2072396480770674832`). A third-party example of exactly our shape — OFTAdapter on Base + OFT on Robinhood, "mandatory 2-DVN + executor config" on every leg — is bankrbot's $SCAN (`https://x.com/bankrbot/status/2076501474931306731`).

**Measured fees (mainnet, 2026-09-24, native ETH):**

| Pathway | LayerZero Labs DVN (5 conf) | Nethermind DVN (5 conf) | Executor, 80k dst gas | Executor, 200k | ≈ total, 2 DVNs + 80k |
| --- | --- | --- | --- | --- | --- |
| Robinhood → Base (30184) | 6.40e11 wei ($0.0017) | 6.32e11 ($0.0017) | 9.26e13 wei ($0.248) | 9.33e13 | **≈ $0.25** |
| Robinhood → BSC (30102) | 1.59e12 ($0.0043) | 1.58e12 ($0.0042) | 9.40e13 ($0.252) | 9.58e13 | **≈ $0.26** |
| Robinhood → Solana (30168) | 4.29e12 ($0.011) | 4.24e12 ($0.011) | 1.87e14 ($0.499) | 1.91e14 | **≈ $0.52** (+ 0.00204 SOL ≈ $0.24 ATA rent when the recipient has no token account) |
| Base → Robinhood (30416) | 5.36e12 ($0.014) | — | 1.02e14 ($0.273) | — | **≈ $0.29** |

Cross-checks: `quoteSend` on the live USDG OFT gives 0.000426 ETH ($1.14) to Solana and 0.000586 ETH ($1.57) to Ethereum under Paxos's heavier config (3 DVNs, 40 confirmations, larger enforced gas); the testnet endpoint quotes above (1 DVN, 200k) are $0.07–0.60. So a transfer costs a quarter to half a dollar, executor-dominated; DVN fees are cents. Source-chain gas for `send` on Robinhood is negligible (0.041 gwei).

**Deployment cost per token (estimates, not measured — verify with `forge` once the contracts exist):** OFTAdapter ≈ 2.5–3.0M gas, OFT ≈ 3.0–3.5M gas per remote chain, plus wiring (`setPeer` ×N, `setConfig` send+receive ×N, `setEnforcedOptions`) ≈ 0.5–1M gas per chain. Robinhood at 0.041 gwei → ≈ 0.0001 ETH; Base at 0.006 gwei → cents; BSC at ~0.1 gwei → ≈ 0.0004 BNB ($0.30). **EVM mesh (Robinhood + Base + BNB) < $2 per token.** Solana (docs `v2/developers/solana/oft/overview`): the OFT **program** is deployed once (≈ 3.9 SOL rent ≈ $455; "a single deployed program can manage multiple OFTs"); per token: SPL mint + OFT Store PDA + Escrow + PeerConfig PDAs, a few hundredths of a SOL; DVN cap on Solana pathways is 5; the OFT cannot be called by CPI (depth limit), so composed flows on Solana are instruction bundles, not contract calls.

### 2.2 Chainlink CCIP (credible second rail; not automatable for our tokens)

Live on both networks with the lanes we need (mainnet: Base, BSC, Solana, Ethereum, Arbitrum, Monad, Bittensor, 0G; testnet: Base Sepolia, BSC testnet, Solana devnet, Sepolia, Arbitrum Sepolia, Fuji, …). Measured message fees (`Router.getFee`, 200k gas, EVMExtraArgsV2, native fee token): Robinhood → Base **0.0000411 ETH ($0.11)**, → BSC **0.0000523 ETH ($0.14)**; testnet → Base Sepolia 0.0000411 ETH, → BSC testnet 0.000179 ETH. Cheaper than LayerZero per message.

The blocker is the Cross-Chain Token standard's admin registration: self-service only via `registerAdminViaOwner()` (needs `token.owner()`), `registerAdminViaGetCCIPAdmin()` (needs `token.getCCIPAdmin()`) or `registerAccessControlDefaultAdmin()`; "If the token contract does not have the necessary functions (`getCCIPAdmin()` or `owner()`), the token developer must manually initiate the registration by submitting a request" (`https://docs.chain.link/ccip/concepts/cross-chain-token/evm/registration-administration`). `PonsV2LauncherToken` is `ERC20, ERC20Burnable` with no owner, no admin getter (`src/v2/PonsV2LauncherToken.sol`) — so CCT would mean a Chainlink ticket per graduated token. It could be made self-serve for *future* launches by adding an immutable `getCCIPAdmin()` to the token (a one-line, audit-scoped change), which is worth keeping in the back pocket, but it does not help the tokens already live and it puts a named admin inside every token.

### 2.3 Hyperlane (mainnet only)

Mailbox verified (`localDomain()` 4663; 77 messages dispatched so far — young). Warp Routes are the OFT analogue: "collateral" (lock an existing ERC-20) on the home chain, "synthetic" (mint/burn) elsewhere, deployed permissionlessly with the CLI, deployer chooses the ISM; SVM routes exist (`https://docs.hyperlane.xyz/docs/protocol/warp-routes/warp-routes-overview`). Registry has `solanamainnet`, `base`, `bsc` (and their testnets) but **no Robinhood testnet**, so nothing demoable on 46630. Keep as the fallback if LayerZero's DVN market on Robinhood ever thins out.

### 2.4 Wormhole NTT (mainnet only, no relayer)

Core contract present on both networks (`chainId()` 72), but the SDK has no Wormhole Relayer, Token Bridge or NTT transceiver defaults for Robinhood, and NTT's supported-networks page lists Robinhood mainnet only. NTT on Robinhood would mean running our own relayer or adopting Wormhole's Executor — more moving parts than LayerZero for no coverage gain.

### 2.5 Circle CCTP

Not on Robinhood; irrelevant for our tokens anyway. The dollar on Robinhood is USDG (Paxos, LayerZero OFT to Solana/Ethereum). A USDC→USDG leg is what the routers below do.

## 3. The OFT design for an already-deployed, owner-less ERC-20

**Shape.** Home chain (Robinhood): an **`OFTAdapter`** holding the locked supply — "tokens are locked in the adapter contract; on remote chains, equivalent OFT representations are minted and burned" (`https://docs.layerzero.network/v2/developers/evm/oft/adapter`). Remote chains (Base, BNB): an **`OFT`** contract per token (mint/burn, 18 decimals, `sharedDecimals` 6 → amounts travel as `uint64` in 6-decimal units; max 1.8e13 tokens, our 1e9 supply fits; sub-1e-6 dust is stripped, "6 shared decimals … dust removed"). Solana: one OFT program (ours, so we hold the upgrade authority), one OFT Store + SPL mint per token, mint authority = the OFT Store multisig. Peers are `bytes32` (EVM address left-padded; Solana = the OFT Store PDA).

**One adapter per mesh.** Only one adapter may exist for a token — several would split the supply into incompatible representations. Since *anyone* can deploy an OFTAdapter for any ERC-20, "canonical" is a social fact: the adapter our `OmniAdapterFactory` deploys at a deterministic CREATE2 address, listed by the indexer and code-hash-checked on `/verify`, is the official one; the web never links another.

**Ownership — the honest part.** OFTAdapter and OFT are `Ownable`; the owner (and its `delegate`) holds `setPeer`, `setConfig` (DVN / executor choice), `setEnforcedOptions`, optional rate limits. Those powers are real: a rogue owner could point a remote peer at an attacker contract or pick a 1-of-1 DVN it runs, and mint remote tokens against the locked collateral or unlock the collateral itself. Renouncing is "not recommended" — it freezes the pathway forever, so a deprecated DVN or a library roll-forward ("defaults are mutable; LayerZero Labs may publish a new library version and roll the default forward") would strand remote holders. Consequences for Radian:

- The home token stays exactly as it is: no owner, fixed supply, `ERC20Burnable`. Home-chain holders and the home pool never depend on the adapter.
- The adapter's owner is the **Radian Safe** (through the factory, so per-token config comes from a Safe-set template); remote OFTs are owned by Safes with the same signers on Base and BNB (to be deployed — Safe supports both); the Solana program's upgrade authority and OFT Store admin go to a Squads multisig. Later: a timelock in front.
- Hardening we can add cheaply: an adapter subclass whose `setPeer` is one-shot per EID (`freezePeers()` after wiring) so ownership can rotate DVNs but never re-route supply; a `RateLimiter` per pathway sized to the token's float.
- Disclosure: "Your Base/BNB/Solana balance is a claim on tokens locked in the adapter on Robinhood Chain; the adapter is governed by the Radian Safe (address, code hash); the home pool does not depend on it." Shown on the token page and `/verify`, in the Spectrum `/verify` spirit.

**"Trade everywhere" — what it really means here.** No pools on remote chains (Spectrum's rule "never price from the basket's own pool" applied to us: one pool, one price). A remote holder can hold, transfer, and **sell by sending home**: an OFT `send` with a `composeMsg`; after the tokens are credited on Robinhood the endpoint delivers `lzCompose` to our `CrossSellReceiver`, which sells into the V4 pool through the Radian router (referrer tag intact) and hands the USDG to the seller's Robinhood address, or (phase 2) bridges it back through Relay/Across. Compose is decoupled from delivery — "if the compose step fails, it can be retried independently without reverting the original token delivery" — so a failed sell leaves the tokens safely on Robinhood, never in limbo. A remote *buy* is the existing cross-chain buy leg (`src/pound/CrossBuyReceiver.sol`, `buyFor(token, minTokensOut, recipient, refundTo, referrer)`, owner-less, holds nothing between calls) plus one optional hop: a thin `OmniBuyForwarder` that receives the bought tokens as `recipient` and immediately `send`s them through the adapter to the buyer's chain in the same transaction (adds ≈ $0.25–0.50, paid from the delivery). The receiver itself stays untouched.

## 4. Alternatives assessed

| Option | Verdict |
| --- | --- |
| (a) Wait for a messaging layer | Unnecessary — LayerZero (and CCIP) are live on both networks. |
| (b) Spectrum-style sibling tokens per chain + merged price page | Rejected as the token model: every sibling needs its own curve, pool and graduation; supply and price fragment; "one pool, one price" is lost and arbitrage across siblings would itself depend on bridges. **Keep only its page design** (merged price, per-chain share, one action per chain) for the token page's "Everywhere" block. |
| (c) "Sell routes home" through the cross-chain buy receiver in reverse, no remote token at all | **Ship first, regardless.** It is the base layer: `CrossBuyReceiver` on Robinhood, Relay/deBridge/Across on mainnet. The token never leaves Robinhood; the Solana user "holds" through their Privy EVM address. Honest but not omnichain: nothing to hold in a Base wallet, no Solana explorer entry, no listing on remote aggregators. |
| **(d) LayerZero OFT mesh on top of (c)** | **Recommended.** Testnet-demoable now; permissionless for owner-less tokens; Solana reachable; the stack Robinhood's own docs name for OFT assets (USDG, WBTC via Stargate); measured cost $0.25–0.50 per hop. Sell-from-remote = OFT send + compose home (still "routes home", so one price). |

Why not CCIP as the primary: the CCT admin registration cannot be automated for tokens without `owner()`/`getCCIPAdmin()` (every graduated token would be a Chainlink ticket), and its ownership surface (token admin, pool owner, rate limits) is no smaller than the adapter's. Why not both: one adapter per mesh; two rails means two supplies.

## 5. Cross-chain BUY leg — routers today

Live quotes on 2026-09-24 (10 USDC in, USDG out on Robinhood unless noted):

| Router | Base → Robinhood | Solana → Robinhood | BNB → Robinhood | Destination call | Testnet 46630 |
| --- | --- | --- | --- | --- | --- |
| **Relay** (`POST https://api.relay.link/quote`) | 9.934 USDG, ~1 s; fees gas $0.007 + relayer $0.032 + service $0.022 (≈ 0.66%) | 9.932 USDG, ~1 s | 10 USDT → 0.00371 ETH, ~1 s | **Yes** (`txs[]` on 4663 accepted from Base and Solana; out 9.888 / 9.886 with a Multicall3 no-op) | **No** (testnet API: base-sepolia, sepolia only) |
| **deBridge DLN** (`/v1.0/dln/order/create-tx`) | 10 USDC → 0.003717 ETH, ~1 s; flat fee 0.001 ETH on Base (≈ $2.7) + 4 bps | 11.08 USDC in (operating expenses prepended) → 9.983 USDG, ~9 s; flat fee 0.015 SOL (≈ $1.75) | supported (BSC flat fee 0.005 BNB) | **Yes**, hooks: EVM atomic or optional-success with fallback; Solana "only non-atomic success-required hooks" | **No** |
| **Across** (`/api/suggested-fees`) | relay fee 0.0222 USDC (0.22%), fill ≈ 1 s; SpokePool `0x09aea4b2…EC64` → `0xD29C…7978` | **No route** (Solana SpokePool exists but no lane to 4663) | ETH/WETH only (BSC has no native USDC) | **Yes, but** no `MulticallHandler` on 4663 — the recipient must be our own contract implementing `handleV3AcrossMessage(address tokenSent, uint256 amount, address relayer, bytes message)` (`across-protocol/contracts` `contracts/interfaces/SpokePoolMessageHandler.sol`; docs: `…/using-a-custom-handler-contract`). A reverting handler fails the fill. | **No** |
| **LI.FI** | listed (aggregates the above) | — | — | swap-and-bridge | not listed |

Reading: for $10–100 tickets **Relay** is the cheapest and reaches all three origins with a destination call; **deBridge** is the Solana fallback with hooks but its flat fees ($1.75–2.7) only make sense above ~$200; **Across** is a Base/BNB alternative (custom handler) and has no Solana lane into Robinhood. This corrects `THE_POUND_RESEARCH.md` §1.2, which says Relay does not support Solana — its mainnet API quotes Solana → Robinhood today, calls included — and it turns the *unverified* router rows in `docs/CROSS_CHAIN_BUY.md` into verified ones (Relay destination `txs` on 4663: yes; Across on 4663: SpokePool yes, MulticallHandler no, custom handler required; deBridge hooks on 4663: yes; none on 46630).

**Testnet gap.** No router supports 46630, so the demo cannot bridge real value into the testnet. Options that *do* exist on 46630: (i) LayerZero — OFT-wrap the testnet dollar stand-in (`USDGx`, `DEPLOY_STANDINS=true`) with an adapter on 46630 and an OFT on Base Sepolia (40245) / BSC testnet (40102) / Solana devnet (40168), and carry the buy as an OFT send **with compose** into `CrossBuyReceiver` (the very same `lzCompose` path the mainnet sell-home uses, so it is not throwaway work); (ii) CCIP test lanes — `CCIP-BnM` flows BSC testnet → Robinhood testnet with data (`bsc-testnet` → `robinhood-testnet` supports CCIP-BnM; `base-sepolia` → `robinhood-testnet` is message-only). Mainnet keeps the routers.

## 6. Implementation plan (recommended path (c) + (d)), bounded

Phase 0 is the buy leg decided in `THE_POUND_RESEARCH.md` §2 item 3. Its contract already exists in the working tree — `src/pound/CrossBuyReceiver.sol` with `test/CrossBuyReceiver.t.sol`, `script/DeployCrossBuyReceiver.s.sol` and `docs/CROSS_CHAIN_BUY.md` (uncommitted, not deployed on any network). It is listed because the omnichain layer reuses it and its keeper plumbing, and because the router rows that `CROSS_CHAIN_BUY.md` marks *unverified* are verified in §5 above.

### Contracts (`src/omni/`, Foundry; LayerZero `@layerzerolabs/oft-evm` + `test-devtools-evm-foundry` `TestHelperOz5`)

| # | Contract | What it does | Effort |
| --- | --- | --- | --- |
| 0 | `CrossBuyReceiver` (home) — **exists** | `buyFor(token, minTokensOut, recipient, refundTo, referrer)` (ETH by `value`, ERC-20 by prior transfer) and `handleV3AcrossMessage`; buys via `RadianLaunchRouter` v4 with the referrer tag; refunds or parks on failure. Remaining: deploy on 46630/4663, bind the quote builders to the verified router semantics (§5: Relay `txs`, deBridge EVM hook, Across custom handler), plus two small additions for the omni layer: an `ILayerZeroComposer` entry for the testnet stand-in path and the `OmniBuyForwarder` hop (§3). | 2 d |
| 1 | `RadianOFTAdapter` (home) | `OFTAdapter` subclass: `freezePeers()`, `RateLimiter` hooks, `Ownable2Step`, `renounceOwnership` disabled (same pattern as `PonsV2LaunchLocker`). | 1 d |
| 2 | `RadianOFT` (Base, BNB) | `OFT` subclass with name/symbol/`homeToken` immutables; same ownership pattern. | 0.5 d |
| 3 | `OmniAdapterFactory` (home, Safe-owned) | `enable(token)` — permissionless once `PonsV2LaunchFactory` reports graduation; CREATE2 adapter (salt = token); sets peers to the **deterministic** remote OFT addresses (computed from `OmniOFTFactory` + salt); applies the Safe-set template: required DVNs [LayerZero Labs, Nethermind], confirmations, executor, enforced options (`lzReceive` 80k EVM; Solana values per docs); emits `OmniEnabled(token, adapter)`. `setSolanaPeer(token, bytes32)` one-shot, keeper-callable (the Solana OFT Store PDA is known only after init). Template updates and per-token overrides go through the Safe. | 3 d |
| 4 | `OmniOFTFactory` (Base, BNB) | `mirror(homeToken, name, symbol)` — permissionless; CREATE2 OFT (same salt), wires peer to the deterministic home adapter + template config. | 1.5 d |
| 5 | `CrossSellReceiver` (home) | `ILayerZeroComposer.lzCompose` from the adapter: sells received tokens via the router with `minOut`/deadline from the compose message; USDG to the seller's Robinhood address (phase 2: bridge back via Relay/Across). | 2 d |
| — | Tests | Foundry with `TestHelperOz5` (3 mocked endpoints), dust/`sharedDecimals` cases, peer freeze, rate limit, compose failure → retry, reconcile invariant `adapter.balance == Σ remote totalSupply`. | 3 d |

Contracts total ≈ **14 engineer-days**; adds to the audit scope (LayerZero's OFT code is audited, ours on top is thin).

### Keeper (`indexer/src/keeper.ts` → new `omniTick`)

- After `PoolGraduated`: call `OmniAdapterFactory.enable(token)` on Robinhood (≈ $0.30 gas), then `OmniOFTFactory.mirror` on Base and BNB (new funded keys, `viem` clients per chain, same simulate-then-send discipline), then poll the LayerZero Scan API for the wiring messages and record `omni.status` per token in `store`. Solana: init OFT Store + mint via `@layerzerolabs/oft-v2-solana-sdk`, then `setSolanaPeer`. Retries are idempotent (CREATE2 addresses, one-shot setters). ≈ **5 d** EVM, **+4 d** Solana.

### Indexer

- Decode `OmniEnabled`; expose `GET /omni/:token` → adapter, per-chain OFT address, locked supply, per-chain circulating supply (remote `totalSupply` via Base/BNB RPC; Solana mint supply), recent messages (LayerZero Scan), status. Add the reconcile check "locked == Σ remote supply" to `/reconcile`. Remote holder counts via remote `Transfer` logs (Base/BNB `eth_getLogs`; Solana `getTokenLargestAccounts`) — receipts mode as on Arc where needed. ≈ **5 d**.

### Web

- Token page "Everywhere" block (Spectrum bundle IA): one price (home pool), per-chain share bars, per-chain contract + explorer link, "Bridge to Base/BNB/Solana" (adapter `send`, fee from `quoteSend`), "Sell from Base" (OFT send + compose, wagmi multi-chain; Solana via Privy Solana wallet). `/verify`: omni contracts + code hashes + the ownership disclosure. Portfolio: remote balances as separate rows ("on Base"). `/api-docs`: the `/omni` endpoint. ≈ **7 d** EVM, **+4 d** Solana.

### Ops

- Safes on Base and BNB (same signers); Squads on Solana; keeper gas on Base/BNB/Solana; LayerZero Scan API key; DVN template review each quarter (LayerZero can roll libraries forward). 1–2 d.

### Sequencing and totals

1. **Testnet demo (2–3 weeks):** contracts 0–4 + tests, keeper `omniTick`, minimal indexer `/omni`, "Everywhere" block; Robinhood testnet ↔ Base Sepolia ↔ BSC testnet; buy leg via the OFT'd stand-in + compose (§5). Evidence JSON per deploy as usual.
2. **Mainnet EVM (after audit):** same code on 4663 ↔ 8453 ↔ 56, routers for the buy leg, Safes as owners. ≈ 1 week of deployment/verification work on top.
3. **Solana (+2–3 weeks):** OFT program (once, ≈ 3.9 SOL), per-token init in the keeper, Privy Solana path in the web, deBridge hook for the Solana buy leg.

EVM omnichain layer ≈ **5–6 engineer-weeks** including tests; Solana ≈ **+2–3 weeks**. Phase 0 (buy leg, no OFT) is contract-complete; deploying it on both networks and wiring the quote builders ≈ 3–4 days, and it is prerequisite for both.

### Open questions to settle before building

- DVN template: 2-of-2 (LayerZero Labs + Nethermind) at 5 confirmations on Robinhood (≈ 0.5 s) vs Paxos's 40 — pick per pathway; remote-side confirmations follow LayerZero's recommended values for Base/BSC.
- Whether the adapter's `enforcedOptions` should include a compose gas budget by default (cheaper sells, slightly higher plain-transfer fee) or use per-transaction `extraOptions`.
- Whether `PonsV2LauncherToken` should gain an immutable `getCCIPAdmin()` for future launches to keep CCIP as a second rail option (no supply split as long as it is never enabled for a token that has an adapter).

## 7. Sources

- LayerZero metadata API `https://metadata.layerzero-api.com/v1/metadata`; deployments page `https://docs.layerzero.network/v2/deployments/chains/robinhood`; OFTAdapter `https://docs.layerzero.network/v2/developers/evm/oft/adapter`; Solana OFT `https://docs.layerzero.network/v2/developers/solana/oft/overview`; default config / dead DVN `https://docs.layerzero.network/v2/developers/evm/protocol-gas-settings/default-config`; security stack `https://docs.layerzero.network/v2/concepts/modular-security/security-stack-dvns`; composing `https://docs.layerzero.network/v2/concepts/applications/composer-standard`; wiring `https://docs.layerzero.network/v2/get-started/create-lz-oapp/configuring-pathways`; USDG OFT addresses `https://docs.paxos.com/guides/stablecoin/usdg/mainnet`; announcement `https://x.com/LayerZero_Core/status/2072396480770674832`; $SCAN example `https://x.com/bankrbot/status/2076501474931306731`.
- Hyperlane registry `https://github.com/hyperlane-xyz/hyperlane-registry/tree/main/chains/robinhood`; warp routes `https://docs.hyperlane.xyz/docs/protocol/warp-routes/warp-routes-overview`.
- Wormhole `https://github.com/wormhole-foundation/wormhole-sdk-ts/blob/main/core/base/src/constants/contracts/core.ts` (+ `relayer.ts`, `tokenBridge.ts`); NTT networks `https://wormhole.com/docs/products/token-transfers/native-token-transfers/reference/supported-networks/`.
- Chainlink CCIP directory `https://docs.chain.link/ccip/directory/mainnet/chain/robinhood-mainnet`, `https://docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet`; data `https://github.com/smartcontractkit/documentation/tree/main/src/config/data/ccip/v1_2_0`; CCT registration `https://docs.chain.link/ccip/concepts/cross-chain-token/evm/registration-administration`; overview `https://docs.chain.link/ccip/concepts/cross-chain-token/overview`.
- Circle CCTP `https://developers.circle.com/cctp/cctp-supported-blockchains`.
- Relay `https://api.relay.link/chains`, `https://api.testnets.relay.link/chains`, `https://api.relay.link/quote`; Across `https://docs.across.to/reference/supported-chains`, `https://app.across.to/api/available-routes`, `https://app.across.to/api/suggested-fees`, `https://docs.across.to/instant-bridging/embedded-crosschain-actions/crosschain-actions-integration-guide/using-a-custom-handler-contract`, `https://github.com/across-protocol/contracts/blob/master/contracts/interfaces/SpokePoolMessageHandler.sol`; deBridge `https://dln.debridge.finance/v1.0/supported-chains-info`, `https://dln.debridge.finance/v1.0/dln/order/create-tx`, `https://docs.debridge.com/dln-details/overview/fees-supported-chains.md`, `https://docs.debridge.com/dln-details/overview/deBridge-hooks.md`, `https://docs.debridge.com/dln-details/integration-guidelines/order-creation/hooks/integrating-hooks.md`; LI.FI `https://li.quest/v1/chains`.
- Robinhood Chain docs `https://docs.robinhood.com/chain/bridging/`, `https://docs.robinhood.com/chain/contracts/`; RPCs `https://rpc.mainnet.chain.robinhood.com` (block 71,920,885 at check time), `https://rpc.testnet.chain.robinhood.com` (block 123,925,780).
- Repo: `src/v2/PonsV2LauncherToken.sol` (no owner, fixed supply, `ERC20Burnable`), `src/v2/PonsV2LaunchFactory.sol` (`graduate`, `PoolGraduated`), `src/pound/CrossBuyReceiver.sol` + `docs/CROSS_CHAIN_BUY.md` (buy-leg receiver, uncommitted), `indexer/src/keeper.ts`, `web/lib/networks.ts`.
