import type { Express } from "express";
import express from "express";
import { encodeFunctionData, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { store } from "./store.js";
import {
  arcTestnet,
  publicClient,
  singleClient,
  FACTORY,
  LAUNCH_ROUTER,
  POF_ROUTER,
  EXECUTOR,
  curveReadAbi,
  curveTradeAbi,
  executorAbi,
  EXECUTOR_DOMAIN,
  BUY_AUTH_TYPES,
} from "./config.js";
import { keeperAddress } from "./keeper.js";

// Agent-facing API. Read-only planning endpoints that return unsigned
// transaction plans and never broadcast; plus intake of signed, bounded buy
// authorizations for RadianExecutor. Every price the API returns states how
// it was produced ("simulation" = exact eth_call of the real curve;
// "reserves" = computed from the curve's reserves and fee policy).
//
// Payments: the API is shaped for x402 (a manifest with per-service prices),
// but every service is free until a facilitator settles USDC on Arc — a paid
// call that cannot be settled must not exist.

const BPS = 10_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const POF_ROUTER_ABI = [
  {
    type: "function", name: "buy", stateMutability: "payable",
    inputs: [{ name: "token", type: "address" }, { name: "quoteIn", type: "uint256" }, { name: "minOut", type: "uint256" }],
    outputs: [{ name: "out", type: "uint256" }],
  },
] as const;

const SERVICES = [
  { id: "manifest", method: "GET", path: "/v1/manifest", price: null, note: "This document." },
  { id: "curve", method: "GET", path: "/v1/curve/:token", price: null, note: "Block-consistent snapshot of one launch: reserves, spot, fees, progress, template." },
  { id: "quote", method: "GET", path: "/v1/quote?token=&side=buy|sell&amount=&recipient=&slippageBps=", price: null, note: "Expected output and an unsigned transaction plan. Never broadcasts." },
  { id: "launch-plan", method: "POST", path: "/v1/launch-plan", price: null, note: "Unsigned launch transaction for a standard, Wall or Proof-of-Fee launch, with predicted template addresses." },
  { id: "auth", method: "POST", path: "/v1/auth", price: null, note: "Submit a signed RadianExecutor BuyAuth; the platform keeper executes it on schedule." },
  { id: "auth-list", method: "GET", path: "/v1/auth/:user", price: null, note: "Authorizations on file for a user, with execution progress." },
] as const;

const launchOf = (token: string) => store.launches.get(token.toLowerCase());
const bad = (res: express.Response, code: number, error: string) => res.status(code).json({ error });

export function mountAgentApi(app: Express) {
  const json = express.json({ limit: "32kb" });

  app.get("/v1/manifest", (_req, res) => {
    res.json({
      name: "Radian",
      version: "1",
      network: { chainId: arcTestnet.id, name: arcTestnet.name, rpc: arcTestnet.rpcUrls.default.http[0] },
      contracts: { factory: FACTORY, launchRouter: LAUNCH_ROUTER, pofRouter: POF_ROUTER, executor: EXECUTOR, keeper: keeperAddress() },
      identity: store.identity,
      payments: {
        protocol: "x402",
        enabled: false,
        note: "Every service is free until an x402 facilitator settles USDC on Arc. Prices will appear here first; no endpoint charges before then.",
      },
      services: SERVICES,
      rules: [
        "Plans are unsigned; the caller signs and broadcasts.",
        "Prices marked method=reserves are computed, not simulated; treat them as estimates.",
        "Proof-of-Fee buys should go through pofRouter to earn Work; the quote plan already does.",
      ],
    });
  });

  // Block-consistent snapshot: every read at one block, block hash re-read after.
  app.get("/v1/curve/:token", async (req, res) => {
    const l = launchOf(req.params.token);
    if (!l) return bad(res, 404, "unknown token");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const block = await singleClient.getBlock();
        const r = await publicClient.multicall({
          allowFailure: false,
          blockNumber: block.number,
          contracts: [
            { address: l.curve, abi: curveReadAbi, functionName: "getReserves" },
            { address: l.curve, abi: curveReadAbi, functionName: "trackedQuote" },
            { address: l.curve, abi: curveReadAbi, functionName: "graduated" },
            { address: l.curve, abi: curveTradeAbi, functionName: "feeBps" },
            { address: l.curve, abi: curveTradeAbi, functionName: "creatorTaxBps" },
            { address: l.curve, abi: curveTradeAbi, functionName: "launchedAt" },
          ],
        });
        const again = await singleClient.getBlock({ blockNumber: block.number });
        if (again.hash !== block.hash) continue; // reorged under us: retry once
        const [[q, t], tracked, graduated, feeBps, creatorTaxBps, launchedAt] = r as unknown as [[bigint, bigint], bigint, boolean, bigint, bigint, bigint];
        const goal = BigInt(l.graduationThreshold ?? "0");
        return res.json({
          block: { number: block.number.toString(), hash: block.hash, timestamp: Number(block.timestamp) },
          token: l.token, curve: l.curve, pairToken: l.pairToken ?? ZERO,
          quoteSymbol: l.quoteSymbol ?? "USDC", quoteDecimals: l.quoteDecimals ?? 18,
          quoteReserve: q.toString(), tokenReserve: t.toString(),
          spotPer1e18: t > 0n ? ((q * 10n ** 18n) / t).toString() : null,
          trackedQuote: tracked.toString(), graduationThreshold: goal.toString(),
          progress: goal > 0n ? Number(tracked) / Number(goal) : null,
          graduated, feeBps: Number(feeBps), creatorTaxBps: Number(creatorTaxBps), launchedAt: Number(launchedAt),
          template: l.template ?? null,
        });
      }
      return bad(res, 503, "chain state kept changing; retry");
    } catch (e: any) {
      return bad(res, 503, e?.shortMessage ?? String(e));
    }
  });

  // Quote + unsigned plan. Native buys are simulated exactly; other paths are
  // computed from reserves and labeled as such.
  app.get("/v1/quote", async (req, res) => {
    const token = String(req.query.token ?? "");
    const side = String(req.query.side ?? "buy");
    const amountStr = String(req.query.amount ?? "");
    const recipient = String(req.query.recipient ?? "");
    const slippageBps = BigInt(Math.max(0, Math.min(5000, Number(req.query.slippageBps ?? 100) || 100)));
    const l = launchOf(token);
    if (!l) return bad(res, 404, "unknown token");
    if (side !== "buy" && side !== "sell") return bad(res, 400, "side must be buy or sell");
    if (!/^\d+$/.test(amountStr) || amountStr === "0") return bad(res, 400, "amount must be a positive integer in raw units");
    if (recipient && !isAddress(recipient)) return bad(res, 400, "bad recipient");
    const amount = BigInt(amountStr);
    const rcpt = (recipient || "0x000000000000000000000000000000000000dEaD") as Address;
    const native = !l.pairToken || l.pairToken.toLowerCase() === ZERO;
    try {
      const [[q, t], graduated, feeBps, creatorTaxBps, snipeBps] = (await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { address: l.curve, abi: curveReadAbi, functionName: "getReserves" },
          { address: l.curve, abi: curveReadAbi, functionName: "graduated" },
          { address: l.curve, abi: curveTradeAbi, functionName: "feeBps" },
          { address: l.curve, abi: curveTradeAbi, functionName: "creatorTaxBps" },
          { address: l.curve, abi: curveTradeAbi, functionName: "currentSnipeTaxBps", args: [rcpt] },
        ],
      })) as unknown as [[bigint, bigint], boolean, bigint, bigint, bigint];
      if (graduated) return bad(res, 409, "graduated: trade on the V4 pool");
      let out: bigint;
      let method: "simulation" | "reserves" = "reserves";
      if (side === "buy") {
        const net = (amount * (BPS - feeBps - creatorTaxBps - snipeBps)) / BPS;
        out = t - (q * t) / (q + net);
        if (native && recipient) {
          try {
            const sim = await singleClient.simulateContract({
              address: l.curve, abi: curveTradeAbi, functionName: "buy", args: [amount, 0n, rcpt], value: amount, account: rcpt,
            });
            out = sim.result as bigint;
            method = "simulation";
          } catch {}
        }
      } else {
        const gross = q - (q * t) / (t + amount);
        out = (gross * (BPS - feeBps - creatorTaxBps)) / BPS;
      }
      const minOut = (out * (BPS - slippageBps)) / BPS;
      const pof = l.template?.kind === "pof";
      const plan =
        side === "buy"
          ? pof
            ? { to: POF_ROUTER, data: encodeFunctionData({ abi: POF_ROUTER_ABI, functionName: "buy", args: [l.token, amount, minOut] }), value: native ? amount.toString() : "0", approve: native ? null : { token: l.pairToken, spender: POF_ROUTER, amount: amount.toString() } }
            : { to: l.curve, data: encodeFunctionData({ abi: curveTradeAbi, functionName: "buy", args: [amount, minOut, rcpt] }), value: native ? amount.toString() : "0", approve: native ? null : { token: l.pairToken, spender: l.curve, amount: amount.toString() } }
          : { to: l.curve, data: encodeFunctionData({ abi: curveTradeAbi, functionName: "sell", args: [amount, minOut, rcpt] }), value: "0", approve: { token: l.token, spender: l.curve, amount: amount.toString() } };
      res.json({
        token: l.token, curve: l.curve, side, amountIn: amount.toString(), expectedOut: out.toString(), minOut: minOut.toString(),
        method, exact: method === "simulation",
        fees: { feeBps: Number(feeBps), creatorTaxBps: Number(creatorTaxBps), snipeTaxBps: side === "buy" ? Number(snipeBps) : 0 },
        quoteDecimals: l.quoteDecimals ?? 18, quoteSymbol: l.quoteSymbol ?? "USDC",
        plan, note: recipient ? undefined : "pass recipient= for an exact simulated buy and a plan addressed to you",
      });
    } catch (e: any) {
      return bad(res, 503, e?.shortMessage ?? String(e));
    }
  });

  // Signed BuyAuth intake for RadianExecutor.
  app.post("/v1/auth", json, async (req, res) => {
    const b = req.body ?? {};
    const a = b.auth ?? {};
    const sig = String(b.signature ?? "");
    if (!isAddress(a.user ?? "") || !isAddress(a.token ?? "")) return bad(res, 400, "auth.user / auth.token must be addresses");
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return bad(res, 400, "signature must be 65 bytes hex");
    for (const k of ["perBuyMax", "maxGasPrice", "nonce"]) if (!/^\d+$/.test(String(a[k] ?? ""))) return bad(res, 400, `${k} must be a decimal string`);
    for (const k of ["totalCount", "minInterval", "deadline"]) if (!Number.isInteger(Number(a[k])) || Number(a[k]) < 0) return bad(res, 400, `${k} must be an integer`);
    if (Number(a.totalCount) === 0 || BigInt(a.perBuyMax) === 0n) return bad(res, 400, "totalCount and perBuyMax must be positive");
    if (Number(a.deadline) <= Math.floor(Date.now() / 1000)) return bad(res, 400, "deadline is in the past");
    if (!launchOf(a.token)) return bad(res, 404, "unknown token");
    const message = {
      user: a.user as Address, token: a.token as Address, perBuyMax: BigInt(a.perBuyMax), maxGasPrice: BigInt(a.maxGasPrice),
      totalCount: Number(a.totalCount), minInterval: Number(a.minInterval), deadline: BigInt(a.deadline), nonce: BigInt(a.nonce),
    };
    try {
      const signer = await recoverTypedDataAddress({
        domain: { ...EXECUTOR_DOMAIN, chainId: arcTestnet.id, verifyingContract: EXECUTOR },
        types: BUY_AUTH_TYPES, primaryType: "BuyAuth", message, signature: sig as Hex,
      });
      if (signer.toLowerCase() !== String(a.user).toLowerCase()) return bad(res, 400, "signature does not match auth.user");
      const [nonce, authId] = (await publicClient.multicall({
        allowFailure: false,
        contracts: [
          { address: EXECUTOR, abi: executorAbi, functionName: "nonces", args: [a.user as Address] },
          { address: EXECUTOR, abi: executorAbi, functionName: "authId", args: [message] },
        ],
      })) as unknown as [bigint, Hex];
      if (nonce !== message.nonce) return bad(res, 409, `nonce mismatch: on-chain nonce is ${nonce}`);
      const stored = {
        authId, user: a.user as Address, token: a.token as Address,
        auth: { ...a, user: a.user, token: a.token, perBuyMax: String(a.perBuyMax), maxGasPrice: String(a.maxGasPrice), totalCount: Number(a.totalCount), minInterval: Number(a.minInterval), deadline: Number(a.deadline), nonce: String(a.nonce) },
        signature: sig as Hex, createdAt: Date.now(), count: 0, lastAt: 0, status: "active" as const,
      };
      store.auths.set(authId.toLowerCase(), stored);
      store.save();
      res.json({ ok: true, authId });
    } catch (e: any) {
      return bad(res, 503, e?.shortMessage ?? String(e));
    }
  });

  app.get("/v1/auth/:user", (req, res) => {
    const u = String(req.params.user).toLowerCase();
    if (!isAddress(u)) return bad(res, 400, "bad address");
    const auths = [...store.auths.values()].filter((a) => a.user.toLowerCase() === u).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ auths });
  });

  // Unsigned launch plan (standard / wall / pof). Body: { template, params, launchConfigId, pairToken, buyAmount, minTokensOut, cfg }
  app.post("/v1/launch-plan", json, async (req, res) => {
    const b = req.body ?? {};
    const template = String(b.template ?? "standard");
    const p = b.params ?? {};
    const pair = String(b.pairToken ?? ZERO);
    if (!isAddress(pair)) return bad(res, 400, "bad pairToken");
    if (!p.name || !p.symbol) return bad(res, 400, "params.name and params.symbol are required");
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(p.salt ?? ""))) return bad(res, 400, "params.salt must be bytes32");
    const creator = String(b.creator ?? "");
    if (!isAddress(creator)) return bad(res, 400, "creator address required");
    const buyAmount = BigInt(String(b.buyAmount ?? "0"));
    const minOut = BigInt(String(b.minTokensOut ?? "0"));
    const native = pair.toLowerCase() === ZERO;
    try {
      const { launchRouterAbi } = await import("./launchRouterAbi.js");
      const fee = (await publicClient.readContract({ address: FACTORY, abi: [{ type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "launchFee" })) as bigint;
      const params = {
        name: String(p.name), symbol: String(p.symbol), logo: String(p.logo ?? ""), description: String(p.description ?? ""),
        socials: { twitter: String(p.socials?.twitter ?? ""), telegram: String(p.socials?.telegram ?? ""), discord: String(p.socials?.discord ?? ""), website: String(p.socials?.website ?? ""), farcaster: String(p.socials?.farcaster ?? "") },
        creatorFeeRecipient: (isAddress(p.creatorFeeRecipient ?? "") ? p.creatorFeeRecipient : creator) as Address,
        creatorTaxBps: Number(p.creatorTaxBps ?? 0), buybackEnabled: template === "standard" ? Boolean(p.buybackEnabled ?? true) : false,
        expectedEconomics: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex, salt: p.salt as Hex,
      };
      const configId = BigInt(String(b.launchConfigId ?? "0"));
      const exemptions: Address[] = Array.isArray(b.snipeTaxExemptions) ? b.snipeTaxExemptions.filter((x: string) => isAddress(x)) : [];
      let data: Hex;
      let predicted: Record<string, Address> | null = null;
      if (template === "wall") {
        const c = b.cfg ?? {};
        const cfg = { marginBps: Number(c.marginBps ?? 500), epochBudgetBps: Number(c.epochBudgetBps ?? 1000), streamBps: Number(c.streamBps ?? 3000), maxSlippageBps: Number(c.maxSlippageBps ?? 500), minInterval: Number(c.minInterval ?? 3600), keeperBounty: BigInt(String(c.keeperBounty ?? "10000000000000000")) };
        data = encodeFunctionData({ abi: launchRouterAbi, functionName: "launchWall", args: [params, configId, pair as Address, buyAmount, minOut, exemptions, cfg] });
        const [treasury, staking] = (await publicClient.readContract({ address: LAUNCH_ROUTER, abi: launchRouterAbi, functionName: "predictWall", args: [creator as Address, p.salt as Hex] })) as readonly [Address, Address];
        predicted = { treasury, staking };
      } else if (template === "pof") {
        const c = b.cfg ?? {};
        const cfg = { targetWork: BigInt(String(c.targetWork ?? "5000000000000000000")), roundSeconds: Number(c.roundSeconds ?? 600), minInterval: Number(c.minInterval ?? 600), maxBuybackReserveBps: Number(c.maxBuybackReserveBps ?? 500) };
        data = encodeFunctionData({ abi: launchRouterAbi, functionName: "launchPoF", args: [params, configId, pair as Address, buyAmount, minOut, exemptions, cfg] });
        const vault = (await publicClient.readContract({ address: LAUNCH_ROUTER, abi: launchRouterAbi, functionName: "predictPoF", args: [creator as Address, p.salt as Hex] })) as Address;
        predicted = { vault };
      } else {
        data = encodeFunctionData({ abi: launchRouterAbi, functionName: "launchAndBuy", args: [params, configId, pair as Address, buyAmount, minOut, exemptions] });
      }
      res.json({
        template, to: LAUNCH_ROUTER, data, value: (fee + (native ? buyAmount : 0n)).toString(), launchFee: fee.toString(),
        approve: !native && buyAmount > 0n ? { token: pair, spender: LAUNCH_ROUTER, amount: buyAmount.toString() } : null,
        predicted, note: "Unsigned. The router attributes the launch to the sender; templates set the creator-fee recipient themselves.",
      });
    } catch (e: any) {
      return bad(res, 503, e?.shortMessage ?? String(e));
    }
  });
}
