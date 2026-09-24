"use client";

// One trade path for every surface (quick buy on Explore, the token page, the
// swap console): approvals when the quote is an ERC-20, the router v4 buy/sell
// with the stored referrer where The Pound runs, the PoF router for Proof-of-Fee
// launches, the curve directly elsewhere. Every send is a real transaction the
// caller confirms in their wallet; nothing is retried or resent.
import { useCallback } from "react";
import { parseAbi, type Address, type Hex } from "viem";
import { publicClient, curveAbi, erc20Abi, arcTestnet, RADIAN, hasPound, type LaunchTemplate } from "./radian";
import { pofRouterAbi } from "./templates";
import { routerTradeAbi } from "./pound";
import { getReferrer } from "./referral";
import { useRadianWallet } from "./useRadianWallet";
import { useIdentity } from "./identity";
import { waitReceipt } from "./pendingTx";

export type TradeTarget = {
  token: Address;
  curve: Address;
  pairToken: Address;
  native: boolean;
  template?: LaunchTemplate | null;
};

export type TradeStatus = "approve" | "approved" | "confirm" | "sent";

const tokenApproveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

export function useTrade() {
  const { authenticated, login, getWalletClient } = useRadianWallet();
  const identity = useIdentity();
  const identityOk = !(identity.checked && !identity.ok);

  /** Buy `inWei` of quote for at least `minOut` tokens. Resolves with the buy's tx hash after its receipt. */
  const buy = useCallback(
    async (t: TradeTarget, inWei: bigint, minOut: bigint, onStatus?: (s: TradeStatus) => void): Promise<Hex> => {
      const wc = await getWalletClient();
      if (!wc) throw new Error("No wallet available. Sign in again.");
      const { client, account } = wc;
      const pof = t.template?.kind === "pof" ? t.template : null;
      const viaRouter = hasPound && !pof;
      const spender = pof ? pof.pofRouter : viaRouter ? RADIAN.router : t.curve;
      const send = (value?: bigint) =>
        pof
          ? client.writeContract({ account, chain: arcTestnet, address: pof.pofRouter, abi: pofRouterAbi, functionName: "buy", args: [t.token, inWei, minOut], value })
          : viaRouter
            ? client.writeContract({ account, chain: arcTestnet, address: RADIAN.router, abi: routerTradeAbi, functionName: "buy", args: [t.token, inWei, minOut, account, getReferrer()], value })
            : client.writeContract({ account, chain: arcTestnet, address: t.curve, abi: curveAbi, functionName: "buy", args: [inWei, minOut, account], value });

      if (t.native) {
        onStatus?.("confirm");
        const hash = await send(inWei);
        onStatus?.("sent");
        await waitReceipt(hash, "buy", { token: t.token });
        return hash;
      }
      onStatus?.("approve");
      const ah = await client.writeContract({ account, chain: arcTestnet, address: t.pairToken, abi: tokenApproveAbi, functionName: "approve", args: [spender, inWei] });
      await waitReceipt(ah, "approve");
      // the wallet may have edited the amount: re-read before spending on it
      const allowed = (await publicClient.readContract({ address: t.pairToken, abi: erc20Abi, functionName: "allowance", args: [account, spender] })) as bigint;
      if (allowed < inWei) throw new Error("Your wallet approved a smaller amount, so nothing was bought. Approve the full amount to continue.");
      onStatus?.("confirm");
      const hash = await send(undefined);
      onStatus?.("sent");
      await waitReceipt(hash, "buy", { token: t.token });
      return hash;
    },
    [getWalletClient],
  );

  /** Sell `inTok` tokens for at least `minOut` quote. */
  const sell = useCallback(
    async (t: TradeTarget, inTok: bigint, minOut: bigint, onStatus?: (s: TradeStatus) => void): Promise<Hex> => {
      const wc = await getWalletClient();
      if (!wc) throw new Error("No wallet available. Sign in again.");
      const { client, account } = wc;
      const via = hasPound ? RADIAN.router : t.curve;
      onStatus?.("approve");
      const ah = await client.writeContract({ account, chain: arcTestnet, address: t.token, abi: tokenApproveAbi, functionName: "approve", args: [via, inTok] });
      await waitReceipt(ah, "approve");
      const allowed = (await publicClient.readContract({ address: t.token, abi: erc20Abi, functionName: "allowance", args: [account, via] })) as bigint;
      if (allowed < inTok) throw new Error("Your wallet approved a smaller amount, so nothing was sold. Approve the full amount to continue.");
      onStatus?.("confirm");
      const hash = hasPound
        ? await client.writeContract({ account, chain: arcTestnet, address: RADIAN.router, abi: routerTradeAbi, functionName: "sell", args: [t.token, inTok, minOut, account, getReferrer()] })
        : await client.writeContract({ account, chain: arcTestnet, address: t.curve, abi: curveAbi, functionName: "sell", args: [inTok, minOut, account] });
      onStatus?.("sent");
      await waitReceipt(hash, "sell", { token: t.token });
      return hash;
    },
    [getWalletClient],
  );

  return { buy, sell, authenticated, login, identityOk };
}

