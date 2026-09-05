# ponsOnCircle

Pons-style memecoin launchpad for **Circle's Arc chain**, quoted in Arc's **native USDC**.

Anyone can launch a fixed-supply (1B) token in one transaction; it trades immediately on a
constant-product bonding curve against native USDC. Liquidity is locked forever — no one
(including the factory owner) can withdraw reserve USDC or reserve tokens. 1% fee per trade,
split 50/50 between the token creator and the protocol treasury. When a pool's real USDC
reserve crosses the graduation threshold it emits `Graduated` and trading continues.

## Why native USDC (and the 18/6 decimals gotcha)

Arc uses USDC as the native gas token. **`msg.value` is 18-decimal native units**; the
6-decimal USDC is only the optional ERC-20 display interface at
`0x3600000000000000000000000000000000000000` — same underlying balance. All contract math
here is 18-decimal native. There is no WETH and (as of testnet docs) no canonical DEX on
Arc, so graduation keeps liquidity in the locked curve pool rather than migrating.

## Contracts

| Contract | Role |
|---|---|
| `LaunchpadFactory` | `createToken(name, symbol, metadataURI)` payable — deploys pool + token atomically. Owner params (`launchFee`, `virtualUsdc`, `graduationReserve`, `feeBps`, `creatorShareBps`) affect **future launches only**. |
| `LaunchToken` | Fixed 1B supply ERC20, fully minted to its pool at creation. No owner, no mint. |
| `CurvePool` | x·y=k curve with a virtual USDC reserve (bootstrap price, no seed capital). `buy` (payable) / `sell` with slippage + deadline guards; pull-pattern fee claims; reentrancy-guarded. |

Default params: launch fee 1 USDC · virtual reserve 6,000 USDC (initial FDV ≈ $6k) ·
graduation at 20,000 USDC real reserve · 1% trade fee, 50% to creator.

## Arc network reference (verified from docs.arc.io, Sep 2026)

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `5042002` | `5042` (public launch 2026-09-16) |
| RPC | `https://rpc.testnet.arc.io` | — |
| Explorer | `https://testnet.arcscan.app` | — |
| Faucet | `https://faucet.circle.com` | — |

Gas: EIP-1559 + EWMA smoothing, min base fee 20 gwei (set `maxFeePerGas ≥ 20 gwei`),
target ≈ $0.01/tx. EVM: Osaka baseline; compile with `evm_version = shanghai` (per Arc
docs). `PREVRANDAO` returns 0; blob txs rejected.

## Develop

```bash
forge build
forge test
```

## Deploy to Arc testnet

1. Fund the deployer address with testnet USDC at https://faucet.circle.com
2. `cp .env.example .env` and fill `PRIVATE_KEY`
3. ```bash
   source .env && forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
   ```

Launch a token against a deployed factory:

```bash
cast send $FACTORY "createToken(string,string,string)" "My Token" "MTK" "ipfs://…" \
  --value 1ether --rpc-url arc_testnet --private-key $PRIVATE_KEY
```

(`1ether` = 1e18 native units = 1 USDC launch fee.)

## Deployed (Arc testnet, 2026-09-05)

| Contract | Address |
|---|---|
| `LaunchpadFactory` | [`0x112923dec686b647d140ee58c17b0e4b6f804149`](https://testnet.arcscan.app/address/0x112923dec686b647d140ee58c17b0e4b6f804149) |
| PTEST smoke-test token | `0x9eca6733e1844b5391a501c8112331ac3164bb40` |
| PTEST pool | `0x2697dd5b00e127a66e76c35484644d333ccc0c2a` |

Smoke test passed end-to-end on-chain: launch (1 USDC fee) → buy 5 USDC → sell half back.
Curve math matched theory exactly; pool native balance == realUsdc + unclaimed fees at
every step. Note: Arc emits ERC20-style `Transfer` logs from `0xff…fe` for native USDC
moves — useful for indexing.

## Status / roadmap

- [x] Phase 1 — contracts + 14-test suite (incl. fuzz solvency invariant), all passing
- [x] Phase 2 — deployed to Arc testnet + live smoke test (launch/buy/sell verified)
- [ ] Phase 3 — indexer + web frontend (launch form, token list, trade UI)
- [ ] Phase 4 — $PONS-style protocol token & buyback/burn loop (design open)
