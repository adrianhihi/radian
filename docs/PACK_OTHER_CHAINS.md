# The Pack on other chains (BSC / Base)

Operator notes for the Pack coins that do not exist on the home chain. The home-chain `PackBurner`
buys and burns the coins that have a V4 pool there; a coin that lives on BNB Smart Chain (56) or
Base (8453) is bought on its own chain by the keeper through HalfMoon's aggregated firm quotes
(`docs/HALFMOON_API.md`) and sent to `0x000000000000000000000000000000000000dEaD`. Same idea as
the home burner — floor, cap, one coin per interval, rotation — executed off the home chain.

Code: `indexer/src/halfmoon.ts` (client), `indexer/src/keeper.ts` `otherChainBurns()` (the tick),
`indexer/src/config.ts` "The Pack on other chains" (env), `GET /pound/otherchains` and
`/pound.otherChains` (status), ledger rows of kind `burned` in the Pound ledger (`store.pound`).

## 1. What the keeper does, per tick

Every keeper tick (`KEEPER_INTERVAL_MS`, 60 s), after the home-chain Pound work:

1. Reads the cadence and the slippage bound from the home `PackBurner` (`minInterval`,
   `maxSlippageBps`; cached 5 min). Without a burner: `OTHER_CHAIN_MIN_INTERVAL_S` (86 400) and
   `OTHER_CHAIN_MAX_SLIPPAGE_BPS` (500).
2. Stops if the last other-chain burn is younger than `minInterval`. One burn per interval across
   all other-chain coins, the same rhythm as the home burner.
3. Walks the configured coins from the rotation cursor. For each coin:
   - reads the keeper's balance of the coin's `quote` asset and its gas balance on that chain
     (skips the coin when the balance is under `floor` or, on a funded run, when there is no gas);
   - `amount = min(balance, cap)`;
   - asks HalfMoon for an indicative quote, derives `amount_out_min = amount_out × (1 − maxSlippageBps)`;
   - asks for a **firm quote** with `from = keeper`, `to = 0x…dEaD`, `token_in = quote`,
     `token_out = coin`, `amount_in = amount`, `deadline = now + 180 s`;
   - checks the quote: `amount_in ≤ amount` (so never above `cap`), `amount_out ≥ amount_out_min`,
     recipient is the dead address, the token pair is the one asked for, the deadline is not
     imminent, and `router_address` is the router the partner published for that chain
     (`HALFMOON_ROUTERS` in `halfmoon.ts`; extend with `HALFMOON_ROUTERS_JSON` if they rotate it);
   - **dry-run** (see §4): logs the plan, records it in the status, advances the cursor, stops;
   - **funded**: approves exactly `amount_in` of the quote asset to the router (only if the
     allowance is short), `eth_call`s the calldata (a revert costs nothing), sends it, waits for
     the receipt, reports the hash to HalfMoon (`reportTxHash`, success or revert), and on
     success appends the ledger row and saves the snapshot.
4. A coin that fails before the firm quote (below floor, no fill, bad quote) never blocks the next
   coin in the rotation. Once a firm quote was accepted, that tick ends — one attempt per tick.

The home-chain wallet is never used by this path: every read and send goes through a client built
for the coin's chain from `OTHER_CHAIN_RPC_JSON`. The keeper cannot spend more than `cap` per burn,
and never more than what it holds on that chain.

## 2. Environment

All in the indexer service's environment (Railway variables, or `.env` locally). Documented in
`indexer/src/config.ts` too.

| Variable | Meaning |
| --- | --- |
| `HALFMOON_API_KEY` | The `business` JWT from HalfMoon. Server-side only; never logged, never in the web bundle. Without it every HalfMoon call throws "HalfMoon not configured" and the tick just records that reason. |
| `HALFMOON_BASE_URL` | Default `https://rfq.halfmoondex.com`. |
| `HALFMOON_ROUTERS_JSON` | `{"56":"0x…"}` — extends the known router table when the partner rotates a router. The keeper refuses to approve or call an unknown router on a funded run. |
| `OTHER_CHAIN_PACK_JSON` | The coins, see below. Default `[]` (feature off). |
| `OTHER_CHAIN_RPC_JSON` | `{"56":"https://…","8453":"https://…"}`. An RPC per chain id. Without one the coin is still listed, its balance is `null`, and only a dry-run plan (quoted at `cap`) is possible. |
| `KEEPER_PRIVATE_KEY` | The same keeper key as on the home chain; it signs on BSC / Base too. |
| `KEEPER_DRY_RUN` | `1` plan only (default when the chain has no RPC), `0` send. Unset: dry-run unless the chain has an RPC configured. |
| `OTHER_CHAIN_DRY_RUN_INTERVAL_S` | How often a dry-run re-plans (default 3600). A plan requests a firm quote, so it is not free for the market makers. |
| `OTHER_CHAIN_MIN_INTERVAL_S`, `OTHER_CHAIN_MAX_SLIPPAGE_BPS` | Fallbacks when no home `PackBurner` is configured. |

