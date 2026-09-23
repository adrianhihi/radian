# The Pound core (contracts)

Design of record for the fee waterfall, the Pack burn and referral tags. Product rationale and the
sources behind each choice: `docs/THE_POUND_RESEARCH.md`.

## Money flow

```
curve trade fee (1%)  ──hook──►  protocol share (50%, hook.protocolFeeShareBps) ──escrow──► PoundVault
                                  creator share  (50%)                            ──escrow──► creatorFeeRecipient
launch fee (ETH)      ──hook──►  PoundVault (direct)

PoundVault.settle(asset):
  intake = escrow claim + what already sits in the vault (launch fees)
  1. fund referral accruals (totalPending − reserve), pulled by referrers with claimReferral
  2. burnShareBps (default 70%, min 50%) of the remainder → PackBurner.deposit
  3. the rest → treasury (the Safe)

RadianLaunchRouter v4 (the only attribution source):
  buy / sell / launchAndBuy carry `referrer`; the router credits the vault with
  REFERRAL_BPS (555) of the fee for the buyer's referrer and LAUNCHER_BPS (555) for the creator's
  referrer (launcherRef[token], recorded at launch). Self-referrals are ignored. Trades made
  directly on a curve carry no tag and credit nobody, exactly like Spectrum's untagged fills.
  Referral shares are always covered: 11.1% of the fee ≤ the 50% protocol share.

PackBurner.burn(amount, minOut):
  next active Pack coin in rotation; floor ≤ amount ≤ min(maxPerBurn, pool[asset]);
  bounty (50 bps) to the caller; quoteIn = amount − bounty;
  minOut must clear spotOut(quoteIn) × (1 − maxSlippageBps); swap via PoolManager.unlock,
  take() to 0x…dEaD; lastBurnAt/minInterval (1 day default) gate the cadence; keeper/owner only
  until `permissionless` is switched on (same checks either way).
```

## Constants and knobs

| Where | Value | Who can change |
| --- | --- | --- |
| hook.protocolFeeShareBps | 5000 | hook owner (Safe); applies to launches after the change (policy is snapshotted per launch) |
| PoundVault.REFERRAL_BPS / LAUNCHER_BPS | 555 / 555 of the fee | immutable |
| PoundVault.burnShareBps | 7000, min 5000 | vault owner |
| PackBurner floor / maxPerBurn per coin | set with addPack / setPack | burner owner |
| PackBurner minInterval / bountyBps / maxSlippageBps / permissionless / keeper | 1 day / 50 / 500 / false / keeper | burner owner |
| RadianLaunchRouter.templatesEnabled | false | factory owner |

## What changed against the 2026-09-17 review

- Executor: BuyAuth carries `asset`, `minPerBuy`, `minTokensPerQuote`; execution refused inside the
  snipe window; `a.user == 0` rejected; deposit nonReentrant. Domain version "2".
- Router: refunds by balance delta (nothing already on the router is ever paid out), implementation
  code checked in the constructor, Wall/PoF launches behind `templatesEnabled` (their own fixes are
  still pending).

## Deploy

`script/DeployPoundCore.s.sol` with FACTORY, HOOK, KEEPER, OWNER, TREASURY and the four template
implementation addresses. On a chain the broadcaster owns it wires everything; on mainnet it prints
the Safe calls (forwarder, vault, keepers, hook recipient and share, acceptOwnership ×2).


## Attribution rule (2026-09-22)

The router credits a referral only when the traded curve's snapshotted `protocolFeeRecipient`
is the PoundVault. Fee policy is copied into every curve at launch, so tokens launched before
The Pound send their protocol share elsewhere; crediting those trades would create accruals the
vault never receives funds for, and `settle` would pay them out of other tokens' fees. On such
curves `buy` / `sell` / `launchAndBuy` still work, just without a tag.

## Robinhood testnet (46630) deployment

| Contract | Address | Code hash |
|---|---|---|
| PoundVault | `0xf1AEB4C7F4529eF6cf1A1096fFD8629a044D20Ad` | `0xb998a8015082fa9a771ad838276d751122631145558476b233e2a62fa0a5d974` |
| PackBurner | `0xd8c4A6129b8b9dbaFf651A22e9504dd49358Ea6c` | `0x5e4b96843a6752a1d3ddb66e9d2ecc83699c2f3a94fa2bc2898bc957e2f8aa51` |
| RadianLaunchRouter v4 | `0x6AD94a7A0073deCc6114Ee8B5A1ED3fcC20296a4` | `0x42dbe1954b067922be4659fac9980535fd54d227208dfafdc1b0df877fee4c01` |
| PoFRouter | `0x90A6F2d85A8Ac9958d388238215C8b3bA21D519d` | `0xd0cd6d82d35e6ac44023ae0aa6ef9e9aed5fa015a35f0e75cee32739e2ebeade` |
| RadianExecutor v2 | `0x620BeE504c7BCe3c6abBAE3518f273655B1d37D0` | `0xe5aa55605b6b83fca3f5899cee94a7f3a2f35f26e458e503290cd61a71713604` |

Proven on chain 2026-09-22 (see HANDOFF.md): launch + buy with a referrer, sweep, `settle`
(16 USDGx → 9.05 referrals / 4.87 burn / 2.09 treasury), Pack #0 = RHSMK on its real V4 pool,
`burn` sent 97,801 RHSMK to `0x…dEaD` with a 0.024 USDGx bounty.

Scripts: `script/DeployPoundCore.s.sol` (all four), `script/DeployRouterV4.s.sol` (router only,
against an existing vault), `script/SmokeLaunchQuoted.s.sol` (ERC-20-quoted launch with `REFERRER`).
