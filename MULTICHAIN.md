# Radian — multi-chain playbook

Radian's contracts are EVM Solidity, so they deploy on any EVM chain. Two things vary per chain,
and both are already handled by the deploy script + network config.

## The USP survives on any chain

On **Arc**, USDC is the native gas coin, so a launch quoted in `msg.value` is dollar-priced for
free. On **Base/BSC/etc.** the gas coin is ETH/BNB — but the factory already supports **ERC-20
quote assets** (we shipped this with EURC). So on those chains we approve **that chain's USDC
ERC-20** as the quote and feature it in the UI: launches stay "priced in real dollars," just as an
ERC-20 instead of native. `DeployMainnet.s.sol` does this when you set `QUOTE_TOKEN`.

## Canonical Uniswap V4 per chain (graduation venue)

Graduation needs Uniswap V4. Verified deployments (Sept 2026):

| Chain | Chain ID | V4 PoolManager | Notes |
| --- | --- | --- | --- |
| Arc mainnet | 5042 | `0x8366a39c…40951` | canonical (Uniswap ships v4 on Arc) |
| **Base** | 8453 | `0x498581fF…52b2b` | canonical, verified on BaseScan |
| **BSC** | 56 | `0x28e2ea09…e9e9df` | canonical, verified on BscScan |
| Robinhood Chain | 4663 | `0x8366a39c…40951` | canonical; PositionManager `0x58daec31…04fa7`, Quoter `0x8dc178ef…98f94`, StateView `0xf3334192…e673b` (Uniswap docs, verified on-chain 2026-09-16) |
| Robinhood Chain testnet | 46630 | `0x8366a39c…40951` | same addresses as mainnet incl. PositionManager (code verified on-chain); not in Uniswap docs |
| X Layer (OKX) | 196 | **unverified** | check before assuming |

Where a chain has **no** V4, we deploy our own base (as we did on Arc testnet). `Permit2`
(`0x0000…78BA3`), `Multicall3` (`0xcA11…CA11`), and the CREATE2 deployer are canonical across
chains. The **PositionManager** address per chain must be fetched from Uniswap's deployments at
deploy time (not all are memorized here — do not guess).

## Robinhood Chain (verified 2026-09-16)

Arbitrum Orbit L2, **ETH gas**, mainnet 4663 (public RPC `https://rpc.mainnet.chain.robinhood.com`,
~0.1–0.25 s blocks, baseFee ≈ 0.056 gwei), testnet 46630 (`https://rpc.testnet.chain.robinhood.com`,
explorer `explorer.testnet.chain.robinhood.com`). Both networks have canonical Uniswap V4
(PoolManager, PositionManager, Quoter, StateView), Permit2, Multicall3 and the CREATE2 deployer at
the standard addresses; a 28 KB hook is deployed there, so the code-size limit is above EIP-170.

- **Stablecoin**: USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6-dec, mainnet only). No USDC
  listed in Robinhood's docs. WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (mainnet only).
- **Stock tokens**: 194 active, all on 4663 only (none on the testnet), 18-dec ERC-20, ERC-8056
  `uiMultiplier()` for dividends/splits (NVDA `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, multiplier
  1.00078). Registry: `GET https://api.robinhood.com/rhj/assets` (`deployments[].contractAddress`,
  `tradingCapabilities`). **Transfers are permissionless on-chain** (eth_call of `transfer` from the V4
  PoolManager, which holds 33.7k NVDA, to an EOA and to a contract both succeed); the US-person and
  UK/CA/CH restrictions are enforced by Robinhood off-chain. Issuer can pause/upgrade (beacon proxy).
