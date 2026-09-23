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
