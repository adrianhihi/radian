<!--
ASSUMPTIONS BEHIND safe/pack-mainnet.json — every number in the batch follows from these; the JSON carries none of them.

Survey
- Chain: Robinhood Chain mainnet (4663), public RPC https://rpc.mainnet.chain.robinhood.com, canonical Uniswap V4
  PoolManager 0x8366a39CC670B4001A1121B8F6A443A643e40951, V4Quoter 0x8dc178efb8111bb0973dd9d722ebeff267c98f94
  (docs.uniswap.org/contracts/v4/deployments, code checked on chain). Read-only. The RPC is not an archive node,
  so every state read (slot0, liquidity, balances, supply, fills) is at the survey head, block 71926523
  (2026-09-25 04:02 UTC).
- Pools: every `Initialize` event of the PoolManager from genesis (first pool at block 9505) to the head, in
  chunks of 250k–750k blocks with 429 back-off (indexer/test/.smoke/pack-scan.ts `scan`).
- Pool state: slot0 and liquidity read with `extsload` (StateLibrary layout: POOLS_SLOT 6, liquidity at +3) for
  every pool whose LP fee is under 5% or dynamic (0x800000). A burn must fill within maxSlippageBps = 500 of spot,
  so a pool charging 5% or more can never be used and was not read.
- Tokens: symbol / name / decimals / totalSupply / balanceOf(PoolManager) through Multicall3 for every currency
  whose ETH or USDG pool has a virtual quote depth of at least $10,000, plus the first ~20k currencies of the
  live-pool set in scan order. 29,766 of the 544,145 distinct currencies are resolved; the rest sit only in
  pools with zero liquidity or under that depth and are not Pack material.
- Price: USDG = $1. ETH = 2,676.84 USDG from the deepest ETH/USDG pool. Every other token from its deepest
  pool against a priced neighbour (up to three hops), price = (sqrtPriceX96 / 2^96)^2 adjusted for decimals.
- Depth: "quote depth" is L·√P in the quote asset — the pool's virtual quote reserve at the current price as if
  all liquidity were full-range; it sets a small buy's price impact and is an upper bound on the real reserve.
  Because launchpad seeds make it meaningless on its own, every candidate was also swapped through the
  V4Quoter (`quoteExactInputSingle`, empty hookData, exactly what PackBurner.burn passes): a sell of $1,000 and
  $10,000 of the token at spot, and buys of $250 … $50,000 of the quote asset. "Fill" is amountOut ÷ spot.
- Meme filter: not a Robinhood stock token (registry of 195), not a stablecoin, not a wrapped/staked major, not
  one of our own launches (hook 0x892aB29D…a044), no "test" in the name, FDV between $5K and $2B, LP fee usable,
  and a pool against ETH (address 0) or USDG — the only two assets the PoundVault ever deposits into the burner,
  hence the only two `pool[asset]` balances a burn can spend. Wrapped-ETH pools do not count: the burner never
  receives WETH.
- Safety: each of the ten was transferred for real inside an eth_call (Probe code overriding the PoolManager's
  code, 1,000 tokens to 0x…dEaD): what left equals what arrived, no tax, no block. Verified sources (Sourcify)
  were read for fee / blacklist / pause / mint logic; unverified ones are marked as such.

Sizing
- floor = min($25,000, 0.1% of totalSupply × price) per THE_POUND_RESEARCH §2.2, expressed in the pool's quote
  asset: USDG raw (6 decimals) or ETH wei at the survey's ETH price, and never above the pool's cap (a floor the
  pool cannot fill within 5% would make every burn revert). Three coins hit that ceiling and are marked.
- maxPerBurn = the largest tested buy the Quoter filled at ≥ 95.5% of spot (the 5% cap with margin for the
  50 bps bounty and price drift), never below the floor. The Pound's ledger on this chain is still empty, so
  "a week of fees" cannot be measured; the cap is what the pool can take in one fill, which for every coin
  here is far above any plausible first-weeks accrual, so one weekly burn spends the whole week.
- setParams(604800, 50, 500, false, 0xA86480B3658d220f43c274E244A0c1b3d35d79FA): weekly rotation; bounty,
  slippage, permissionless and keeper exactly as the burner reports today (indexer /pound, 2026-09-25).
