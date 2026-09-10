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
- **PAIR / BTCNVDA** anchor to real assets. That's our Phase-6 RWA path; orthogonal to this.

Micro-innovation vs. all of them: **real-yield revenue share + buyback/burn, and the protocol
token is itself launched fair on Radian's own launchpad** (no VC allocation, no team unlock — it
lives on a bonding curve like every other token, and the treasury buys it back on that same curve).

## Mechanism

```
   platform fees (launch fees + protocol's cut of every 1% trade fee, all tokens)
        │  accrue as USDC in
        ▼
   ┌──────────────────────────────┐
   │        RadianTreasury         │   flush() splits the balance:
   └──────────────────────────────┘
        │                    │
   buybackBps%          the rest
        ▼                    ▼
   buy $RADIAN on       RadianStaking.notifyReward()
   its curve + BURN         │  streamed over 7 days
        │                    ▼
   supply ↓ (deflation)  stakers earn USDC (real yield)
```

- **$RADIAN**: launched on Radian's launchpad — a normal 1B fixed-supply curve token. Its market
  *is* its bonding curve, so the treasury buyback trades against that curve and the burn shrinks
  the tradeable supply, pushing price up on the curve.
- **RadianStaking** (Synthetix-style): stake $RADIAN, earn native USDC proportional to stake ×
  time. `getReward()` pays out real USDC. Rewards only exist when the treasury funds them.
- **RadianTreasury**: receives protocol fees (USDC). `flush(minOut)` sends `buybackBps` to a
  curve buy + burn and the remainder to staking. Owner tunes `buybackBps`. *Extension (BSP nod):*
  make `buybackBps` a price band — buy more aggressively when $RADIAN is cheap. v1 keeps it fixed.

## Fee routing (how real fees reach the treasury)

The hook already sends the protocol's fee share to `FeeEscrow` under `protocolFeeRecipient`.
- **Mainnet:** set `PROTOCOL_RECIPIENT = RadianTreasury` at deploy → fees land in escrow for the
  treasury, which claims + flushes on a keeper cadence.
- **Testnet demo:** the deployer is the protocol recipient; a keeper (a script) claims the escrow
  USDC and forwards it to the treasury, then calls `flush()`. Shown as real numbers in the app.

## What the user sees (the "believe you can earn" surface)

An **Earn** page: total $RADIAN staked, **live APR** (annualized from the last reward period),
your stake, your claimable USDC, "buyback burned to date", and "revenue distributed to date" —
all read from chain/indexer. Honest framing: *hold and stake $RADIAN to earn a share of every
fee Radian collects, in USDC.* No promises about the price of anyone's memecoin.

## Build scope (this change)

1. `RadianStaking.sol` + `RadianTreasury.sol` (+ tests). $RADIAN uses the existing launcher token.
2. Deploy on testnet: launch $RADIAN, deploy staking + treasury, wire; seed a real
   stake + a real treasury flush so the numbers are non-zero.
3. Indexer: `/radian` endpoint (staked, APR, burned, distributed, treasury balance).
4. Frontend: `Earn` page + nav link; stake / unstake / claim UI.

Later: price-band buybacks, protocol-recipient = treasury on mainnet, a keeper cron.
