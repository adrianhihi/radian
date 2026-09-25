# HalfMoon RFQ aggregation API (partner doc, condensed 2026-09-24)

HalfMoon (`https://rfq.halfmoondex.com`) is an RFQ aggregation service: market makers (MMs) quote
firm prices, the service returns `calldata` for its Router, the caller broadcasts it. Same-chain only
today (`dst_chain_id == src_chain_id`). Chains: **BSC (56)** and **Base (8453)** for execution; the
listing endpoints also return Ethereum (1) pairs. The `business` API key is a JWT issued to us; it lives
in the git-ignored `.env` as `HALFMOON_API_KEY` and is used **server-side only** (indexer / keeper),
never in the web bundle.

## Contracts

| Contract | BSC (56) | Base (8453) |
| --- | --- | --- |
| Settlement | `0x5F86475d57e9B488500d3CdA6F6Cb3938B192077` | `0x5F86475d57e9B488500d3CdA6F6Cb3938B192077` |
| Router | `0xC9f8Faab4708F498942aa9a18Ad1AF857e59A3D7` | `0xEC462c303970BD8175Ef8A43aCE23241359175f9` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

## Auth and envelope

- HTTP: `Authorization: Bearer <business_api_key>`. WebSocket: `?api_key=` or `X-API-Key`.
- Every response: `{ "code": 10000, "message": "success", "data": {...} }`; `code != 10000` is a business failure.
- Fields are `snake_case`; amounts are decimal strings in wei; `bytes` are base64 in JSON.
- Rate limit 100 QPS per IP (burst 120); HTTP 429 `{code: 429}` when exceeded.
- Errors: 10030 insufficient liquidity · 10070 invalid key · 10084 bad signature · 10090 unsupported chain · 10091 insufficient balance · 10095 bad params · 20001–20004 service errors · 401 missing key.

## Mode one — aggregated quotes (what we use)

`GET /v1/listing/pairs` → `data.pairs[]` `{id, chain_id, base_token, quote_token, pair_symbol, fee_rate (bps), is_enabled, status DISABLED|TESTING|ACTIVE, min_trade_amount}`.
`GET /v1/listing/tokens` → `data.tokens[]` `{id, chain_id, token_address, token_symbol, token_name, logo_url, decimals, total_supply, max_supply, wrapped_token, is_enabled}`.

`POST /v1/agg-swap/indicativeQuote` — non-binding estimate, no MM round trip.
Request `{src_chain_id, dst_chain_id, token_in, token_out, amount_in}`; response `{src_chain_id, token_in, token_out, amount_in, amount_out, fee_rate (bps), fee_amount}`.

`POST /v1/agg-swap/firmQuote` — binding quote with executable calldata.
Request `{src_chain_id, dst_chain_id, from_address, to_address, token_in, token_out, amount_in, amount_out_min, deadline (unix s)}`;
response `{swap_id, src_chain_id, calldata (base64 of Router.swap()), router_address, from_address, to_address, token_in, token_out, amount_in, amount_out, amount_out_min, fee_rate, fee_amount, deadline}`.
Execute: base64-decode `calldata`; send `{to: router_address, data, value: token_in is the gas coin ? amount_in : 0}` before `deadline`; ERC-20 inputs must be approved to the Router (or via Permit2) first.

## Mode two — aggregator (MM depth over WebSocket + single-MM firm quotes)

`wss://qe.halfmoondex.com/v1/quote/orderbook`, protobuf frames (`QEMessage` wrapper: SUBSCRIBE / UNSUBSCRIBE / ACKs / DEPTH_UPDATE per MM / HEARTBEAT / ERROR / CONNECTION_ACK). Depth prices are `quote_wei / base_wei`, amounts in base-token wei, `min_order_size` per snapshot. Heartbeat 30 s, read timeout 60 s, exponential reconnect 5 s → 160 s, resubscribe after reconnect.
`POST /v1/quote/firmQuote` `{chain_id, mm_id, token_in, token_out, amount_in, deadline, from?, recipient?, protocol_version "v1"}` → `{chain_id, mm_id, error_code (0 ok; 1 liquidity, 2 MM timeout, 3 rejected, 4 pair unsupported, 5 too small, 6 internal, 7 version), rfq_quote_data (base64 protobuf RFQQuoteV1), settlement_address}`.
`POST /v1/quote/reportTxHash` `{chain_id, pairs: [{quote_id, tx_hash}] (1–64)}` after broadcast; idempotent per (quote_id, tx_hash); one quote_id never maps to two hashes.
On-chain: `Settlement.settle(RFQQuote, amountIn ≤ mmQuote.amountIn, to)` for one MM, `Router.swap(from, to, RFQQuote[], amountsIn[], amountOutMin, permit2Data)` for several; `msg.value` carries a native input. Quotes decay over time (`confidenceExtractedValue` T/N/M/E: effectiveAmountOut = amountOut − amountOut·M/10000·(elapsed/T)^E, M ≤ 500 bps). Reverts: QuoteExpired, InvalidSignature, NonceUsed, AmountTooLarge, InsufficientOutput.

We do not use mode two; it is recorded here so the protobuf schema in the partner's original document is not needed to read the rest.

## Where it fits Radian / The Pound

- **Pack burns on other chains**: a Pack coin that lives on BSC or Base is bought through HalfMoon by the keeper (firmQuote → Router.swap with `to_address = 0x…dEaD`) once the home-chain burn pool has been bridged to that chain. Same floor / cap / rotation rules as the home chain; the tx hash is reported back with `reportTxHash` and recorded in the Pound ledger.
- **Cross-chain buy, origin leg**: a buyer on BSC or Base holding any listed token converts to USDC/USDT with a firm quote before the bridge leg (Relay / Across) delivers to the home chain's CrossBuyReceiver. Relay can also swap on the origin side, so HalfMoon is the better-priced option, not a requirement.
- Listing snapshot 2026-09-24: BSC 506 pairs (majors, USD1, Ondo tokenized stocks `…on`, a few community coins), Base 13 pairs (ETH, cbBTC, USDC, FLOCK and its quote tokens), Ethereum 457 pairs (tokenized stocks).