- Rotation gating: nextPack() returns the first active pack from the cursor and the keeper waits, it does not
  skip, while pool[asset] is below that coin's floor. Every floor gates the whole rotation, and ROBINCAT's floor
  is in USDG while the other nine are in ETH, so a thin USDG pool stalls the ETH burns when its turn comes; the
  lever is setPack(index, floor, maxPerBurn, active) from the Safe.
- Pair tokens: phantom 4,000 USD and graduation 10,000 USD converted into the token at the survey price
  (mirrors USDG's 4,000 / 10,000 and gen-stock-quotes.mjs), decimals as the token reports. Only the two coins
  with a verified plain ERC-20 (PonsV2LauncherToken family) and an FDV in the millions are paired; a 10,000 USD
  goal must be a small fraction of the quote coin's supply.
- Prices move. Re-run `pack-scan.ts report`, `quote` and `pack-batch.ts` before proposing; the amounts in the
  file are the survey's, not live.
-->

# The Pack: first ten coins for The Pound on Robinhood Chain mainnet

Survey of 2026-09-25 (block 71926523). Produces `safe/pack-mainnet.json`. Nothing here was broadcast; the
batch is the Safe's to execute. Assumptions are in the comment block at the top of this file.

## Answer first

- **Uniswap V4 pools on the chain: 886,208** (Initialize events from block 9505 to 71926523). 527,833 have an
  LP fee the burner could ever use (under 5% or dynamic); **204,907 hold any liquidity**; 544,145 distinct
  currencies. Most of the rest is launchpad seeds nobody bought and fee-spam pools (22,122 pools at fee
  81.0% / tick spacing 19988, 9,426 at 87%, …).
- **Coins that qualify as Pack material: ten**, all animal-named, each with an ETH or USDG pool that fills a
  burn-sized buy within the 5% cap. They are small: caps per burn run from $10,000 (PENGU) down to $1,000
  (BULL, ZODSCC, LONGCAT), and two have FDVs under $50K. 296 non-stock tokens have a pool that absorbs a
  $1,000 sell at 90%+ of spot; 17 of those carry a dog / cat / animal name; 10 also pass the buy test. There
  are ten, not ten big ones; the runners-up are listed so the Safe can swap.
- The batch: `setParams(7 days, …)`, `addPack` × 10, and `setPairTokenEconomics` + `setPairTokenApproved` for
  RBD and ROBINCAT (15 calls). Floors are $37–$2,500 per coin, not $25K, because 0.1% of a small coin's supply
  is the binding leg everywhere.

## 1. The survey

| What | Number |
| --- | --- |
| Pools (Initialize events) | 886,208, first at block 9505 (2026-04-30 is block 1) |
| Pools with a usable fee (< 5% or dynamic) | 527,833 |
| Pools with liquidity > 0 | 204,907 |
| Distinct currencies (all pools / live pools) | 544,145 / 196,731 |
| Currencies resolved (symbol, name, decimals, supply, PoolManager balance) | 29,766 |
| PoolManager holds | 22,704 ETH (≈ $60.8M) and 61.08M USDG (USDG supply 689.0M) |
| ETH price used | 2,676.84 USDG (pool `0xbac3aa3b…`, dynamic fee, tick spacing 10) |

Pools by hook (verified names from Sourcify): hookless 581,529; `0x4e34…a544` DopplerHookInitializer 176,977;
`0x48b8…e8cc` ClankerHookStaticFeeV2 15,056; `0xe5e7…e044` PonsV2MemeHook (the upstream Pons V2 launchpad,
graduation pools at fee 0 / tick spacing 200) 9,390; `0x75a5…2aec` CashCatHookV2 8,955; `0x745d…e0cc`
UniversalKlikHook 6,499; `0x16d1…2000` PairV4Hook 4,550. Our own PonsV2MemeHook `0x892a…a044` has 2 pools
(the smoke launches), excluded.

Pools by (fee, tickSpacing): dynamic/200 118,768; 1%/200 99,019; dynamic/8 73,954 (Doppler); 0.25%/25 60,608;
0/200 47,620 (Pons hook pools); 81%/19988 22,122 (spam); 0/60 14,947; 0.01%/1 10,576; 87%/10000 9,426 (spam);
0.05%/1 9,141.

Executability instead of TVL: 12,794 sell quotes over 6,307 anchored tokens. 331 pools (310 tokens) absorb a
$1,000 sell at 90%+ of spot; 48 pools absorb $10,000 at 85%+. Fresh launchpad pools show large virtual depth
and revert on the first real sell (`NotEnoughLiquidity`), which is why depth alone was not trusted.

## 2. The Pack (ten coins, rotation order = batch order)

Prices and supplies at the survey head; "0.1% of supply" and "$25K" are what those amounts mean in the coin.
"Fill" is the Quoter's output ÷ spot for a buy of that many dollars of the quote asset (the burner's direction).