`OTHER_CHAIN_PACK_JSON` entry:

```json
[
  {
    "chainId": 56,
    "token": "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",
    "symbol": "DOGE",
    "decimals": 8,
    "quote": "0x55d398326f99059fF775485246999027B3197955",
    "quoteSymbol": "USDT",
    "quoteDecimals": 18,
    "floor": "25000000000000000000000",
    "cap": "50000000000000000000000"
  },
  {
    "chainId": 8453,
    "token": "0x…",
    "symbol": "…",
    "decimals": 18,
    "quote": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "quoteSymbol": "USDC",
    "quoteDecimals": 6,
    "floor": "25000000000",
    "cap": "50000000000"
  }
]
```

`floor` and `cap` are in the quote asset's own units (18-dec USDT on BSC, 6-dec USDC on Base).
`chainId` must be 56 or 8453; anything else is skipped with a log line. The coin must be a listed
`token_out` for that quote on HalfMoon (`GET /v1/listing/pairs`; the BSC book quotes in USDT / USD1,
Base in USDC) — otherwise the firm quote fails with code 10030 or 10095 and the status shows it.

## 3. Funding the keeper on BSC / Base

The keeper spends the quote asset and pays gas; it holds nothing else there.

| Chain | Quote asset to hold | Gas |
| --- | --- | --- |
| BNB Smart Chain (56) | USDT `0x55d398326f99059fF775485246999027B3197955` (18 decimals) — the asset HalfMoon's BSC pairs are quoted in | BNB. An approve + swap is ~0.3 M gas; keep ≥ 0.05 BNB |
| Base (8453) | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) | ETH. Keep ≥ 0.01 ETH |