- **Deploying Radian there**: `script/DeployChain.s.sol` (amounts in wei of the gas coin; simulated
  end-to-end on 46630: ≈38M gas, 0.00076 ETH). On the testnet we deploy dollar/stock stand-ins
  (`DEPLOY_STANDINS=true`); on mainnet approve USDG as the dollar quote (`QUOTE_TOKEN`). The
  indexer runs the same image with `CHAIN_ID=46630 RPC_URL=… NATIVE_SYMBOL=ETH SCAN_MODE=logs`
  (eth_getLogs ranges of 20k blocks work on the public RPC). The $RADIAN flywheel contracts are
  native-coin based and would pay ETH there; an ERC-20-reward variant is needed before launching
  the flywheel on an ETH-gas chain.
- **Testnet ETH**: faucets need a human. QuickNode's checks for a small *Ethereum mainnet* balance on
  the recipient; `faucet.zalalena.com/robinhood` only needs a captcha (60-min cooldown).
- **Deployed 2026-09-16** (addresses in `HANDOFF.md`): factory `0x55622f7e…48F6`, router
  `0x5AC74F26…a3Da`, executor `0xefb3FBDC…e11c`; indexer
  `https://radian-indexer-robinhood-production.up.railway.app`. First launch + 200 USDGx opening
  buy in one tx confirmed (3.8M gas ≈ 0.00004 ETH at 0.01 gwei).

## Why Base / BSC matter for the RWA (stock) play

**Ondo Global Markets tokenized stocks trade on BSC (chain 56).** Verified from our own `outpost`
code: its 263-instrument universe is all `chainId: 56`; Base/Ethereum addresses are stored as
metadata but "not traded yet". Ondo stock tokens are standard **freely-transferable 18-dec BSC
ERC-20s** that already sit in permissionless PancakeSwap V3 pools. The KYC gate is only on Ondo's
**primary mint/redeem** (the `GMTokenManager` checks an `ondoIDRegistry`); **acquiring inventory on
secondary (DEX / RFQ) needs no KYC**. So "launch a memecoin paired to a real stock token" (approve
the stock token as a pair asset, exactly like we did EURC) is **feasible today on BSC**. Prices come
from **Pyth Hermes** feeds (feed order `[regular, POST, PRE, ON]`, newest publish_time wins).
**Honest caveat:** the stock ERC-20's source isn't in outpost — verify the specific token on
BscScan for a transfer hook/allowlist before building; empirically they move freely.

## Deploy to a new chain (e.g. Base)

```bash
# .env for Base
PRIVATE_KEY=…                 # fresh key funded with ETH for gas
POOL_MANAGER=0x498581fF718922c3f8e6A244956aF099B2652b2b
POSITION_MANAGER=…            # canonical Base v4 PositionManager (fetch from Uniswap deployments)
PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
PROTOCOL_RECIPIENT=…          # treasury/multisig
QUOTE_TOKEN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   # Base USDC (6-dec) → USDC-priced launches
QUOTE_DECIMALS=6
ARC_MAINNET_RPC=…             # or a Base RPC; the script reads generic env

forge script script/DeployMainnet.s.sol --rpc-url <base-rpc> --broadcast
```

The script deploys the Pons V2 suite against Base's canonical V4, approves Base USDC as the quote,
and leaves launch disabled. Then: smoke-test, enable launch, transfer ownership to a multisig
(`TransferOwnership.s.sol`), deploy a Base indexer instance, and fill the `base` block in
`web/lib/networks.ts` (set `live:true`, `hidden:false`, the Pons addresses, deploy block) +
`NEXT_PUBLIC_BASE_RPC` / `NEXT_PUBLIC_BASE_INDEXER_URL` in Vercel. The network switcher then shows
Base and everything (addresses, RPC, indexer, quote asset, explorer) follows.

## Cross-chain — verified facts (2026-09-09)

Everything below was checked against Circle/Arc docs **and** on-chain / live APIs, not assumed.

### CCTP V2 on Arc (end-to-end tested on testnet)

