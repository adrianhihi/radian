# Claims policy — what Radian copy may and may not say

Every sentence on the site, in the docs, on X, and in a token's **immutable on-chain
description** has to survive this list. WALL v1 was relaunched because its on-chain
description got the mechanics wrong (lock vs. vest, "auto" buyback); this is the guard
against a repeat. Borrowed from the claim discipline of a sibling project whose marketing
is checked line by line against its contracts.

## Do not say

- **"safe", "risk-free", "guaranteed", "can't lose", "floor price" as a promise.** A buy
  wall is a bid funded by fees, not a guarantee. Say "a standing bid under the market".
- **"undervalued" / "cheap"** about any token the platform or a treasury is itself buying.
  An issuer calling its own token undervalued on the same screen where it buys it is a
  compliance red flag.
- **APY / yield / "already earning" numbers before there are on-chain receipts to link.**
  Staking APR must be labeled as derived from the current reward rate and price, and it
  changes whenever either does.
- **"burned" for tokens that are locked.** The 5-year buyback vault *vests* (70% creator /
  30% protocol); it does not burn. "Locked forever" only for the graduated V4 position in
  the locker.
- **"burn raises the price".** Burn lowers total supply. The curve price only sees reserves.
- **"no team allocation"** unless the creator-fee recipient of that token is a treasury or
  a burn address, and say which one.
- **"audited"** until an external audit report is published. "Reviewed" is fine with a link.
- **"official Uniswap", "backed by Circle / Robinhood / Pons".** We run our own V4
  deployment; the engine is a port of Pons V2 (MIT); nobody endorses us.
- **Ownership words for tokenized stocks: "shares you own", "equity", "dividend".** Testnet
  stand-ins are explicitly not securities and have no redemption.
- **"one transaction" / "instant"** where the flow actually needs an approval first
  (ERC-20 quotes). Say what the wallet will show.

## Every number needs a source

- On-chain: link the transaction, or name the contract address and the view function.
- Indexer-derived: say so, and that it can lag a few blocks and excludes retired launches.
- Never carry a number forward from an older post or page. Recompute it.
- A missing number is a dash, never a zero.

## Words that are fine

non-custodial · verifiable · reproducible build · real yield *(paid from fees actually
collected)* · buyback and burn *(when it burns)* · buyback and lock *(when it locks)* ·
snipe tax · creator fee share · stand-in *(testnet stocks)* · standing bid.

## Mechanics sentences that are true today (Arc testnet, 2026-09-13)

- Every curve trade pays a 1% fee. 30% of it goes to the protocol; of the remainder, 50%
  buys the token back and locks it in the 5-year vault (Buyback & Lock mode) or goes to
  the creator (Creator Fees mode).
- The snipe tax starts at 99% and decays to 0 over 15 seconds after launch; the creator
  and declared wallets are exempt.
- Launch fee is read from the factory (`launchFee()`), currently 1 USDC.
- $RADIAN stakers earn native USDC streamed over 7 days, funded only by fees the treasury
  actually claimed. A flush buys back at most 5% of the curve's quote reserve and runs at
  most once per hour.
- Launch + first buy is one transaction through the router for native USDC; ERC-20 quotes
  need one approval first.

Add to this list when a mechanic ships; remove when it changes. The contracts, not this
file, are the source of truth; this file only says what we are allowed to claim about them.
