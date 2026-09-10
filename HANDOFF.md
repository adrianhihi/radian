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