| # | Coin | Token | Pool (quote / fee / tick spacing / hooks) | Quote depth | PoolManager holds | Price | Supply (FDV) | 0.1% of supply | $25K in the coin | floor → maxPerBurn (batch units) | Fill $1K / $2.5K / $5K / $10K |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | PENGU, Pudgy Penguins | `0x74BE72AFFAFbC8de30F0C11247814036314D625f` | ETH / 1% / 100 / none | $321,833 | $124,042 | $0.00961 | 34.71M ($333.6K) | 34,715 PENGU = $334 | 2.60M PENGU | 0.1246 ETH ($334) → 3.7357 ETH ($10,000) | 0.986 / 0.981 / 0.974 / 0.960 |
| 1 | GOAT, Absolute Goat | `0x6e9aCBFbdD8b57649ffeAcEa4D26A81aE1395367` | ETH / 0.25% / 50 / none | $151,312 | $151,393 | $0.000195 | 1.00B ($195.1K) | 1.00M GOAT = $195 | 128.1M GOAT | 0.0729 ETH ($195) → 1.8679 ETH ($5,000) | 0.991 / 0.981 / 0.965 / 0.935 |
| 2 | DEER, CryptoDEER | `0x9a5d03de82F2bBE649871837C1BA7f9d879Def60` | ETH / 0.25% / 50 / none | $1,090,733 | $18,985 | $0.0000371 | 1.00B ($37.1K) | 1.00M DEER = $37 | 674.6M DEER | 0.0138 ETH ($37) → 1.8679 ETH ($5,000) | 0.996 / 0.995 / 0.968 / 0.811 |
| 3 | YORK, The Office Dog | `0x7817C85e4390Bc83A58A47A71f0A5FA83a4e16D4` | ETH / 1% / 200 / none | $103,341 | $105,775 | $0.00000281 | 100.0B ($281.3K) | 100.0M YORK = $281 | 8.89B YORK | 0.1051 ETH ($281) → 0.9339 ETH ($2,500) | 0.980 / 0.966 / 0.944 / 0.903 |
| 4 | FROGE | `0x1dF1F09c4Dd65C76746d53467361D536cDfDC719` | ETH / 0.25% / 50 / none | $92,116 | $92,775 | $0.000165 | 1.00B ($164.8K) | 1.00M FROGE = $165 | 151.7M FROGE | 0.0616 ETH ($165) → 0.9339 ETH ($2,500) | 0.986 / 0.971 / 0.946 / 0.900 |
| 5 | RBD, RobinDog | `0xB41c7ac9d46A980f8bDf1894B392a2a07eC9992A` | ETH / 0 (hook fee) / 200 / PonsV2MemeHook `0xE5e7…e044` | $136,195 | $150,628 | $0.00808 | 1.00B ($8.08M) | 1.00M RBD = $8,084 | 3.09M RBD | 0.9339 ETH ($2,500, lowered to the cap) → 0.9339 ETH ($2,500) | 0.983 / 0.972 / 0.955 / 0.922 |
| 6 | ROBINCAT | `0xded852De9fe9bA9b6f27f39e8e81CF851A5C79cc` | **USDG** / 0 (hook fee) / 200 / PonsV2MemeHook `0xE5e7…e044` | $70,014 | $95,718 | $0.00297 | 999.95M ($2.97M) | 999,950 ROBINCAT = $2,969 | 8.42M ROBINCAT | 2,500 USDG ($2,500, lowered to the cap) → 2,500 USDG | 0.999 / 0.978 / 0.945 / 0.885 |
| 7 | BULL, The Bull | `0x49bac47750F3dCdBa49350B5D74fd399e90f97C6` | ETH / 0 (hook fee) / 200 / PonsV2MemeHook `0xE5e7…e044` | $56,930 | $98,602 | $0.00141 | 999.99M ($1.41M) | 999,985 BULL = $1,413 | 17.70M BULL | 0.3736 ETH ($1,000, lowered to the cap) → 0.3736 ETH ($1,000) | 0.966 / 0.942 / 0.904 / 0.836 |
| 8 | ZODSCC, Cash Cat by ZODs | `0xAEa817E4D2251b7eC16056126FbbC381497D1e61` | ETH / 1% / 200 / CashCatGraduationHook `0x8526…a040` | $45,031 | $45,380 | $0.000559 | 1.00B ($558.8K) | 1.00M ZODSCC = $559 | 44.74M ZODSCC | 0.2087 ETH ($559) → 0.3736 ETH ($1,000) | 0.969 / 0.939 / 0.892 / 0.812 |
| 9 | LONGCAT, Long Cat | `0xbC487F82525e9478fD4aC63ec3085301d6b51E18` | ETH / dynamic / 8 / DopplerHookInitializer `0x4e34…a544` | $37,594 | $37,981 | $0.0000499 | 993.0M ($49.5K) | 993,037 LONGCAT = $50 | 501.3M LONGCAT | 0.0185 ETH ($50) → 0.3736 ETH ($1,000) | 0.958 / 0.922 / 0.868 / 0.778 |

