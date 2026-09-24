# Radian

**Radian** is a PvE memecoin launchpad on **Robinhood Chain** (and Circle's **Arc**, testnet).
Every launch is priced in a dollar or a share, never in a volatile gas coin: USDG or native USDC by
default, stock tokens where they exist. A token launches in one transaction, trades on a bonding curve,
graduates into a permanently locked Uniswap V4 pool, and every fee it ever earns feeds **The Pound**:
referrers and creators are paid first, most of the rest buys and burns the graduated coins of the Pack,
and the remainder goes to the treasury. Nothing is minted for anyone.

Radian is not affiliated with Robinhood, Circle or Pons-Labs. The trading engine is a faithful port of
Pons V2 (MIT; sources fetched from Sourcify and kept byte-identical in `src/v2/`, see *Provenance*).

| Where to look | What it is |
| --- | --- |
| [`HANDOFF.md`](HANDOFF.md) | Overview, every deployed address per chain, what is proven on-chain, known constraints |
| [`docs/POUND_CORE.md`](docs/POUND_CORE.md) · [`docs/THE_POUND_RESEARCH.md`](docs/THE_POUND_RESEARCH.md) | The Pound: money flow, knobs, attribution rule; the research and decisions behind it |
| [`MAINNET_RUNBOOK.md`](MAINNET_RUNBOOK.md) · [`safe/`](safe/README.md) | Go-live checklist; the Safe batches that own mainnet (proposed through the Safe API, executed by the owner) |
| [`MULTICHAIN.md`](MULTICHAIN.md) · [`RADIAN_DESIGN.md`](RADIAN_DESIGN.md) · [`CLAIMS.md`](CLAIMS.md) | Verified chain facts; the (retired on Robinhood) $RADIAN flywheel; what the site may claim |
| [`web/DESIGN.md`](web/DESIGN.md) | The web design system, page conventions, the rebuild phases, security headers |

## Networks

| Network | Chain | State (2026-09-24) |
| --- | --- | --- |
| **Robinhood Chain** (mainnet) | 4663, ETH gas, canonical Uniswap V4 | Full stack deployed, owned by a Safe. **The Pound is live** (hook protocol share → PoundVault, router v4 forwarder, executor v2). Launches are still closed to the public and the Pack is empty until the go-live checklist is done. Quote: USDG. |
| **Robinhood Chain testnet** | 46630 | Everything live incl. The Pound with Pack #0; USDGx and NVDAx / TSLAx / AAPLx stand-ins. Default network of the site. |
| **Arc testnet** | 5042002, USDC gas | The original deployment: Pons V2 port, launch templates, executor, the $RADIAN staking flywheel. EURC and eight stock stand-ins as quotes. |
| Arc mainnet · Base | 5042 · 8453 | Scaffolded in `web/lib/networks.ts`, hidden. |

Addresses, deploy blocks and smoke launches for each chain are in `HANDOFF.md`; the site's network
switcher and the indexer services follow the same table.

## How it works

1. **Launch** — one transaction through `RadianLaunchRouter` (the factory's trusted forwarder; the
   launch is attributed to the user): pick a name, a quote asset, the creator tax, optionally an opening
   buy. Three templates: **Standard**, **The Wall** (creator fees fund a per-launch treasury that keeps a
   standing bid under book value on the curve and, after graduation, a seven-rung ladder in the pool),
   **Proof-of-Fee** (creator fees buy the token back and pay it out to the traders whose fees funded it).
   Templates are behind `templatesEnabled` on mainnet.
2. **Trade** — constant-product curve with a phantom quote reserve, 1% fee, a snipe tax in the first
   seconds, an optional creator tax. Trades through the router carry a **referral tag**; a referrer earns
   5.55% of the fee on every trade of the wallets they brought, a creator's referrer earns 5.55% of the
   fee on that launch's trades (`PoundVault.REFERRAL_BPS` / `LAUNCHER_BPS`, immutable).
3. **The Pound** — the hook sends its protocol share (50%) to the `PoundVault`. `settle()` funds the
   referral accruals, sends `burnShareBps` (70%) of the rest to the `PackBurner`, and the remainder to
   the treasury. The burner buys the next Pack coin in rotation on its V4 pool and sends it to the dead
   address, with a floor, a per-burn cap, a daily interval, a slippage bound and a caller bounty.
4. **Graduate** — when the curve crosses its threshold the quote and the remaining tokens become a
   full-range Uniswap V4 position held by the locker forever; the `PonsV2MemeHook` keeps taking the fee.
5. **Delegated buys** — `RadianExecutor`: deposit quote, sign one EIP-712 `BuyAuth` (asset, per-buy cap
   and floor, price floor, gas cap, count, spacing, deadline); the platform keeper executes on schedule,
   never inside the snipe window, tokens land in the user's wallet; 0.5% service fee, withdraw any time.
6. **Agents** — the indexer's `/v1/*` API returns manifests, curve state, quotes and unsigned launch or
   buy plans; it never holds keys or broadcasts.

## Repository

```
src/v2/        Pons V2 port (factory, curve, hook, escrow, buyback vault, locker) — unchanged sources
src/radian/    RadianLaunchRouter, RadianExecutor, wall/ (WallTreasury, WallStaking, WallLadder), pof/ (PoFRouter, PoFVault),
               the $RADIAN staking + treasury flywheel (native and ERC-20 variants; retired on Robinhood)
src/pound/     PoundVault, PackBurner
src/mock/      MockStock and the dollar stand-ins used on testnets
src/           v0 simplified launchpad (first Arc deployment, 2026-09-05; kept as the baseline)
script/        Foundry deploy scripts (DeployChain, DeployPoundCore, DeployRouterV4, DeployExecutor, TransferOwnership,
               VerifyOwnership, smoke and seed launches)
test/          Foundry suites: PonsV2Integration, RadianLaunchRouter, WallTemplate, WallLadder, PoFTemplate, RadianExecutor,
               PoundCore, RadianFlywheel(+ERC20), Launchpad
safe/          Safe Transaction Builder batches for mainnet (ownership, The Pound, open launches)
indexer/       Express + viem indexer, keeper and agent API (one Railway service per chain)
web/           Next.js app (Vercel)
```

### Contracts

```bash
git clone --recurse-submodules --shallow-submodules https://github.com/adrianhihi/radian
cd radian && forge build && forge test
```

solc 0.8.26, `evm_version = cancun` (v4-core needs transient storage; probed live on Arc), viaIR,
optimizer 200, metadata stripped so a fresh clone yields byte-identical bytecode. Dependencies are
submodules pinned to exact commits (`lib/v4-core`, `lib/v4-periphery`, `lib/forge-std`); OpenZeppelin
and `v4-hooks-public` are vendored. Uniswap v4-core is BUSL-1.1: it is deployed on testnets only,
mainnets use the canonical V4.

Deploys: `script/DeployChain.s.sol` (the whole stack on a chain with canonical V4, launches disabled),
`script/DeployPoundCore.s.sol` (vault, burner, router v4, executor v2; on mainnet it prints the Safe
calls instead of wiring), `script/TransferOwnership.s.sol` + `VerifyOwnership.s.sol` (two-step handover
to the Safe). Mainnet owner actions only ever run through the Safe: the batches in `safe/` are proposed
by a delegate key through the Safe API and confirmed by the owner. Keys live in git-ignored `.env`
files and are never pasted anywhere.

### Indexer

`indexer/`: walks blocks (receipts on Arc, whose public RPC throttles `eth_getLogs`; `eth_getLogs`
ranges elsewhere), keeps launches, trades, activity, template state, The Pound's ledger and the
per-token metadata in a JSON snapshot on the service's volume (atomic write with a `.bak`), and serves:

- `/launches`, `/token/:addr`, `/activity`, `/stats`, `/radian`, `/pound`, `/pound/referral/:addr`, `/health`
- `/token/:addr/wall` (GET / POST) and `/token/:addr/logo` (POST): the **holder wall** and a **creator logo**
  as signed messages, no gas. A wall post is stored only if its signature verifies and the signer holds
  the token at that moment; a logo only if the signer is the launch's deployer. The logo replaces the
  on-chain one in what the indexer serves; the chain is untouched (`indexer/src/meta.ts`).
- `/upload` + `/img/:file` for launch images, `/v1/manifest`, `/v1/curve/:token`, `/v1/quote`,
  `/v1/launch-plan`, `/v1/auth` for agents.

The same process runs the **keeper** when `KEEPER_PRIVATE_KEY` is set: fee sweeps, Wall `defend()` and
ladder beats, Proof-of-Fee `claimAndBuy`, executor buys, and The Pound's hourly `settle` per asset and
`burn` when the burner's interval has passed. Config is env (`CHAIN_ID`, `RPC_URL`, `FACTORY`,
`LAUNCH_ROUTER`, `LEGACY_ROUTERS`, `POF_ROUTER`, `EXECUTOR`, `EXECUTOR_VERSION`, `POUND_VAULT`,
`PACK_BURNER`, `CODE_HASHES_JSON`, `SNAPSHOT_PATH`, `UPLOAD_DIR`, `PUBLIC_URL`, `SCAN_MODE`).

