# Cross-chain buy — `CrossBuyReceiver`

`src/pound/CrossBuyReceiver.sol` is the home-chain endpoint of "launch once, buy from anywhere"
(THE_POUND_RESEARCH.md §2 item 3). A bridge / intent router delivers the launch's quote asset to
the receiver on Robinhood Chain and calls it in the same transaction; the receiver spends the
delivery on `RadianLaunchRouter.buy` for the real buyer, with the referrer tag, so a wallet on
Base / BNB / Solana ends up holding the launch token. It has no owner, no upgrade path and no
pause, and holds nothing between calls by construction.

Status: **contract + tests + deploy script only; not deployed on any network.** Everything about
the routers below is either a fact already recorded in this repo (cited) or marked *unverified*.

## API

```solidity
constructor(address router)              // RadianLaunchRouter v4; factory is read from router.factory()

function buyFor(address token, uint256 minTokensOut, address recipient, address refundTo, address referrer) external payable;
function handleV3AcrossMessage(address tokenSent, uint256 amount, address relayer, bytes calldata message) external;
function release(address asset, address refundTo) external returns (uint256);   // parked refunds only
function quoteAssetOf(address token) external view returns (bool known, address asset);

event Bought(address indexed token, address indexed recipient, uint256 quoteIn, uint256 tokensOut, address referrer);
event Refunded(address indexed token, address indexed refundTo, address asset, uint256 amount, bytes reason);
event Parked(address indexed refundTo, address indexed asset, uint256 amount, bytes reason);
event Released(address indexed refundTo, address indexed asset, uint256 amount);
```

- `token`: the launch token (must be known to the factory). `quoteAssetOf(token)` tells the
  quote builder which asset to deliver (`address(0)` = ETH, otherwise the ERC-20, e.g. USDG).
- `recipient`: the buyer's address on Robinhood Chain. Never zero (reverts). For a Solana buyer
  this is their Privy EVM smart account (THE_POUND_RESEARCH.md §1.2 / §2 item 3).
- `refundTo`: where an unspent or failed delivery goes on the home chain; zero means `recipient`.
- `referrer`: credited its referral share in the PoundVault through the router; ignored when it
  equals `recipient`.
- `minTokensOut`: the curve's price bound; a partial (clamped) fill honours it pro rata.
- `Bought.quoteIn` is the quote actually spent; a clamped fill spends less than delivered and the
  remainder goes to `refundTo` (`Refunded` with reason `"clamped fill"`).

Delivery by quote asset:

| Launch quoted in | How the delivery reaches the receiver | What `buyFor` spends |
| --- | --- | --- |
| ETH (native) | `value` of the call to `buyFor` | exactly `msg.value` |
| USDG / any ERC-20 | plain `transfer` to the receiver **in the same transaction, before the call** | the receiver's whole unparked balance of that asset |

The router pulls an ERC-20 quote with `transferFrom`, so the receiver approves the router for the
exact amount of each call and resets the approval to zero afterwards; there are no standing
approvals.

## Relay (Base / BNB → Robinhood Chain)

Recorded facts (THE_POUND_RESEARCH.md §1.2, verified 2026-09-22): Relay supports Robinhood Chain
(4663), Base and BNB and does **not** support Solana; a Relay refund goes to the origin-chain
`refundTo` and there is no automatic refund when it is unset; HOLD's adapter binds the `/quote/v2`
response field by field (`depositFeePayer`, `refundTo`, `disableOriginSwaps`, precision).

Shape of a Relay quote with a destination call for this receiver (origin Base USDC → destination
Robinhood Chain), described by role — the exact JSON field names of Relay's destination-call
option are **not recorded in this repo and are unverified**; bind them from Relay's current API
docs, field by field, the way HOLD does:

- origin: Base (8453), the user's USDC, `refundTo` = the user's origin address (set it; Relay does
  not refund automatically otherwise).
