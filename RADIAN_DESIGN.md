# $RADIAN — protocol token & buyback flywheel (design)

The piece that closes the loop: a reason to hold Radian beyond trading memecoins.

## The idea in one line

**Radian shares its real revenue with the people who hold its token.** Every fee the platform
earns is split between (1) **USDC paid to $RADIAN stakers** (real yield, not inflation) and
(2) **buying $RADIAN back and burning it** (scarcity). More platform volume → more real yield +
more burn → more reason to hold → more launches and trading. That's the flywheel.

## Why this and not the alternatives

- **PONS** buys back + burns its token from protocol revenue. We do that too — plus we pay
  stakers real USDC, so holders get a cash return, not only scarcity.
- **BSP / FCoin "trade-to-mine"** emits new tokens for trading volume. That subsidizes wash
  volume and collapses at the first halving. **We deliberately do not do this.** Our rewards are
  paid from **fees actually collected**, so they can never exceed real revenue.
- **PAIR / BTCNVDA** anchor to real assets. That's the stock-denominated path (see The Wall);
  orthogonal to this.

Micro-innovation vs. all of them: **real-yield revenue share + buyback/burn, and the protocol
token is itself launched fair on Radian's own launchpad** — it lives on a bonding curve like every
other token, and the treasury buys it back on that same curve. Honest footnote: $RADIAN's
*creator* fee share (like any launch's) goes to whoever launched it — on testnet the deployer.
On mainnet point `creatorFeeRecipient` at the treasury or the multisig so there is no team stream.

## Mechanism (v2, live on Arc testnet)

```
   platform fees (launch fees + protocol's cut of every 1% trade fee, all tokens)
        │  accrue in PonsV2FeeEscrow under the treasury's address
        ▼   anyone calls treasury.claimFees()  (funds can only land in the treasury)
   ┌──────────────────────────────┐
   │        RadianTreasury         │   keeper calls flush(minRadianOut, deadline):
   └──────────────────────────────┘
        │                    │
   buybackBps%          the rest
   (capped at 5% of     ▼
    the curve's quote   RadianStaking.notifyReward()
    reserve per flush,      │  streamed over 7 days
    ≥ 1 h apart)            ▼
        ▼               stakers earn USDC (real yield)
   buy $RADIAN on its curve + BURN
        │
   total supply ↓ (deflation)
```

- **$RADIAN**: launched on Radian's launchpad — a normal 1B fixed-supply curve token whose
  graduation threshold is set so high it effectively never graduates, so its bonding curve stays
  the buyback venue. The *buy* is what moves the curve price; the *burn* removes the bought tokens
  from existence (lower total supply / FDV). Burning does not by itself change the curve price —
  the curve only sees its reserves.
- **RadianStaking** (Synthetix-style, `Ownable2Step`): stake $RADIAN, earn native USDC
  proportional to stake × time. `getReward()` pays out real USDC. Rewards only exist when the
  treasury funds them. Rewards streamed while nobody is staked are not recoverable (Synthetix
  semantics) — fund the first period only once someone has staked.
- **RadianTreasury** (`Ownable2Step`, cannot be renounced): holds the platform escrow address.
  `claimFees()` / `claimTokenFees(token)` are permissionless. `flush(minRadianOut, deadline)`
  requires an off-chain quote whenever a buyback executes, caps the buy at `maxBuybackReserveBps`
  of the curve's quote reserve (excess waits for the next flush so the long-run split holds), and
  is rate-limited by `minFlushInterval`. Native USDC has no other way out. `setStaking` checks the
  pool's `stakingToken` is $RADIAN. ERC-20 fee balances (EURC, stock quotes) can be claimed and
  routed by the owner via `rescueERC20`; $RADIAN itself can never be rescued.
  *Extension (BSP nod):* make `buybackBps` a price band — buy more aggressively when $RADIAN is
  cheap. v2 keeps it fixed.

## Fee routing (how real fees reach the treasury)

The hook sends the protocol's fee share to `FeeEscrow` under `protocolFeeRecipient` (and pays
some legs directly). `DeployRadian` / `DeployRadianFlywheel` call
`hook.setProtocolFeeRecipient(treasury)`, so from that point every protocol fee accrues to the
treasury, which anyone can `claimFees()` into it and the keeper flushes. This is wired on testnet
today (2026-09-10) and is the mainnet path (`MAINNET_RUNBOOK.md` §5b).

## What the user sees (the "believe you can earn" surface)

An **Earn** page: total $RADIAN staked, **live APR** (annualized from the last reward period),
your stake, your claimable USDC, "buyback burned to date", and "revenue distributed to date" —
all read from chain/indexer. Honest framing: *hold and stake $RADIAN to earn a share of every
fee Radian collects, in USDC.* No promises about the price of anyone's memecoin.

## Status

Done: contracts (v2, 15 tests), testnet deployment + wiring, `/radian` indexer endpoint, Earn page.
Next: keeper cron (`claimFees` → `flush` with a quote), external review before mainnet, then the
price-band buyback.
