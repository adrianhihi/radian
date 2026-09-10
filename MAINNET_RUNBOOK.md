# Radian — Arc Mainnet Deployment Runbook

Arc mainnet: **chain id 5042**, native gas token **USDC** (18-dec `msg.value`; 6-dec ERC-20
view at `0x3600…0000`), public launch **2026-09-16**. Explorer: Arcscan (mainnet URL TBD).

This runbook takes Radian from the testnet build to a mainnet launch. It is written to be
**fail-safe**: launch is DISABLED at deploy and only enabled after an on-chain smoke test, and
ownership moves to a multisig only after that. Nothing here is reversible carelessly.

---

## 0. Key difference from testnet

On testnet we deployed **our own** Uniswap V4 (PoolManager + PositionManager). On **mainnet,
Uniswap ships v4 on Arc**, so we use the **canonical** deployment and deploy **only the Pons V2
suite**. This shrinks the surface and removes the BUSL question — we deploy no v4-core code, we
only compile against its interfaces (see §7).

`script/DeployMainnet.s.sol` reflects this: it takes `POOL_MANAGER` / `POSITION_MANAGER` from env
and deploys FeeEscrow → MemeHook (salt-mined) → BuybackVault → Locker → Factory → Executor →
Deployer, wires them, adds the launch config, and leaves launch **disabled**.

## 1. Prerequisites (you must provide)

- [ ] **A fresh deployer key**, funded with mainnet USDC for gas. **Never reuse the testnet key.**
      Keep it in a separate `.env.mainnet` (never in `.env`, which holds the testnet key) and
      `source .env.mainnet` only in the shell you deploy from.
- [ ] **A multisig** (Gnosis Safe on Arc) to own the protocol. Note its address. It must be a
      contract — `TransferOwnership.s.sol` refuses an EOA.
