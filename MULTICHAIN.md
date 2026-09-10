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
| Robinhood Chain | 4663 | (Pons uses it) | canonical |
| X Layer (OKX) | 196 | **unverified** | check before assuming |

Where a chain has **no** V4, we deploy our own base (as we did on Arc testnet). `Permit2`
(`0x0000…78BA3`), `Multicall3` (`0xcA11…CA11`), and the CREATE2 deployer are canonical across
chains. The **PositionManager** address per chain must be fetched from Uniswap's deployments at
deploy time (not all are memorized here — do not guess).

## Why Base / BSC matter for the RWA (stock) play

**Ondo Global Markets tokenized stocks live on Base (8453), BSC (56), and Ethereum (1)** — not on
Arc (Arc has USDC + EURC + USYC treasuries, but no tokenized US stocks confirmed). So the
"launch a token paired to a real stock" play (PAIR / BTCNVDA-style) is **doable today on Base/BSC**
using Ondo stock tokens as the quote/pair asset, priced via Pyth feeds. **Open risk to verify per
issuer:** tokenized equities are often transfer-restricted / KYC-gated — confirm the specific Ondo
token is freely transferable and usable in a permissionless curve/AMM before building on it.

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

## Cross-chain (two very different things)

- **Multi-chain deployment** (independent instances per chain): what this doc covers. Low risk,
  mostly config + a deploy per chain. The switcher already handles N networks.
- **True cross-chain** (one token/liquidity spanning chains, or an Arc launch backed by a stock on
  another chain): needs a bridge or oracle. Circle **CCTP** moves native USDC across chains
  (Arc ships CCTP contracts) — clean for cross-chain *USDC flows*. Cross-chain *stock backing*
  additionally needs the issuer's permission + a price oracle and is a real engineering/trust
  undertaking — do not promise it before verifying each piece.

## Positioning

Arc stays the flagship (native-dollar home, EURC/USYC RWA now, stocks if they arrive). Base/BSC
extend reach and unlock the tokenized-stock pairing today. Same codebase, per-chain config.