How much quote asset: at least the largest `floor` among that chain's coins, ideally `cap × number of
coins on that chain`, so a whole rotation can run before the next top-up. The keeper address is the
one `/pound/otherchains` reports (`keeper`; also `/v1/manifest` → `contracts.keeper`), the same key
as on the home chain.

### Where the money comes from — an operator step for now

The Pack's burn share accrues on the home chain: `PoundVault.settle` routes it to `PackBurner.pool(asset)`
in the home quote asset. The part of that pool meant for coins on other chains has to be moved by hand
today (a later `PackBurner` version will expose an `export(asset, amount, chainId)` with an event so the
indexer can reconcile the exported share against the other-chain burns):

1. Decide the share: the burner's pool for the asset minus what the home-chain Pack needs for its next
   floor, split across the other-chain coins by their `cap`. Record the number in the ops log.
2. Move it from the Safe (the burner's owner) to the keeper address on the target chain:
   - **USDC → Base: Circle CCTP** (burn-and-mint, native USDC on both sides, no slippage, ~15 min).
     From Arc or Ethereum: `TokenMessenger.depositForBurn(amount, destinationDomain = 6 (Base),
     mintRecipient = keeper (bytes32), burnToken = USDC)`, then relay the attestation on Base
     (`MessageTransmitter.receiveMessage`). Circle's bridge UI does both steps for a Safe.
   - **USDT → BSC**: no CCTP; use a bridge with a firm receipt (Stargate / Across) or a CEX hop,
     into USDT on BSC to the keeper address.
   - If the home chain's quote asset is not USDC (USDG on Robinhood Chain), swap to USDC on a chain
     with CCTP first, or bridge USDG's own route. Note the leg and its cost in the ops log.
3. Confirm on `/pound/otherchains`: `coins[].balance` shows the arrival within 30 s.

Nothing in the indexer moves funds off the home chain. Until the export is on-chain, the audit trail
of this leg is the ops log plus the bridge receipts.

## 4. Dry-run today

With `HALFMOON_API_KEY` set and either no RPC for the chain or `KEEPER_DRY_RUN=1`:

```
[keeper] pack BNB Smart Chain DOGE DRY-RUN plan: 50.0 USDT → ≥19500.0 (quoted 20526.3) DOGE → 0x…dEaD via 0xc9f8faab4708f498942aa9a18ad1af857e59a3d7 (known router), fee 30 bps, deadline 1790000180, swap 4f1c…
```

- With an RPC, the plan uses the real balance (`min(balance, cap)`) and waits for `floor`; without one
  the plan is quoted at `cap` and the balance shows `null`.
- The plan is recorded on `/pound/otherchains` as `coins[].lastQuote` (`dryRun: true`, amounts, router,
  `routerKnown`, deadline, calldata size) with `reason: "dry-run: planned, not sent"`.
- No approval, no transaction, no ledger row, no `reportTxHash`. It re-plans every
  `OTHER_CHAIN_DRY_RUN_INTERVAL_S`.
- Unit tests cover the path without a network: `cd indexer && npm test` (`test/halfmoon.test.ts`,
  `test/otherchains.test.ts`).

## 5. Funded run checklist

1. `OTHER_CHAIN_RPC_JSON` has the chain; `/pound/otherchains` shows `rpc: true` and a `balance`.
2. Keeper funded (§3): `balance ≥ floor`, `gas > 0`.
3. `KEEPER_DRY_RUN=0` (or unset, since the RPC is configured), `HALFMOON_API_KEY` set.
4. The router in the last dry-run plan shows `routerKnown: true`.
5. Watch the first tick after `minInterval` has passed since the last burn (`nextEligibleAt`).
   The log prints `burn:` with the plan, then `approved …`, then `burned … <hash>`.
6. `/pound/otherchains` → `coins[].lastBurn`, `burnCount`, `burnedQuote`, `burnedTokens`;
   `ledger[]` lists the rows newest first. `/pound.otherChains` is the same object.

## 6. Audit trail

Every funded burn leaves two records:

- **Ledger row** in the Pound ledger (snapshot on `/data`, served under `/pound.otherChains.ledger`
  and `/pound/otherchains.ledger` — kept out of `/pound.ledger`, whose rows all link to the home
  explorer):

  ```json
  { "kind": "burned", "chainId": 56, "via": "halfmoon", "txHash": "0x…", "logIndex": 0, "block": "…", "ts": 1790000000000,
    "token": "0xba2a…", "symbol": "DOGE", "asset": "0x55d3…", "quoteIn": "50000000000000000000", "tokensOut": "2052630000000", "caller": "0x<keeper>" }
  ```

  `tokensOut` is the sum of the coin's `Transfer` logs to the dead address in the receipt (the
  quote's `amount_out` only if the receipt carried none). Rows are keyed by `(chainId, txHash,
  logIndex)`, so they never collide with home-chain rows. `coins[].explorer` gives the block explorer
  for the links (`bscscan.com`, `basescan.org`).
- **`reportTxHash`** to HalfMoon with `(swap_id, tx_hash)` right after the receipt (also on a revert),
  so the partner's books match ours. It is idempotent per pair.

The status object (`/pound/otherchains`, `Cache-Control: public, max-age=30`):

```
keeper, halfmoon (key configured), minInterval, maxSlippageBps, lastBurnAt, nextEligibleAt, cursor,
coins[]: { index, chainId, chainName, explorer, token, symbol, decimals, quote, quoteSymbol, quoteDecimals,
           floor, cap, rpc, dryRun, balance, gas, balanceAt, funded, next, lastBurn, burnCount, burnedQuote,
           burnedTokens, nextEligibleAt, lastAttemptAt, lastQuote, lastError, reason },
ledger[]: the last 50 burned rows
```

## 7. Still manual

- Bridging the burn pool's other-chain share to the keeper (§3) and recording it.
- Adding or retiring a coin: edit `OTHER_CHAIN_PACK_JSON` and redeploy the indexer (`railway up`
  from `indexer/`).
- Rotating the HalfMoon router if the partner changes it (`HALFMOON_ROUTERS_JSON`).
- Topping up gas on BSC / Base.