- [ ] **Mainnet RPC** (`ARC_MAINNET_RPC`) — Arc public RPC or a provider key.
- [ ] **Canonical Arc v4 addresses**, confirmed on Arcscan at launch:
  - `POOL_MANAGER` — expected `0x8366a39cc670b4001a1121b8f6a443a643e40951` (verify!)
  - `POSITION_MANAGER` — **fetch at launch** from Uniswap's Arc deployment
    (github.com/Uniswap/docs or the Uniswap deployments repo). Not published pre-launch.
  - `PERMIT2` = `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, verify code exists)
  - CREATE2 deployer `0x4e59…4956C` (Arachnid, needed for the hook salt; verify code exists)
- [ ] **Reproducible build**: `lib/v4-core`, `lib/v4-periphery` and OpenZeppelin pinned at the
      recorded commits (see `foundry.lock` / README "Build"). The hook's salt mining depends on
      exact bytecode.

## 2. Finalize production parameters

Defaults in `.env.example` keep Pons's curve **shape** (phantom : graduation = 2.5 : 1) at a
mainnet scale — **review these as a business decision before deploying**:

| Param | Default | Meaning |
| --- | --- | --- |
| `LAUNCH_FEE_USDC` | 1 | Fee to create a token |
| `PHANTOM_USDC` | 4,000 | Opening virtual reserve → sets initial price / FDV |
| `GRADUATION_USDC` | 10,000 | Real USDC that graduates the curve into the V4 pool |
| `QUOTE_TOKEN` / `QUOTE_*` | unset on Arc | Only for chains where USDC is an ERC-20 (see MULTICHAIN.md) |

Curve fee is 1% (`curveFeeBps: 100`), supply 1B, tickSpacing 200 — hardcoded to match the
verified upstream. Change the USDC values via env, not code.

## 3. Pre-deploy checks

```bash
cd /path/to/ponsOnCircle && cp .env.example .env.mainnet   # fill in every mainnet value
forge build
forge test                                                  # 33 tests: 14 v0 + 4 v2 integration + 15 flywheel, all green
```

- [ ] `cast chain-id --rpc-url arc_mainnet` returns **5042**.
- [ ] `cast code <POOL_MANAGER> --rpc-url arc_mainnet` is non-empty (and same for POSITION_MANAGER,
      PERMIT2, CREATE2 deployer). **If any is empty, stop** — the address is wrong or not yet live.
- [ ] Deployer balance covers gas: `cast balance <deployer> --rpc-url arc_mainnet`.

## 4. Deploy the launchpad (launch stays disabled)

```bash
source .env.mainnet && forge script script/DeployMainnet.s.sol --rpc-url arc_mainnet --broadcast
```

`PROTOCOL_RECIPIENT` may be left as the deployer here — §5b re-points it at the treasury.
Record every printed address into `.env.mainnet` (`FACTORY`, `HOOK`, `VAULT`, `LOCKER`, …). Verify:

```bash
cast call $FACTORY "owner()(address)" --rpc-url arc_mainnet          # = deployer
cast call $FACTORY "launchEnabled()(bool)" --rpc-url arc_mainnet     # = false
cast call $FACTORY "poolManager()(address)" --rpc-url arc_mainnet    # = canonical PoolManager
```

## 5. Smoke test on mainnet (small, real)

Enable launch temporarily via a whitelisted launcher OR flip `setLaunchEnabled(true)` briefly,
then launch one throwaway token with a tiny dev buy and confirm the full lifecycle:

- launch → curve buy → `sweepFees` (buyback vests in the vault) → a graduating buy →
  `createGraduatedPool` seeds a **canonical** V4 pool → a swap through `PonsV2MemeHook`.

Use the same flow proven on testnet (see `script/E2ELaunch.s.sol` as a template — repoint its
constants at the mainnet addresses). **If anything reverts, do NOT enable public launch.**

## 5b. Deploy the $RADIAN flywheel and wire it (before the handover)

```bash
export FACTORY=… HOOK=… OWNER=<multisig> KEEPER=<keeper EOA or cron signer>
source .env.mainnet && forge script script/DeployRadian.s.sol --rpc-url arc_mainnet --broadcast
```

The script launches $RADIAN on the launchpad (launch fee read from the factory, never hardcoded),
deploys `RadianStaking` + `RadianTreasury`, wires `treasury.setStaking` / `staking.setRewardsDistributor`,
sets the keeper, and calls **`hook.setProtocolFeeRecipient(treasury)`** so protocol revenue flows
into the flywheel. With `OWNER` set to the multisig it also starts the two-step handover of both.

How revenue moves (all on-chain, all permissionless except `flush`):

1. Fees accrue to the treasury's balance in `PonsV2FeeEscrow` (and the hook pays some directly).
2. Anyone calls `treasury.claimFees()` — funds can only land in the treasury.
3. The keeper calls `treasury.flush(minRadianOut, deadline)` with an off-chain quote from
   `curve.getReserves()`. A buyback executes only with `minRadianOut > 0`, is capped at
   `maxBuybackReserveBps` (5%) of the curve's quote reserve per flush, and flushes are rate-limited
   (`minFlushInterval`, 1 h). Bought-back $RADIAN is burned; the rest streams to stakers over 7 days.

Record `STAKING` and `TREASURY` in `.env.mainnet`. Set up the keeper cron (`claimFees` then `flush`).

## 6. Go live, then hand over ownership

1. `cast send $FACTORY "setLaunchEnabled(bool)" true …` (if not already).
2. Point the frontend + indexer at mainnet — see §6b.
3. Transfer ownership of all **six** owned contracts to the multisig:
   ```bash
   export MULTISIG=… FACTORY=… HOOK=… VAULT=… LOCKER=… STAKING=… TREASURY=…
   source .env.mainnet && forge script script/TransferOwnership.s.sol --rpc-url arc_mainnet --broadcast
   ```
   All six are **Ownable2Step** → this only sets the *pending* owner. **The multisig must then call
   `acceptOwnership()` on each** (Factory, Hook, Vault, Locker, RadianStaking, RadianTreasury).
4. Verify — this reverts if anything is still owned by the deployer, still pending, or unwired:
   ```bash
   forge script script/VerifyOwnership.s.sol --rpc-url arc_mainnet
   ```
5. Retire the deployer: it should hold no role afterwards except (if you chose so) `KEEPER`.
   Prefer a dedicated keeper key; the keeper can only call `flush` within the on-chain bounds.

## 6b. Frontend + indexer cutover (day-of checklist)

The app already has a network switcher; flipping mainnet to live is config only.

**`web/lib/networks.ts` → the `mainnet` block:**
- [ ] `live: false` → **`true`**
- [ ] `rpc:` — leave reading `NEXT_PUBLIC_ARC_MAINNET_RPC` (set it in Vercel, below)
- [ ] `deployBlock:` set to the **first block in which the factory has code** (binary-search it;
      the testnet value was ~2000 blocks late once)
- [ ] `indexerUrl:` — leave reading `NEXT_PUBLIC_MAINNET_INDEXER_URL` (set in Vercel)
- [ ] `contracts:` fill `factory / locker / vault / escrow / hook` from the deploy output
      (`poolManager` is already the canonical value — verify it on Arcscan)
- [ ] `radian:` fill `token / curve / staking / treasury` from §5b
- [ ] `quoteAssets:` add any approved pair assets (mainnet EURC / a real tokenized stock) once
      approved on the factory, with `gradGoal` and, for stocks, `stock: { refSymbol, standIn: false }`

**Vercel → Project → Settings → Environment Variables (Production):**
- [ ] `NEXT_PUBLIC_ARC_MAINNET_RPC` = the Arc mainnet RPC
- [ ] `NEXT_PUBLIC_MAINNET_INDEXER_URL` = the mainnet indexer URL (see below)

**Indexer (Railway):** deploy a **second** service for mainnet. The indexer is **not**
GitHub-connected — deploy with the CLI: `cd indexer && railway link -p <project> -e production -s <service>`
then `railway up`.
- [ ] `indexer/src/config.ts`: point `FACTORY`, `FACTORY_DEPLOY_BLOCK`, `VAULT`, `RADIAN`, `SEED`
      (empty on mainnet) and the quote-asset table at the mainnet addresses; set `ARC_RPC`.
- [ ] Mount a volume at `/data` and set `SNAPSHOT_PATH=/data/radian-index.json`,
      `UPLOAD_DIR=/data/uploads`, `PUBLIC_URL=<service URL>` — token logo URLs are written into
      immutable on-chain metadata, so the host must be permanent.
- [ ] Copy the service's public URL into `NEXT_PUBLIC_MAINNET_INDEXER_URL`.

Then `git push` (Vercel auto-deploys the web app) and switch the top-right toggle to Mainnet to
smoke-test the live UI end to end. Product sites (e.g. `radian-wall`) carry their own addresses.

## 7. Licensing (must clear before mainnet)

- **First-party Pons V2 contracts** (`src/v2/`): MIT. Fine to deploy.
- **Uniswap v4-core**: BUSL-1.1. On mainnet we deploy **none of it** — we use the canonical
  PoolManager and only compile against v4-core *interfaces/libraries*. Confirm no BUSL-licensed
  contract is in our deploy set (it isn't: DeployMainnet deploys only `PonsV2*` + our hook).
- **v4-periphery / Permit2**: MIT / GPL / upstream — we deploy none (canonical PositionManager).
- **`PonsV2MemeHook`** uses `BaseHook` (v4-hooks-public) + interfaces — MIT-compatible.

Net: the mainnet deploy set is our MIT Pons V2 port plus `src/radian/`. No BUSL code is deployed. ✓

## 8. Security posture (see also the audit notes)

- `src/v2/` is **source-identical** to the Sourcify-verified upstream (13/14 exact; the 1 interface
  matches the factory's verified copy). Our compiler settings differ (0.8.26, via-IR, cancun), so
  verify the deployed bytecode on Arcscan with *our* settings; Sourcify's match covers the source.
- Owner "rescue" functions on the Pons contracts are bounded and cannot drain healthy launches.
- `src/radian/` is **ours and not yet externally audited**: two-step ownership, no renounce, native
  USDC leaves the treasury only through `flush`, `setStaking` validates the pool's token, buybacks
  are capped and rate-limited, `$RADIAN` cannot be rescued. **Get it reviewed before it holds real
  USDC**, together with the hook salt mining and `DeployMainnet` wiring.
- Owner → multisig on all six contracts (§6), verified by `VerifyOwnership`. Fresh deployer key.
  No secrets in git.

## 9. Rollback / abort

- Before §6, nothing is public: launch is disabled and the deployer still owns everything. To
  abort, simply do not enable launch; redeploy fresh if params were wrong.
- After ownership transfer, changes require the multisig. There is no admin path to drain user
  liquidity by design, so "rollback" means pausing new launches (owner can `setLaunchEnabled(false)`)
  — existing curves/pools keep working and remain non-custodial. The treasury's USDC can only ever
  be flushed into buybacks and staker rewards.