Pool keys as they appear in the batch (`currency0`, `currency1`, `fee`, `tickSpacing`, `hooks`); the burner
derives `asset` as the other currency:

| Coin | currency0 | currency1 | fee | tickSpacing | hooks | pool id |
| --- | --- | --- | --- | --- | --- | --- |
| PENGU | `0x0000…0000` (ETH) | token | 10000 | 100 | `0x0000…0000` | `0x38cbd4b1…b086` |
| GOAT | ETH | token | 2500 | 50 | none | `0x9339210b…1e6e` |
| DEER | ETH | token | 2500 | 50 | none | `0xf1447c52…d8fb` |
| YORK | ETH | token | 10000 | 200 | none | `0x2e17edfc…50c0` |
| FROGE | ETH | token | 2500 | 50 | none | `0xf5eecbfa…a56d` |
| RBD | ETH | token | 0 | 200 | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | `0x5672a588…6e0d` |
| ROBINCAT | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (USDG) | token | 0 | 200 | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | `0x05c53aa8…d11b` |
| BULL | ETH | token | 0 | 200 | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | `0x710a3dbf…c27a` |
| ZODSCC | ETH | token | 10000 | 200 | `0x8526171645365821d0630F20bbe35284a3d1a040` | `0x3149fa34…4dde` |
| LONGCAT | ETH | token | 8388608 (dynamic) | 8 | `0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544` | `0x90e8a9dc…9e19` |

Plain-language notes, one per coin:

- **PENGU** shares a name with Pudgy Penguins but is a native coin (FDV $334K), the deepest meme pool on the
  chain (hookless 1% ETH pool since 2026-08-27). The contract is unverified, 12.5 KB, and has an `owner()`
  (`0x5F5a…7DC0`); the real-transfer probe is clean. Pack coin, not a quote asset.
- **GOAT** Absolute Goat: verified plain UERC20 (BaseUERC20 = OpenZeppelin ERC20 + ERC165, mint once), hookless
  0.25% ETH pool since 08-06, 20% of supply already sits at 0x…dEaD. Not paired: a 10,000 USD goal would be 5%
  of the coin's whole supply.
- **DEER** CryptoDEER: same verified UERC20 code, hookless 0.25% ETH pool since 08-06. Tiny (FDV $37K) but the
  pool fills $5,000 within 5%; 0.1% of supply is $37, so it burns often and small.
- **YORK** The Office Dog: the oldest dog here (pool since 07-13), hookless 1% ETH pool, a 1.7 KB minimal
  ERC-20 with no owner, unverified; probe clean.
