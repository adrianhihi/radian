# Radian — Project Handoff

**Radian** is a memecoin launchpad for **Circle's Arc chain**. Launches are quoted in the asset
their creator chooses — Arc's **native USDC** by default, **EURC**, or (on testnet) a clearly
labeled **stock stand-in** — so every token is priced in real money or shares, never a volatile
gas coin. It is a source-identical port of the Pons V2 launchpad (Robinhood Chain's leader)
redeployed on Arc with its own Uniswap V4 base, plus an original product layer (web app, Privy
auth, indexer, live analytics), the **$RADIAN** real-yield flywheel, and a flagship product
(**The Wall**, priced in NVDA shares) in its own repo.

- **Live app:** https://radian-sable.vercel.app (Vercel, production)
- **Platform repo:** https://github.com/adrianhihi/radian (public)
- **Product repo:** https://github.com/adrianhihi/radian-wall → https://radian-wall.vercel.app
- **Indexer:** https://radian-indexer-production.up.railway.app (Railway; deployed with the CLI)
- **Chain:** Arc testnet (Circle), chain id `5042002`, explorer https://testnet.arcscan.app
- **Status:** testnet, end-to-end working, deployed. Mainnet path in [`MAINNET_RUNBOOK.md`](MAINNET_RUNBOOK.md).

---

## 1. What to submit to review (the short list)

| Deliverable | Link |
| --- | --- |
| Platform repo | https://github.com/adrianhihi/radian |
| Product repo (The Wall) | https://github.com/adrianhihi/radian-wall |
| Launch factory (contract) | https://testnet.arcscan.app/address/0x90022cC2107De9c070F889E3A67009FcA270E4E2 |
| First real launch (APONE, graduated) | https://testnet.arcscan.app/address/0xA1d3797855B9e248F27b3a172F31EF7AA5d8ee3A |
| Contracts doc | [`README.md`](README.md) + `/docs` page in the web app |
| Provenance (why the code is trustworthy) | Section 4 below |
| Multi-chain + cross-chain facts (verified) | [`MULTICHAIN.md`](MULTICHAIN.md) |
| Flywheel design | [`RADIAN_DESIGN.md`](RADIAN_DESIGN.md) |

## 2. Deployed contracts (Arc testnet)

| Contract | Address |
| --- | --- |
| `PonsV2LaunchFactory` (entry point) | `0x90022cC2107De9c070F889E3A67009FcA270E4E2` |
| `RadianLaunchRouter` v2 (factory's `launchForwarder`; standard / Wall / Proof-of-Fee launches) | `0xB9F097662302F220989AAeBa6776041d7d625fAE` |
| `RadianLaunchRouter` v1 (retired 2026-09-14; one smoke launch) | `0x2333449a1d83c5F99f29d5a17554D76245412C0E` |
| `PoFRouter` (Proof-of-Fee buys that earn Work) | `0x7a21533EBEdC7222F299dcfd46E0463E744bF6E8` |
| `RadianExecutor` (delegated buys) | `0xbf1fbda5991Ff34733AE74eDB84F74527B9588C1` |
| Template implementations `WallTreasury` / `WallStaking` / `PoFVault` | `0x88f6f47AAFf65B948712f8C87b6eF51C7B6197c4` / `0x7F15D040Ae2A758D891A75e9399ab6b9487e70C1` / `0xeAF10129B449F3108923E666Fb7E7f00eC176bC5` |
| Platform keeper EOA (set on the router + executor; key in `.env` `KEEPER_PRIVATE_KEY` and on Railway) | `0xBb5b9503562CB4a2C86776c55C57EfFF1889779c` |
| Showcase: Stock Treasury `STSHOW` token / treasury / staking | `0xD2aBFD74c4F64B1041A3b33b7e702760aEFEA943` / `0xEB608F66a7B80794989E3fe26FF2d03471D41f13` / `0x671D80d757a86E2E54c8b0E0A49BA3ef964730fC` |
| Showcase: Proof-of-Fee `PFSHOW` token / vault | `0xEA5b921D9Af0125b5971466CC52af923Cf9Fe8A4` / `0x6E08dc1E6e676b2719c95332622d3a4ebdCe5523` |
| `PonsV2MemeHook` (Uniswap V4 hook) | `0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044` |
| `PonsV2BuybackVault` (5-yr linear vest) | `0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e` |
| `PonsV2LaunchLocker` (permanent LP lock) | `0x7efb5B773BBbf69Bd163b52b1BA88C529a0f123c` |
| `PonsV2FeeEscrow` | `0x6133392C976d5160CBDE63815f7cd63122f3841C` |
| `PonsV2GraduationExecutor` | `0x1b888f930c6a855D015cB21F81a289EA7b7b4a69` |
| `PonsV2LaunchDeployer` | `0xa8D3DFEE672ee92663298300030a1DFB078Cb552` |
| `PoolManager` (our Uniswap V4) | `0x24219d0F3611fE4E438850bB7DB165439957dc9f` |
| `PositionManager` (our Uniswap V4) | `0x76099b39E6678018FB5B65c4e977C93e27fa9aF1` |
| Permit2 (canonical, pre-existing) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `$RADIAN` token / curve | `0x0B764B1e50E4D17A897Cdd9494CaC3355579fDcD` / `0x8925494f3cfB34cD0df2b4Bf83328928Fe22F126` |
| `RadianStaking` v2 | `0xf3832Fa6EBa9cD09161C2010c7E93a1A2B7f8B4c` |
| `RadianTreasury` v2 (hook's protocol-fee recipient) | `0xebCcaE2eDDaEfcaA5452058fc8f426dfC9570ba0` |

Quote assets approved on the factory: native USDC, EURC (`0x89B5…D72a`), and eight **testnet
stand-in stock tokens** (`src/mock/MockStock.sol`: NVDAx, TSLAx, AAPLx, GOOGLx, MSFTx, AMZNx,
METAx, SPYx — plain ERC-20s minted by the deployer; addresses in
[`web/lib/networks.ts`](web/lib/networks.ts)). No real tokenized stock exists on Arc yet.

**Live tokens**: 11 launches (APONE graduated; EDOGE quoted in EURC; RKTN, TSLM and The Wall
quoted in stock stand-ins). The Wall v1 is retired in favour of v2 (see the product repo).

## 3. What's proven on-chain

Run end-to-end and read back from Arc (not asserted — verified):

- Launch → curve buy/sell → fee sweep with buyback **vesting in the 5-year vault** (833,685
  tokens for APONE) → oversized buy **auto-graduates with refund** → full-range Uniswap V4
  position **minted to the permanent locker** → swaps both directions through the meme hook.
- ERC-20-quoted launches (EURC, stock stand-ins): approve + buy, curve state, indexer feed.
- $RADIAN flywheel v2: the hook's protocol-fee recipient is the treasury; a bounded
  `flush(minRadianOut, deadline)` burned 246,909 RADIAN and streamed 1.5 USDC to stakers.
- 33 Foundry tests: 14 v0 unit (incl. a fuzzed solvency invariant), 4 v2 integration, 15 flywheel.

## 4. Provenance — why the contracts can be trusted

The trading engine is **not hand-written**: `src/v2/` are the **exact verified sources** of the
live Pons V2 factory on Robinhood Chain, fetched from **Sourcify** (exact_match of
`0x7eD598…EC7e`, chain 4663). We kept the original `PonsV2*` names and MIT headers so anyone
can diff our sources against the audited upstream. Our compiler settings differ (0.8.26, via-IR,
cancun), so on Arc the *bytecode* is ours; on Arcscan only the factory is verified so far —
verification proves source = bytecode, it is not an audit. `src/radian/` and `src/mock/` are
ours and **not externally audited**. "Radian" is our brand; we are not affiliated with
Pons-Labs, Robinhood, or Circle.

## 5. Web app (product layer)

Next.js app in [`web/`](web/). Pages: Explore, Live, Stats, Launch, Earn, Builders, Portfolio,
Docs, plus a network switcher (testnet / mainnet placeholder). Launch discovery and the trade
feed come from the **indexer**; curve state and trades are read live from Arc via Multicall3.
Login via **Privy** (email / Google / wallet, with embedded wallets for non-crypto users).
Trades enforce an on-chain minimum-received (slippage) bound and show the snipe tax.

```bash
cd web && npm install && npm run build && npm run start   # http://localhost:3040
```

(`next dev` works on a normal machine; some sandboxes cap file descriptors and break its watcher.)

## 6. Known constraints (honest)

- **Arc public RPC:** `eth_getLogs` is rate-limited/unreliable and `eth_getBlockReceipts` only
  works one call at a time. The indexer therefore walks blocks and reads receipts (live cursor +
  background history backfill). Details in `indexer/src/scanner.ts`.
- **Uniswap v4-core is BUSL-1.1** — fine for testnet; on mainnet we deploy none of it (canonical
  V4). See the runbook §7.
- **Ownership on testnet is a single EOA** (factory, hook, vault, locker, staking, treasury). The
  mainnet runbook moves all six to a multisig (`TransferOwnership` + `VerifyOwnership`).
- **Privy:** the App ID is public by design. An App Secret was once shared in plaintext; the code
  does not read it anywhere, but **rotate it** in the Privy dashboard and delete it from any
  `.env.local`.
- The deployer key on testnet is a throwaway in a gitignored `.env`; **do not reuse it for mainnet**.
- Stock quote assets on testnet are stand-ins with an unlimited minter — a demo of the mechanic,
  not an asset. Real tokenized stocks live on BSC / Robinhood Chain (see `MULTICHAIN.md`).

## 7. Deployment

- **Frontend → Vercel.** GitHub-connected (`adrianhihi/radian`, root directory `web`); every push to
  `main` deploys, every PR gets a preview. Env: `NEXT_PUBLIC_PRIVY_APP_ID`, indexer/RPC URLs.
- **Indexer → Railway.** Service `radian-indexer`, **not** GitHub-connected: deploy with
  `cd indexer && railway up`. Volume mounted at `/data` (`SNAPSHOT_PATH`, `UPLOAD_DIR`).
- **Product site → Vercel** (`adrianhihi/radian-wall`, static, GitHub-connected).

## 8. Roadmap

- **Mainnet** — Arc mainnet (chain `5042`, 2026-09-16): canonical V4, fresh keys, multisig, the
  flywheel wired at deploy, external review of `src/radian/` + deploy wiring. Runbook is the plan.
- **The Wall Phase 2** — treasury that accumulates NVDA + floor-price buy wall (spec in the
  product repo). Ships after mainnet, an audit, and a real tokenized stock.
- **Multi-chain** — Arc-first, one real-stock spoke (BSC). Verified facts in `MULTICHAIN.md`.

## Robinhood Chain testnet (46630) — live, 2026-09-16

Deployed with `script/DeployChain.s.sol` (Arbitrum Orbit, ETH gas, canonical Uniswap V4). Web:
network switcher → "Robinhood Testnet". Indexer: `https://radian-indexer-robinhood-production.up.railway.app`
(Railway service `radian-indexer-robinhood`, logs mode, own /data volume, same keeper key).
Facts and per-chain notes: `MULTICHAIN.md` → "Robinhood Chain".

| Contract | Address |
|---|---|
| `PonsV2LaunchFactory` | `0x55622f7eD404f982cb6C5fa12268894A580848F6` (deploy block 120304515) |
| `PonsV2MemeHook` | `0x15d5B10A1fCe67c01196EF118E5632B0D18Ca044` |
| `PonsV2FeeEscrow` / `PonsV2BuybackVault` / `PonsV2LaunchLocker` | `0x112923deC686B647D140Ee58C17b0e4B6F804149` / `0xD7aD9E5c0216E09238105363DdaA6Ce3B81eCca1` / `0x61171A1a50AA2493918f6EAf3d9cf112e569FAea` |
| `PonsV2GraduationExecutor` / `PonsV2LaunchDeployer` | `0x24219d0F3611fE4E438850bB7DB165439957dc9f` / `0x76099b39E6678018FB5B65c4e977C93e27fa9aF1` |
| `RadianLaunchRouter` (forwarder) / `PoFRouter` | `0x5AC74F2666d284D55e5AEACF122C75fF9268a3Da` / `0xa6B14Ab7490123De19a82521137cA1F59BFA4fC5` |
| `RadianExecutor` | `0xefb3FBDCf95662177d66E264B8394E7BD4Ece11c` |
| Template impls `WallTreasury` / `WallStaking` / `PoFVault` | `0xa8D3DFEE672ee92663298300030a1DFB078Cb552` / `0x8F523C5240714033c408760fb8C7f7bF4F3BaD99` / `0xd08304E63ADf9EFc7a0700d9b2aB613A0cA37C37` |
| Uniswap V4 PoolManager / PositionManager (canonical) | `0x8366a39CC670B4001A1121B8F6A443A643e40951` / `0x58daec3116aae6d93017baaea7749052e8a04fa7` |
| Stand-ins: `USDGx` (6-dec) · `NVDAx` · `TSLAx` · `AAPLx` | `0xf6f8fF47fEa2f2cE3195ad197B8A9BF520c13ed0` · `0x4B2E6503e10708d5be2245DE0DED7D0ccF5AeF19` · `0xE8a0d16201bfbA7c42712Fa000B86E0b3BfD0745` · `0x176892e311fB4e517Ed2419626d6F9691bD7DcC6` |
| Launch config 0 | fee 0.0001 ETH · phantom 0.0168 ETH · graduation 0.042 ETH; USDGx phantom 4,000 / grad 10,000; stocks 20 / 50 shares |
| Smoke launch `RHSMK` (hidden candidate) | token `0x59d27c21c159aba27206f75009506fc60b220c0e`, 200 USDGx opening buy in the launch tx |

| `$RADIAN` token / curve (quoted in USDGx; opening buy 500 USDGx) | `0x5300d9Df3D687C1b037A6D124Eb6334cD9dE1B9a` / `0x7387Caee85c6B6E387CF3eb1A1BbE45E2fbc75BA` |
| `RadianStakingERC20` (stake RADIAN, earn USDGx) / `RadianTreasuryERC20` | `0x92237eb32b2b4fA5C6EdB72931b2F515071D1603` / `0x4Ed57EAe3ba1e3399a34fF1D5e56bB79e4cfdb0f` |

The flywheel here is the ERC-20-reward variant (`src/radian/RadianStakingERC20.sol`,
`RadianTreasuryERC20.sol`, `script/DeployRadianERC20.s.sol`, 16 tests): protocol fees in USDGx
buy $RADIAN back and burn it, the rest streams to stakers as USDGx; gas-coin and stock-quote
fees are held for the owner to route. The curve graduates at USDGx's pair threshold (10,000),
after which everything streams to stakers until a pool-side buyback module exists.
Owner is still the deployer EOA; the testnet is not handed to a multisig.

**Keeper roles (both chains, 2026-09-16):** the bot `0xBb5b…779c` is the hook's `feeSweepOperator`
(sweeps every curve's pending fees hourly), the treasury `keeper` (claims + flushes), the template
keeper (Wall `defend` / PoF `claimAndBuy`) and the executor keeper. All of it runs in
`indexer/src/keeper.ts`; every send is simulated first.