- destination: Robinhood Chain (4663), currency = the launch's quote asset from `quoteAssetOf`.
- destination call: `to` = the receiver, `data` = `buyFor(token, minTokensOut, recipient,
  refundTo, referrer)` calldata, `value` = the delivered amount when the quote is ETH. For a USDG
  launch the delivered USDG must be transferred to the receiver before the call, in the same
  transaction, and `value` is 0.
- `recipient` = the buyer's Robinhood Chain address; `refundTo` = the same or another address of
  theirs on Robinhood Chain (this is the home-chain refund, distinct from Relay's origin-chain
  `refundTo`).

Build the calldata off-chain with the token address checked against `quoteAssetOf` /
`factory.getLaunchedToken`: the token is fixed at quote time, so an unknown token is a static
mistake that must not reach the chain (see failure paths).

## Across (USDC → USDG)

Recorded fact (THE_POUND_RESEARCH.md §1.2): Across is live on Robinhood Chain and delivers USDC
from 13 chains as USDG in about 2 seconds.

Across does not make an arbitrary destination call; its SpokePool transfers the output token to
the recipient contract and then calls `handleV3AcrossMessage(tokenSent, amount, relayer, message)`
on it. The receiver implements that entry point with
`message = abi.encode(token, minTokensOut, recipient, refundTo, referrer)`. Because the asset
and amount are explicit there, an unknown token or a delivery in the wrong asset is refunded
exactly, and the amount moved is capped at what is actually held. *Unverified:* the handler
interface is taken from Across V3's public SpokePool (`AcrossMessageHandler`) and has not been
checked against a live SpokePool from this repository; whether Across can deliver ETH (as opposed
to WETH) to Robinhood Chain is also unverified — a WETH delivery for an ETH-quoted launch is
refunded as "not the quote asset", not unwrapped.

## deBridge DLN (Solana → Robinhood Chain)

Recorded facts (THE_POUND_RESEARCH.md §1.2, verified 2026-09-22): deBridge DLN supports Robinhood
Chain, Solana, Base and BNB, and supports full hook execution on EVM destination chains; the
plan's conclusion is "Solana goes through the deBridge hook". The Solana buyer's home-chain
address is their Privy EVM smart account (Privy creates Solana + EVM embedded wallets together;
HOLD found `supportedChains` must include 4663 or `getClientForChain` fails).

What the hook needs: target = the receiver, calldata = `buyFor(token, minTokensOut, recipient,
refundTo, referrer)` with `recipient` = the buyer's EVM smart account, the order's destination
token = the launch's quote asset (USDG or ETH), delivered to the receiver before the call, and
`value` = the delivered ETH when the quote is ETH. *Unverified:* how DLN's executor sequences the
token transfer and the call, what it does with the funds if the hook call reverts (a fallback
address is the usual pattern), and the exact hook encoding — none of this is recorded in the repo.

## Failure and refund paths

`buyFor` never reverts on a failed buy, because by the time it runs the bridge leg is final.

