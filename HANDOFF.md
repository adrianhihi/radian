# Radian — Project Handoff

**Radian** is a memecoin launchpad for **Circle's Arc chain**, quoted in Arc's **native USDC**.
It is a faithful port of the Pons V2 launchpad (Robinhood Chain's leader), redeployed on Arc
with its own Uniswap V4 base, plus an original product layer (web app, Privy auth, live
analytics). Everything below is **live and verified on Arc testnet** — no mocks.

- **GitHub:** https://github.com/adrianhihi/radian (private)
- **Chain:** Arc testnet (Circle), chain id `5042002`, explorer https://testnet.arcscan.app
- **Status:** testnet, end-to-end working. Mainnet-ready pending the checklist at the bottom.

---

## 1. What to submit to review (the short list)

| Deliverable | Link |
| --- | --- |
| Source repo | https://github.com/adrianhihi/radian |
| Launch factory (contract) | https://testnet.arcscan.app/address/0x90022cC2107De9c070F889E3A67009FcA270E4E2 |
| First real launch (APONE, graduated) | https://testnet.arcscan.app/address/0xA1d3797855B9e248F27b3a172F31EF7AA5d8ee3A |
| Contracts doc | [`README.md`](README.md) + `/docs` page in the web app |
| Provenance (why the code is trustworthy) | Section 4 below |

## 2. Deployed contracts (Arc testnet)

| Contract | Address |
| --- | --- |
| `PonsV2LaunchFactory` (entry point) | `0x90022cC2107De9c070F889E3A67009FcA270E4E2` |
| `PonsV2MemeHook` (Uniswap V4 hook) | `0x15eB3aeE2f96A199165dc58e6C8dc3Ce2e02e044` |
| `PonsV2BuybackVault` (5-yr vesting) | `0xe84D81C3d4f3E12123C9F934AB3Cb8238772b39e` |
| `PonsV2LaunchLocker` (permanent LP lock) | `0x7efb5B773BBbf69Bd163b52b1BA88C529a0f123c` |
| `PonsV2FeeEscrow` | `0x6133392C976d5160CBDE63815f7cd63122f3841C` |
| `PonsV2GraduationExecutor` | `0x1b888f930c6a855D015cB21F81a289EA7b7b4a69` |
| `PonsV2LaunchDeployer` | `0xa8D3DFEE672ee92663298300030a1DFB078Cb552` |
| `PoolManager` (our Uniswap V4) | `0x24219d0F3611fE4E438850bB7DB165439957dc9f` |
| `PositionManager` (our Uniswap V4) | `0x76099b39E6678018FB5B65c4e977C93e27fa9aF1` |
| Permit2 (canonical, pre-existing) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

**Seeded live tokens** (real launches, varied bonding progress): APONE (graduated), Arc Angel,
Stable Shiba, Circle Cat, Dollar Dog, Green Candle. Addresses in [`web/lib/registry.ts`](web/lib/registry.ts).

## 3. What's proven on-chain

Run end-to-end and read back from Arc (not asserted — verified):

- Launch → curve buy/sell → fee sweep with buyback **locked in the 5-year vault** (833,685
  tokens locked for APONE) → oversized buy **auto-graduates with refund** → full-range Uniswap
  V4 position **minted to the permanent locker** → swaps both directions through the meme hook.
- 4/4 local integration tests + 14/14 v0 unit tests (incl. a fuzzed solvency invariant).

## 4. Provenance — why the contracts can be trusted

The trading engine is **not hand-written**: `src/v2/` are the **exact verified sources** of the
live Pons V2 factory on Robinhood Chain, fetched from **Sourcify** (exact_match of
`0x7eD598…EC7e`, chain 4663). We kept the original `PonsV2*` names and MIT headers so anyone
can diff our sources byte-for-byte against the audited upstream and confirm nothing was
tampered with. "Radian" is our brand; we are not affiliated with Pons-Labs, Robinhood, or Circle.

## 5. Web app (product layer)

Next.js app in [`web/`](web/). Pages: Explore, Live, Stats, Launch, Builders, Portfolio, Docs.
All data is read **live from Arc via `eth_call`**. Login via **Privy** (email / Google / wallet,
with embedded wallets for non-crypto users).

```bash
cd web && npm install && npm run dev   # http://localhost:3040
```

Design mirrors the internal `explore-companion` aesthetic (scroll-reveal, Plus Jakarta Sans),
analytics mirror Pons's `/analytics` (count-up counters, buyback/escrow figures).

## 6. Known constraints (honest)

- **Arc public RPC serves `eth_getLogs` unreliably** (lagging/sharded nodes) but `eth_call`
  reliably. So launch *discovery* uses a registry + the user's own browser cache, not log scans.
  A small **indexer** (Phase 4b) removes this and enables a true cross-user trade feed.
- **Uniswap v4-core is BUSL-1.1** — fine for testnet; review the license before any production
  mainnet deployment (it converts to GPL mid-2027).
- **Privy sign-in modal** needs the Privy dashboard configured: enable login methods and add the
  deploy domain + `localhost:3040` to Allowed Origins. The App ID is wired; **rotate the App
  Secret** (it was shared in plaintext) — the code reads it from env, so rotation needs no change.
- The deployer key on testnet is a throwaway in a gitignored `.env`; **do not reuse it for mainnet**.

## 7. Deployment

- **Frontend → Vercel** (recommended). Import the repo, set **Root Directory = `web`**, add env
  `NEXT_PUBLIC_PRIVY_APP_ID`, and add the Vercel domain to Privy Allowed Origins. Zero-config for
  Next.js, global CDN, free tier, preview deploy per PR.
- **Future indexer + DB → Railway.** When we build the indexer (always-on poller + Postgres),
  Railway is the right home — Vercel's serverless model doesn't suit a stateful long-running
  service. Clean split: static/edge frontend on Vercel, stateful backend on Railway.

## 8. Roadmap

- **Phase 4b** — indexer (Railway) + true Live trade feed, removes the getLogs constraint.
- **Phase 5** — EURC & tokenized-asset quote pairs (PAIR-style RWA pairing; already supported by
  the factory, needs an owner config txn once assets are live on Arc), $RADIAN protocol token with
  a BSP-style treasury buyback band.
- **Mainnet** — Arc mainnet (chain `5042`, live 2026-09-16): redeploy V4 base + suite, fresh keys,
  BUSL review, external audit of any Radian-specific additions.