```bash
cd indexer && npm install && npm test && npm start
railway up -s radian-indexer-robinhood --detach      # deploy; also radian-indexer (Arc) and radian-indexer-robinhood-mainnet
```

The Railway services are not git-connected; `railway up` from `indexer/` is the only deploy path.

### Web

`web/`: Next.js 15, React 19, Tailwind v4 with the Ember design system shared with baskvia, bilingual
(EN / 中, compile-checked dictionary), Privy login (email, Google, injected wallets, Coinbase Wallet;
embedded wallets for everyone else). Pages: landing, Explore, token page (curve, chart, trade, trades,
fees & contracts, holder wall, template panels, auto-buy), Swap, Create (three-step wizard), Creators,
creator profile (with creator tools: fee recipient, logo), Portfolio, Earn (The Pound: referral link,
claims, the Pack, the ledger), Live, Stats, Learn, Builders, Factory, Verify, Terms. Every page shows
the identity check (pinned code hashes vs. live code) and refuses to trade on a mismatch.

Security headers come from `web/middleware.ts`: a nonce-based Content-Security-Policy (only Next's own
scripts run; connections only to the networks' RPC nodes and indexers, Privy and Coinbase; no framing),
which is why every route renders per request.

```bash
cd web && npm install && npm run build && npm run start   # http://localhost:3040
```

Deploys from `main` on Vercel (root directory `web`). Env: `NEXT_PUBLIC_PRIVY_APP_ID` and the optional
RPC / indexer overrides read in `web/lib/networks.ts`.

## Provenance and trust

- `src/v2/` is the verified Pons V2 source (Sourcify exact match of the Robinhood Chain factory
  `0x7eD5…EC7e`), names and license headers unchanged, so anyone can diff it byte for byte.
- The site pins the code hash of every contract it talks to and re-hashes the live code before any
  launch or trade (`web/lib/identity.ts`; the indexer runs the same check).
- Ownership on Robinhood mainnet is a Safe (factory, hook, vault, locker, staking, treasury, PoundVault,
  PackBurner). Testnets are owned by throwaway keys.
- Audit round 1 (2026-09-10) is in; an external review of `src/radian/` and `src/pound/` and the deploy
  wiring is the gate before launches open on mainnet. Risk notes live on the site's Verify and Terms pages.

## Arc network reference

| | Testnet | Mainnet |
| --- | --- | --- |
| Chain ID | `5042002` | `5042` (public since 2026-09-16) |
| RPC / explorer | `https://rpc.testnet.arc.io` / `https://testnet.arcscan.app` | `https://arcscan.app` |
| Faucet | `https://faucet.circle.com` | — |

USDC is the gas coin: `msg.value` is 18-decimal native units, the 6-decimal ERC-20 view at
`0x3600…0000` is the same balance. EIP-1559 with a 20 gwei minimum base fee; `PREVRANDAO` is 0.

## Status

- [x] v0 launchpad → Pons V2 port with our own V4 base on Arc testnet, indexer, web (Sep 2026)
- [x] $RADIAN flywheel (Arc), launch templates (The Wall, Proof-of-Fee), delegated buys, agent API
- [x] Robinhood Chain testnet and mainnet stacks; mainnet owned by the Safe
- [x] The Pound: core contracts, router v4 referral tags, executor v2; live on Robinhood testnet and mainnet
- [x] Web rebuilt on the shared design system, bilingual; holder wall and creator logos; CSP
- [ ] Pack coins on mainnet (`addPack` from the Safe), go-live checklist, launches opened to the public
- [ ] External review; Arc mainnet