| Situation | Outcome |
| --- | --- |
| Buy succeeds | `Bought`; tokens at `recipient`; referrer credited in the PoundVault |
| Buy succeeds, curve clamps the fill (near graduation) | `Bought` with the spent amount + `Refunded("clamped fill")` of the remainder to `refundTo` |
| Router / curve reverts (slippage, graduated curve, launch paused, anything) | `Refunded(reason = revert data)`; the whole delivery to `refundTo` |
| `token` unknown to the factory, ETH delivered | `Refunded("unknown token")` of the ETH |
| `token` unknown to the factory, ERC-20 delivered via `buyFor` | **reverts** `UnknownToken()`: the receiver cannot tell which asset arrived (the factory's quote list is not enumerable) and a successful no-op would strand it, so the delivering router's own failure handling applies. Via `handleV3AcrossMessage` it is refunded exactly instead |
| ETH sent with a USDG-quoted buy | the ETH is `Refunded("value with erc20 quote")`, the USDG buy proceeds |
| `recipient == 0` | reverts `ZeroRecipient()`; a reverted call never takes the ETH |
| nothing delivered | reverts `NothingDelivered()` |
| `refundTo` cannot accept the refund (contract rejecting ETH, stablecoin blocklist) | `Parked`; recorded in `owed[asset][refundTo]`, excluded from every later delivery; anyone may call `release(asset, refundTo)` and it can only go to that `refundTo` |
| a transfer with no call in the same transaction | unattributable (like tokens sent to any contract); the next `buyFor` of that asset treats it as its delivery. Integrations must deliver and call atomically |

Why per-call atomicity plus a parking ledger, rather than a sweep: the receiver cannot know who a
balance belongs to unless a call told it, so the only funds it ever moves are the delivery of the
current call, and the only funds it ever keeps are refunds it already tried to deliver, filed
under the `refundTo` of that call. A `sweep(asset, to)` would have to choose a `to`, which is the
theft the design rules out.

Caller-side griefing that is possible but harmless to funds: the executor controls the gas of the
call, so it can starve the inner router call and force the refund path instead of the buy; the
delivery still reaches `refundTo`.

## Router assumptions (RadianLaunchRouter v4)

- `buy(token, quoteIn, minTokensOut, recipient, referrer)`: native quote requires
  `msg.value == quoteIn`; ERC-20 quote requires `msg.value == 0` and pulls `quoteIn` with
  `transferFrom(msg.sender)`. A clamped fill refunds the unspent quote to `msg.sender` (the
  receiver), which forwards it to `refundTo`.
- The router attributes the trade to `msg.sender`, so the PoundVault's `Attributed` event names
  the receiver as `user` and the vault's self-referral check compares against the receiver; the
  receiver drops `referrer == recipient` itself. The referrer and the launcher reference are
  credited exactly as for a direct router buy (tested).
- Attribution only happens for curves whose snapshotted `protocolFeeRecipient` is the vault
  (HANDOFF.md, router `_attribute`); older launches buy fine, with no referral credit.
- The snipe tax is assessed on `recipient` (the curve reads `currentSnipeTaxBps(recipient)`), so a
  cross-chain buy in a launch's first seconds is taxed like a direct one.

## Chain ids and router coverage recorded in the repo

| Chain | Id | Source in repo |
| --- | --- | --- |
| Robinhood Chain mainnet | 4663 | MULTICHAIN.md "Robinhood Chain" |
| Robinhood Chain testnet | 46630 | MULTICHAIN.md |
| Base | 8453 | MULTICHAIN.md V4 table |
| BSC / BNB | 56 | MULTICHAIN.md V4 table |
| Arc mainnet / testnet | 5042 / 5042002 (LI.FI listing) | MULTICHAIN.md |
| Solana | no EVM id | — |

| Router | Robinhood Chain | Base | BNB | Solana | Source |
| --- | --- | --- | --- | --- | --- |
| Relay | yes (4663) | yes | yes | **no** | THE_POUND_RESEARCH.md §1.2 (2026-09-22) |
| deBridge DLN | yes | yes | yes | yes | same |
| Across | yes (USDC → USDG) | listed among the 13 USDC chains is *unverified* here | unverified | no (not claimed) | same |
| Relay / deBridge / Across on **Arc** | not listed (2026-09-09) | | | | MULTICHAIN.md "Interop stacks present on Arc" |

Addresses the receiver would be pointed at (HANDOFF.md): Robinhood Chain mainnet router v4
`0xD8e86A664e50eb9998Fec3F1a694960A279De6bD`, factory `0xe7e9a4c041a1356747b4369C55A9991784412f24`,
USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (6-dec); testnet router v4
`0x6AD94a7A0073deCc6114Ee8B5A1ED3fcC20296a4`, USDGx `0xf6f8fF47fEa2f2cE3195ad197B8A9BF520c13ed0`.

## Deploy

```
ROUTER=0x… [FACTORY=0x…] forge script script/DeployCrossBuyReceiver.s.sol --rpc-url robinhood_testnet --broadcast
```

Deploy-only: no owner functions are called and nothing needs wiring. Tests:
`forge test --match-contract CrossBuyReceiverTest -vv` (the `-vv` prints the happy-path gas).