- **FROGE**: verified UERC20, hookless 0.25% ETH pool since 08-06, 26% of supply already burned.
- **RBD** RobinDog: graduated on the upstream Pons V2 launchpad on 09-16 (fee 0 pool, the PonsV2MemeHook takes
  its fee in `beforeSwap`); bytecode identical to the verified PonsV2LauncherToken except three embedded
  addresses (immutables). Biggest dog by FDV ($8.1M); 0.1% of supply ($8,084) is above what the pool fills, so
  floor = cap = $2,500.
- **ROBINCAT**: verified PonsV2LauncherToken (ERC20 + ERC20Burnable, mint once), graduated 08-31 into a **USDG**
  pool, the one coin that spends the USDG side of the burn pool. Same floor = cap situation ($2,500 USDG). Last
  in rotation order would have been safer for the stall described in the assumptions; it is sixth so the
  ETH coins around it keep the cadence visible — move it with `setCursor`/`setPack` if USDG fees stay thin.
- **BULL** The Bull: verified V2LauncherToken (an earlier Pons family), ETH pool since 08-07; floor = cap
  = $1,000.
- **ZODSCC** Cash Cat by ZODs: verified CashCatToken (plain ERC20, mint once) behind the verified
  CashCatGraduationHook (15 KB, custom); the burner passes empty hookData and the Quoter filled with it, so the
  hook accepts plain swaps today. 12% of supply already burned.
- **LONGCAT** Long Cat: a Doppler launch (07-14), dynamic-fee pool at tick spacing 8, fee about 2.3% at $250;
  the token is an EIP-1167 clone of the verified DopplerERC20V1 with an owner (`0xeb7C…0862`) and its
  pool-lock at the dead address. Smallest cap, no pairing.

### Runners-up (not in the batch)

| Coin | Why not |
| --- | --- |
| MOMO, Momo the Mammoth `0xe37E…43aC` | Verified UERC20, hookless ETH pool, cap $1,000, FDV $28K; first substitute (animal, plain code). |
| PENGUIN, Nietzschean Penguin `0xe2Ec…1415` | Pons token, cap $500. |
| LMEOW `0xb3c5…A5D9`, RDUBS Dubs the Cat `0x623e…e3F3`, BOSSCAT `0x7159…dcf3`, ROXI Robinhood Mascot `0xEe89…e286` | Pons tokens, caps $500, pools two to eight weeks old. |
| MONEYDOG `0x8d8f…611f` | Cap $250. |
| SIRIUS The Dogestar, BABYCASHCAT, HOODCATS, AD Artificial Doge, HASH HASHCATS | Fail the 5% cap at any size (fills 0.83–0.95 already at $250). |
| GRASS, ROBINHOOD, PVP, SLIPPY, POOLS, FLAY, V4, … | Community coins with real pools (caps $500–$2,500) but no animal in the name; use if the Safe prefers depth over theme. |
| CASHCAT `0x020b…18b4` and the "HOODIE" family | Prices come only from launch-seed pools (FDV in the 10^18 range), no real quote-side liquidity. |

## 3. Pairing: which coins become quote assets

`setPairTokenEconomics` + `setPairTokenApproved(token, true)` on the factory `0xe7e9…2f24`, mirroring USDG's
4,000 / 10,000 (phantom / graduation) and `gen-stock-quotes.mjs` (USD ÷ price, in raw units):

| Coin | Price | phantomQuote (4,000 USD) | graduationThreshold (10,000 USD) | decimals | Goal as share of supply |
| --- | --- | --- | --- | --- | --- |
| RBD | $0.008084 | 494,780 RBD (`494779726422890031000000`) | 1,236,949 RBD (`1236949316057224991000000`) | 18 | 0.12% |
| ROBINCAT | $0.002969 | 1,347,217 ROBINCAT (`1347216879343186039000000`) | 3,368,042 ROBINCAT (`3368042198357965332000000`) | 18 | 0.34% |

Why these two: both are the PonsV2LauncherToken family (verified source, OpenZeppelin ERC20 + ERC20Burnable,
mint once, no owner, no hook on the token), so a graduated pool quoted in them cannot be bricked by a transfer
hook (the risk `AddStockStandIns.s.sol` warns about); both have FDVs in the millions, so a 10,000 goal is a
fraction of a percent of supply; the factory's checks pass (18 decimals ≥ MIN_PAIR_TOKEN_DECIMALS, phantom far
above `_requireQuotable`'s floor). Not paired: PENGU (unverified, owner), YORK (unverified), LONGCAT (clone with
owner), GOAT / DEER / FROGE (verified but a 10,000 USD goal is 5–27% of supply), BULL / ZODSCC (goal 0.7% /
1.8% of supply, but thinner pools than the two above). The web and indexer need their `quoteAssets` /
`QUOTE_ASSETS_JSON` entries (`decimals: 18`, `gradGoal` in the coin) before a launch can pick them; that is a
release, not part of this batch.