- Arc testnet is **CCTP V2-only, domain 26** (Circle supported-chains table; mainnet not listed yet).
  Contracts (docs.arc.io = on-chain): TokenMessengerV2 `0x8FE6B999…2542DAA`, MessageTransmitterV2
  `0xE737e5cE…1CE275` (`localDomain()=26`, `version()=1`), TokenMinterV2 `0xb43db544…bcF192`,
  USDC ERC-20 view `0x3600…0000` (6-dec). The V1 testnet addresses have **no code**; the V1
  `depositForBurn` selector reverts on Arc.
- The TokenMessengerV2 implementation bytecode contains `depositForBurnWithHook` (`0x779b432d`) —
  the hooks entrypoint is deployed.
- **Live test:** burned 1 USDC Arc → Base (domain 6), tx
  `0xd74f304e93ba639f111dd226bcc73319f60e051460c172bb65d1309b2993955c`. Attestation came back
  `complete` (cctpVersion 2, feeExecuted 0) within ~3 min from **`iris-api-sandbox.circle.com`**.
  Two gotchas: testnet attestations are served by the **sandbox** host (the prod host never finds
  them, even though docs.arc.io quotes the prod URL), and Arc requires **`minFinalityThreshold=2000`**
  (1000 stays `pending` forever — circlefin/arc-node#110). The "attestations blocked" report in
  circlefin/evm-cctp-contracts#110 does not reproduce with those two settings.
- **Hooks are opaque metadata — the protocol never executes them.** Circle's Forwarding Service reads
  a `cctp-forward` hook to auto-submit the destination *mint only* (no arbitrary calls). Arc testnet:
  Forwarding Service ✅, Fast Transfer N/A (instant finality), upfront fees ✅. Gateway (unified USDC
  balance, sub-second) is on Arc testnet: GatewayWallet `0x0077777d…A19B9`, GatewayMinter
  `0x0022222A…52475B`. Bridge Kit (`@circle-fin/bridge-kit`) wraps burn/attest/mint.
- **BSC has no native USDC; CCTP on BSC is USYC-only.** An Arc ↔ BSC *USDC* leg via CCTP does not
  exist. Options: USYC over CCTP (permissioned/entitled), or a third-party bridge.

### Interop stacks present on Arc (verified)

| Stack | Arc testnet | Arc mainnet | Evidence |
| --- | --- | --- | --- |
| LayerZero EndpointV2 | `0x6c7ab220…716ff` (eid 40434, code on-chain) | `0x6f475642…8dd5b` (eid 30417) | LZ metadata API + `eid()` read |
| Hyperlane | — | mailbox `0x7f50C577…D7B39` (domain 5042) | hyperlane-registry `chains/arc` |
| Wormhole core | `0xBB73cB66…300dd` (code on-chain, `chainId()=71`) | `0xC8aD24fC…3CF027` | wormhole-sdk-ts constants |
| LI.FI | listed (5042002; tokens USDC, EURC) | listed (5042) but quotes "Chain 5042 is not supported" — no routes until mainnet | li.quest API |
| Relay / deBridge / Across | not listed | not listed | their public chain APIs |

### What this means for Radian

- **"Buy from any chain" = a USDC leg, for USDC-quoted launches.** CCTP V2 + Forwarding Service
  (one tx from the user, Circle completes the mint) or Gateway (instant, needs a prior deposit).
  Then a Radian contract on Arc that receives the USDC and buys. Not before mainnet + aggregator routes.
- **Stock tokens don't move.** A stock-paired product lives where the stock lives (BSC / Robinhood
  Chain). Wrapping a tokenized stock onto Arc via LayerZero OFT / Hyperlane Warp / Wormhole NTT is
  technically possible (endpoints exist) but yields a non-issuer wrapped security — not planned.
- **Multi-chain deployment** (independent instances per chain) remains the low-risk path this doc covers.

## Positioning

Arc stays the flagship (native-dollar home, EURC/USYC RWA now, stocks if they arrive). Base/BSC
extend reach and unlock the tokenized-stock pairing today. Same codebase, per-chain config.
