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
- [ ] **A multisig** (Gnosis Safe on Arc) to own the protocol. Note its address.
- [ ] **A treasury address** for protocol fees (can be the multisig).
- [ ] **Mainnet RPC** (`ARC_MAINNET_RPC`) — Arc public RPC or a provider key.
- [ ] **Canonical Arc v4 addresses**, confirmed on Arcscan at launch:
  - `POOL_MANAGER` — expected `0x8366a39cc670b4001a1121b8f6a443a643e40951` (verify!)
  - `POSITION_MANAGER` — **fetch at launch** from Uniswap's Arc deployment
    (github.com/Uniswap/docs or the Uniswap deployments repo). Not published pre-launch.
  - `PERMIT2` = `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical, verify code exists)
  - CREATE2 deployer `0x4e59…4956C` (Arachnid, needed for the hook salt; verify code exists)

## 2. Finalize production parameters

Defaults in `.env.example` keep Pons's curve **shape** (phantom : graduation = 2.5 : 1) at a
mainnet scale — **review these as a business decision before deploying**:

| Param | Default | Meaning |
| --- | --- | --- |
| `LAUNCH_FEE_USDC` | 1 | Fee to create a token |
| `PHANTOM_USDC` | 4,000 | Opening virtual reserve → sets initial price / FDV |
| `GRADUATION_USDC` | 10,000 | Real USDC that graduates the curve into the V4 pool |

Curve fee is 1% (`curveFeeBps: 100`), supply 1B, tickSpacing 200 — hardcoded to match the
verified upstream. Change the three USDC values via env, not code.

## 3. Pre-deploy checks

```bash
cd /path/to/ponsOnCircle && cp .env.example .env    # fill in every mainnet value
forge build
forge test                                          # 14 v0 + 4 v2 integration, all green
```

- [ ] `cast chain-id --rpc-url arc_mainnet` returns **5042**.
- [ ] `cast code <POOL_MANAGER> --rpc-url arc_mainnet` is non-empty (and same for POSITION_MANAGER,
      PERMIT2, CREATE2 deployer). **If any is empty, stop** — the address is wrong or not yet live.
- [ ] Deployer balance covers gas: `cast balance <deployer> --rpc-url arc_mainnet`.

## 4. Deploy (launch stays disabled)

```bash
source .env && forge script script/DeployMainnet.s.sol --rpc-url arc_mainnet --broadcast
```

Record every printed address into `.env` (`FACTORY`, `HOOK`, `VAULT`, `LOCKER`, …). Verify state:

```bash
cast call $FACTORY "owner()(address)" --rpc-url arc_mainnet          # = deployer
cast call $FACTORY "launchEnabled()(bool)" --rpc-url arc_mainnet     # = false
cast call $FACTORY "poolManager()(address)" --rpc-url arc_mainnet    # = canonical PoolManager
```

## 5. Smoke test on mainnet (small, real)

Enable launch temporarily via a whitelisted launcher OR flip `setLaunchEnabled(true)` briefly,
then launch one throwaway token with a tiny dev buy and confirm the full lifecycle:

- launch → curve buy → `sweepFees` (buyback locks in the vault) → a graduating buy →
  `createGraduatedPool` seeds a **canonical** V4 pool → a swap through `PonsV2MemeHook`.

Use the same flow proven on testnet (see `script/E2ELaunch.s.sol` as a template — repoint its
constants at the mainnet addresses). **If anything reverts, do NOT enable public launch.**

## 6. Go live, then hand over ownership

1. `cast send $FACTORY "setLaunchEnabled(bool)" true …` (if not already).
2. Point the frontend + indexer at mainnet (chain 5042, new factory address, canonical addresses,
   mainnet EURC/USDC). Update `web/lib/radian.ts`, `web/lib/registry.ts`, `indexer/src/config.ts`.
3. Transfer ownership to the multisig:
   ```bash
   source .env && forge script script/TransferOwnership.s.sol --rpc-url arc_mainnet --broadcast
   ```
   All four contracts are **Ownable2Step** → this only sets the *pending* owner. **The multisig must
   then call `acceptOwnership()` on each** (Factory, Hook, Vault, Locker) before the transfer takes
   effect. Confirm `owner()` == multisig on all four afterward.

## 7. Licensing (must clear before mainnet)

- **First-party Pons V2 contracts** (`src/v2/`): MIT. Fine to deploy.
- **Uniswap v4-core**: BUSL-1.1. On mainnet we deploy **none of it** — we use the canonical
  PoolManager and only compile against v4-core *interfaces/libraries*. Confirm no BUSL-licensed
  contract is in our deploy set (it isn't: DeployMainnet deploys only `PonsV2*` + our hook).
- **v4-periphery / Permit2**: MIT / GPL / upstream — we deploy none (canonical PositionManager).
- **`PonsV2MemeHook`** uses `BaseHook` (v4-hooks-public) + interfaces — MIT-compatible.

Net: the mainnet deploy set is our MIT Pons V2 port only. No BUSL code is deployed. ✓

## 8. Security posture (see also the audit notes)

- `src/v2/` is **byte-identical** to the Sourcify-verified upstream (13/14 exact; the 1 interface
  matches the factory's verified copy). Diff before trusting.
- Owner "rescue" functions are bounded and cannot drain healthy launches (fees only; the
  graduation rescue is gated by a delay and pre-emptible by anyone via `createGraduatedPool`).
- **Recommended before mainnet:** a third-party review of anything we authored beyond the port —
  the deploy scripts, and any future multi-pool basket factory. The ported engine's risk is low
  given the byte-identical + battle-tested ($4B volume) upstream, but "verified" ≠ "audited".
- Owner → multisig (this runbook, §6). Fresh deployer key. No secrets in git.

## 9. Rollback / abort

- Before §6, nothing is public: launch is disabled and the deployer still owns everything. To
  abort, simply do not enable launch; redeploy fresh if params were wrong.
- After ownership transfer, changes require the multisig. There is no admin path to drain user
  liquidity by design, so "rollback" means pausing new launches (owner can `setLaunchEnabled(false)`)
  — existing curves/pools keep working and remain non-custodial.