## 4. Robinhood stock tokens as pairing candidates (not Pack coins)

Robinhood's registry (`GET https://api.robinhood.com/rhj/assets`, read 2026-09-25) lists **195 active stock
tokens, all deployed on 4663**, all 18-decimal, all tradable. 158 report `currentMultiplier` exactly 1.0; the
rest run up to 4.0 (post-split). On chain the multiplier is `uiMultiplier()` (ERC-8056; `currentMultiplier()`
reverts): NVDA `0xd0601CE1…9EEC` reports 1.000775159164630595 and is not paused.

On Uniswap V4: 195 of them appear in some pool, 192 in a pool with liquidity, 188 against ETH or USDG. Only
**14** have a pool that absorbs a $1,000 sell at 90%+ of spot, and three absorb $10,000: QCOM
(`0x0f17…aea9`, USDG 0.35% pool, 0.99), CRM (`0xd95B…6D44`, USDG 1% pool, 0.98), GE (`0x63b8…373e`, USDG 2%
pool, 0.97); then IREN (0.65 at $10K), AAOI, JOBY, ZM, PATH, APP, ASTS, FLY, FIX, TEAM, HII ($1K only). Every
other stock token's pools are one-sided seeds. The PoolManager's largest stock balances (MCD, OPAI/ANTH "pre-IPO"
tokens, BYTE) come from launch-seed pools whose price is meaningless.

They are **not** Pack material: the burner can only spend what the PoundVault deposits, and the vault only ever
receives the curves' quote assets (ETH and USDG today), so a coin whose only pool is against NVDA would sit in
the rotation with an empty `pool[NVDA]` forever. They are candidates for the other side of the factory:
`setPairTokenEconomics` + `setPairTokenApproved`, "launch a meme priced in NVDA". The batches for all 195 already
exist (`safe/stocks/approve-stocks-0*.json`, generated by `script/gen-stock-quotes.mjs`) and are deliberately
**not** in `safe/pack-mainnet.json`, for the reasons THE_POUND_RESEARCH §1.7 records:

- **Multiplier.** 1 raw unit ≠ 1 share (`uiMultiplier`, NVDA 1.000775, AAPL 1.000566; several at 4.0 after
  splits). Every economic figure must be divided by the multiplier (`gen-stock-quotes.mjs` does); a split after
  approval leaves the raw-unit thresholds stale until `setPairTokenEconomics` is re-run.
- **Two price feeds.** The chain carries both `NVDA / USD` and `Robinhood NVDA / USD`; reading the stock feed
  and multiplying by the multiplier is a double conversion. The web must pick one.
- **Issuer control.** Beacon proxies: Robinhood can pause or upgrade a token. A pause freezes every curve and
  graduated pool quoted in it. Transfers are permissionless on chain (verified from the PoolManager's balance,
  MULTICHAIN.md), but the US-person and UK/CA/CH restrictions are enforced off chain, so a meme quoted in a stock
  token has whatever user base Robinhood allows.
- **Legal.** MAINNET_RUNBOOK.md 5f gates stock quotes on a legal opinion; stage A approves USDG only. Nothing
  here changes that.

## 5. What could not be determined

- **Real per-pool reserves.** V4 keeps positions outside the pool struct, so the survey has virtual depth
  (L·√P) and Quoter fills, not the token amounts each pool holds. The fills are the number that matters for a
  burn; depth is shown for scale only.
- **Metadata for 514k currencies** that appear only in zero-liquidity pools or in pools under $10K virtual
  depth. None of them can be a Pack coin (no fillable ETH/USDG pool), but they are not enumerated by name.
- **PENGU's and YORK's source.** Unverified on Sourcify; robinhoodchain.blockscout.com sits behind a Cloudflare
  challenge for non-browser clients. Both passed the real-transfer probe and standard reads; PENGU's 12.5 KB of
  owner-controlled bytecode is the single biggest unknown in the ten.
