# Radian

**Radian** — the memecoin launchpad for **Circle's Arc chain**, quoted in Arc's
**native USDC**. A radian is the unit that measures an arc; Radian is how tokens
get measured out onto Arc.

> Naming & provenance: the trading engine is a faithful port of Pons V2
> (Robinhood Chain's leading launchpad). Their first-party contracts are MIT;
> we keep the original `PonsV2*` contract names and license headers in
> `src/v2/` **unchanged** so anyone can diff our sources byte-for-byte against
> the verified upstream on Sourcify (chain 4663, factory `0x7eD5...EC7e`) and
> confirm the logic is untampered. "Pons" and "ponsfamily" are Pons-Labs'
> brand; Radian is an independent deployment on Arc, not affiliated with
> Pons-Labs, Robinhood, or Circle. All product-level branding (frontend,
> docs, protocol token) uses Radian.

Two generations live in this repo:

- **`src/v2/` — faithful Pons V2 port (the real thing).** Verified production sources
  fetched from Sourcify (exact_match of the live Robinhood Chain factory
  `0x7eD5...EC7e`), deployed on Arc testnet against our own Uniswap V4 base.
  Bonding curve → graduation into a permanently locked full-range V4 pool with the
  singleton `PonsV2MemeHook`, snipe tax, creator tax, fee escrow, five-year buyback
  vault. Quote asset: native USDC (`pairToken = 0`).
- **`src/` — v0 simplified launchpad** (our first Arc deployment, kept as a working
  baseline; see the v0 section below).

## Pons V2 on Arc testnet (deployed 2026-09-09)

| Contract | Address |
|---|---|
| `PoolManager` (Uniswap V4) | `0x24219d0F3611fE4E438850bB7DB165439957dc9f` |
| `PositionManager` (Uniswap V4) | `0x76099b39E6678018FB5B65c4e977C93e27fa9aF1` |
| `PoolSwapTest` (test router) | `0xD29ee84A8ad72A510D9dF9cB7A5021546431D97E` |
| `PonsV2FeeEscrow` | `0x6133392C976d5160CBDE63815f7cd63122f3841C` |
| `PonsV2MemeHook` | `0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044` |
| `PonsV2BuybackVault` | `0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e` |
| `PonsV2LaunchLocker` | `0x7efb5B773BBbf69Bd163b52b1BA88C529a0f123c` |
| `PonsV2LaunchFactory` | `0x90022cC2107De9c070F889E3A67009FcA270E4E2` |
| `PonsV2GraduationExecutor` | `0x1b888f930c6a855D015cB21F81a289EA7b7b4a69` |
| `PonsV2LaunchDeployer` | `0xa8D3DFEE672ee92663298300030a1DFB078Cb552` |
| Permit2 (canonical, pre-existing) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Launch config 0: supply 1B, curve fee 1%, phantom quote **8 USDC**, graduation at
**20 USDC** (production Robinhood shape 1.68 : 4.2 scaled for faucet wallets),
V4 pool fee 0 (the hook takes the fee), tickSpacing 200. Launch fee 1 USDC.
Hook policy defaults: protocol 30% / buyback 50% of the remainder, hook fee 1%,
max internal price impact 3%.

E2E verified on-chain (launch `APONE` `0xA1d3...ee3A`): curve buy → `sweepFees`
(escrow credited, buyback bought + locked in the 5-year vault) → oversized buy
auto-graduates with refund → full-range V4 position minted to the locker →
swaps both directions through `PonsV2MemeHook`.

### Build note

`lib/v4-core` and `lib/v4-periphery` are full official Uniswap clones (needed for
`PoolManager`/`PositionManager` deployment) and are git-ignored. Restore with:

```bash
git clone --depth 1 https://github.com/Uniswap/v4-core lib/v4-core && git -C lib/v4-core submodule update --init --depth 1 lib/solmate lib/forge-std
```

```bash
git clone --depth 1 --recurse-submodules --shallow-submodules https://github.com/Uniswap/v4-periphery lib/v4-periphery
```

Compiler: solc 0.8.26, `evm_version = cancun` (TSTORE probed live on Arc testnet ✓),
viaIR, optimizer 200 — matching the production Pons V2 build (which used 0.8.35).
Licensing: first-party Pons contracts are MIT; Uniswap v4-core is BUSL-1.1 (testnet
use fine; review before any production mainnet deployment), v4-periphery MIT/GPL.

---

# v0 — simplified launchpad (first deployment)

Anyone can launch a fixed-supply (1B) token in one transaction; it trades immediately on a
constant-product bonding curve against native USDC. Liquidity is locked forever — no one
(including the factory owner) can withdraw reserve USDC or reserve tokens. 1% fee per trade,
split 50/50 between the token creator and the protocol treasury. When a pool's real USDC
reserve crosses the graduation threshold it emits `Graduated` and trading continues.

## Why native USDC (and the 18/6 decimals gotcha)

Arc uses USDC as the native gas token. **`msg.value` is 18-decimal native units**; the
6-decimal USDC is only the optional ERC-20 display interface at
`0x3600000000000000000000000000000000000000` — same underlying balance. All contract math
here is 18-decimal native. There is no WETH and (as of testnet docs) no canonical DEX on
Arc, so graduation keeps liquidity in the locked curve pool rather than migrating.

## Contracts

| Contract | Role |
|---|---|
| `LaunchpadFactory` | `createToken(name, symbol, metadataURI)` payable — deploys pool + token atomically. Owner params (`launchFee`, `virtualUsdc`, `graduationReserve`, `feeBps`, `creatorShareBps`) affect **future launches only**. |
| `LaunchToken` | Fixed 1B supply ERC20, fully minted to its pool at creation. No owner, no mint. |
| `CurvePool` | x·y=k curve with a virtual USDC reserve (bootstrap price, no seed capital). `buy` (payable) / `sell` with slippage + deadline guards; pull-pattern fee claims; reentrancy-guarded. |

Default params: launch fee 1 USDC · virtual reserve 6,000 USDC (initial FDV ≈ $6k) ·
graduation at 20,000 USDC real reserve · 1% trade fee, 50% to creator.

## Arc network reference (verified from docs.arc.io, Sep 2026)

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `5042002` | `5042` (public launch 2026-09-16) |
| RPC | `https://rpc.testnet.arc.io` | — |
| Explorer | `https://testnet.arcscan.app` | — |
| Faucet | `https://faucet.circle.com` | — |

Gas: EIP-1559 + EWMA smoothing, min base fee 20 gwei (set `maxFeePerGas ≥ 20 gwei`),
target ≈ $0.01/tx. EVM: Osaka baseline; compile with `evm_version = shanghai` (per Arc
docs). `PREVRANDAO` returns 0; blob txs rejected.

## Develop

```bash
forge build
forge test
```

## Deploy to Arc testnet

1. Fund the deployer address with testnet USDC at https://faucet.circle.com
2. `cp .env.example .env` and fill `PRIVATE_KEY`
3. ```bash
   source .env && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
   ```

Launch a token against a deployed factory:

```bash
cast send $FACTORY "createToken(string,string,string)" "My Token" "MTK" "ipfs://…" \
  --value 1ether --rpc-url arc_testnet --private-key $PRIVATE_KEY
```

(`1ether` = 1e18 native units = 1 USDC launch fee.)

## Deployed (Arc testnet, 2026-09-05)

| Contract | Address |
|---|---|
| `LaunchpadFactory` | [`0x112923dec686b647d140ee58c17b0e4b6f804149`](https://testnet.arcscan.app/address/0x112923dec686b647d140ee58c17b0e4b6f804149) |
| PTEST smoke-test token | `0x9eca6733e1844b5391a501c8112331ac3164bb40` |
| PTEST pool | `0x2697dd5b00e127a66e76c35484644d333ccc0c2a` |

Smoke test passed end-to-end on-chain: launch (1 USDC fee) → buy 5 USDC → sell half back.
Curve math matched theory exactly; pool native balance == realUsdc + unclaimed fees at
every step. Note: Arc emits ERC20-style `Transfer` logs from `0xff…fe` for native USDC
moves — useful for indexing.

## Status / roadmap

- [x] Phase 1 — contracts + 14-test suite (incl. fuzz solvency invariant), all passing
- [x] Phase 2 — deployed to Arc testnet + live smoke test (launch/buy/sell verified)
- [ ] Phase 3 — indexer + web frontend (launch form, token list, trade UI)
- [ ] Phase 4 — $PONS-style protocol token & buyback/burn loop (design open)