/** Curve facts a quote needs, read in one multicall. */
export type CurveQuoteState = { quoteReserve: bigint; tokenReserve: bigint; sellable: bigint; feeBps: bigint; creatorTaxBps: bigint; snipeBps: bigint };

export async function readCurveQuoteState(curve: Address, account?: Address): Promise<CurveQuoteState> {
  const mc = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      { address: curve, abi: curveAbi, functionName: "getReserves" },
      { address: curve, abi: curveAbi, functionName: "sellableTokens" },
      { address: curve, abi: curveAbi, functionName: "feeBps" },
      { address: curve, abi: curveAbi, functionName: "creatorTaxBps" },
      { address: curve, abi: curveAbi, functionName: "currentSnipeTaxBps", args: [account ?? "0x0000000000000000000000000000000000000001"] },
    ],
  });
  const r = (mc[0].result as [bigint, bigint] | undefined) ?? [0n, 0n];
  return {
    quoteReserve: r[0],
    tokenReserve: r[1],
    sellable: (mc[1].result as bigint | undefined) ?? 0n,
    feeBps: (mc[2].result as bigint | undefined) ?? 100n,
    creatorTaxBps: (mc[3].result as bigint | undefined) ?? 0n,
    snipeBps: (mc[4].result as bigint | undefined) ?? 0n,
  };
}

const BPS = 10_000n;

/** Mirrors PonsV2BondingCurve.buy: fees off the quote leg, constant product, clamped to the sellable allocation. */
export function quoteBuy(s: CurveQuoteState, inWei: bigint, slippageBps: number): { out: bigint; minOut: bigint; fee: bigint } | null {
  if (inWei <= 0n || s.quoteReserve <= 0n) return null;
  let snipe = s.snipeBps;
  const maxSnipe = BPS - s.feeBps - s.creatorTaxBps - 100n;
  if (snipe > maxSnipe) snipe = maxSnipe;
  const fee = (inWei * s.feeBps) / BPS;
  const tax = (inWei * s.creatorTaxBps) / BPS;
  const snipeTax = (inWei * snipe) / BPS;
  const net = inWei - fee - tax - snipeTax;
  if (net <= 0n) return null;
  let out = (s.tokenReserve * net) / (s.quoteReserve + net);
  if (out > s.sellable) out = s.sellable;
  return { out, minOut: (out * (BPS - BigInt(slippageBps))) / BPS, fee };
}

/** Mirrors PonsV2BondingCurve.sell. */
export function quoteSell(s: CurveQuoteState, inTok: bigint, slippageBps: number): { out: bigint; minOut: bigint; fee: bigint } | null {
  if (inTok <= 0n || s.tokenReserve <= 0n) return null;
  const gross = (s.quoteReserve * inTok) / (s.tokenReserve + inTok);
  const fee = (gross * s.feeBps) / BPS;
  const tax = (gross * s.creatorTaxBps) / BPS;
  const out = gross - fee - tax;
  return { out, minOut: (out * (BPS - BigInt(slippageBps))) / BPS, fee };
}