- **Holder counts, volume and age of the coins.** The RPC is not an archive node and no indexer covers these
  tokens; "since" dates are the pool's Initialize block, not the token's creation.
- **The Pound's weekly fee run-rate.** The ledger is empty (launches closed), so maxPerBurn is sized by the
  pool, not by fees.
- **Whether LONGCAT's dynamic fee stays near 2.3%.** Doppler hooks can change it; the cap has margin.
- **Whether the upstream PonsV2MemeHook pools (RBD, ROBINCAT, BULL) have an active snipe window.** The Quoter
  fills at 0.97–1.00 for $1,000 say no today; the keeper's simulation before each burn will catch a change.

## 6. How to submit `safe/pack-mainnet.json`

The Safe is `0x6db9a7fF776c7091C0A3c9847bD8a43eBA6892D8` on Robinhood Chain (1/1 today). Two ways, both in
`safe/README.md`:

1. **Transaction Builder (UI).** app.safe.global → "Robinhood Chain" → Apps → Transaction Builder → "Load a
   batch" → drag `safe/pack-mainnet.json`. The Builder re-encodes every call from `contractMethod` +
   `contractInputsValues` (the `PoolKey` tuple is a JSON array string, as in the file), shows the decoded calls,
   and the owner signs with MetaMask/Rabby (the Safe UI disables Ledger/Trezor/WalletConnect on this chain).
2. **Propose through the transaction service** (what we did for the Pound batch, Safe nonce 1, MAINNET_RUNBOOK.md
   5f). The deployer `0x6CCd…5F95` is a registered *delegate*: it may propose but cannot sign or execute. Encode
   the 15 calls as one `MultiSendCallOnly` (`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`, operation 1) call,
   sign the SafeTx EIP-712 hash with the deployer key (`cast wallet sign --no-hash`), and POST to
   `https://api.safe.global/tx-service/robinhood/api/v1/safes/<safe>/multisig-transactions/` with the owner's
   Safe API key in the header. **Neither the API key nor the deployer key is stored in the repo, on the indexer
   or in this document; the operator supplies both at run time** (`set -a; source .env.robinhood-mainnet;
   set +a` for the deployer key, the API key pasted from the owner's Safe settings for that one shell). The
   proposal appears in the owner's queue as "Proposal → Confirm"; with the 1/1 threshold the owner confirms and
   executes in one step.

Before either path, refresh the numbers (prices move; the RPC is public):

```bash
cd indexer && export OUT=/tmp/pack-survey
npx tsx test/.smoke/pack-scan.ts scan      # Initialize events (resumable; ~35 min on the public RPC)
npx tsx test/.smoke/pack-scan.ts pools     # slot0 + liquidity for usable-fee pools (~9 min)
TOKENS_FILE=… npx tsx test/.smoke/pack-scan.ts tokens   # metadata for the tokens of interest
npx tsx test/.smoke/pack-scan.ts report    # prices, depth, anchor pools → report.json
# write quote-requests.json for the ten pools (buys of the quote asset), then:
npx tsx test/.smoke/pack-scan.ts quote     # V4Quoter fills → the `cap` per coin
npx tsx test/.smoke/pack-batch.ts          # candidates.json (+cap) → pack-mainnet.json + these table rows
```

Order of the calls matters only in one place: `setPairTokenEconomics` precedes `setPairTokenApproved` for each
coin (approval reverts without economics). `addPack` reverts if the pool is not initialized or `maxPerBurn <
floor`; both hold at the survey head.

After execution, verify from the indexer's `/pound` (`packCount = 10`, `minInterval = 604800`, each pack's
`floor` / `maxPerBurn` / `asset`), `cast call 0xBA7b0b8E33d64c14caFBd44cA808875A25713C34 "packAt(uint256)" 0`,
and `cast call 0xe7e9a4c041a1356747b4369C55A9991784412f24 "approvedPairTokens(address)(bool)" <RBD>`. Nothing
burns until `pool[asset]` reaches the floor of the coin at the cursor (`nextPack()`), and the keeper runs `burn`
once per interval; the first visible burn is therefore at least a week after the first fees land, and with the
floors above it is PENGU's $334 of ETH that gates it.
