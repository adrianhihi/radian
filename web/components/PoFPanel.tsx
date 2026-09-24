"use client";

// Proof-of-Fee on the design system: creator fees buy the token back; each
// round's buyback is paid to the traders whose fees funded it, by share of
// quote spent through the official PoF router ("Work"). Rounds settle lazily
// after they end (any router buy or keeper buyback settles them), so a round
// can be over and still "awaiting settlement".
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { Panel, PrimaryButton } from "@/components/ui/primitives";
import { Divider, Note, PanelHead, Row, Spinner } from "@/components/ui/rows";
import { publicClient, arcTestnet, explorer, type QuoteAsset } from "@/lib/radian";
import { pofVaultAbi, pofRouterAbi, fmtAmount, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";
import { recordTx } from "@/lib/txLog";
import { txErrorText } from "@/lib/txError";

const MAX_CLAIM = 100; // rounds per claim() call
const SCAN_ROUNDS = 300; // most recent active rounds we look at per refresh
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

type Props = {
  token: Address;
  symbol: string;
  vault: Address;
  pofRouter: Address;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: Hex) => void;
  refreshKey: number;
};

type Data = Partial<{
  currentRound: bigint; launchedAt: bigint; config: readonly [bigint, number, number, number];
  unallocated: bigint; totalBought: bigint; totalPaid: bigint; plannedSpend: bigint;
  myWork: bigint; roundWork: bigint;
  claimable: bigint[]; // settled rounds with my Work, not yet claimed
  awaiting: number; // ended rounds with my Work, not yet settled
  pending: bigint; // vault.pendingOf over `claimable` (first MAX_CLAIM)
}>;

export function PoFPanel({ token, symbol, vault, pofRouter, quote, identity, onToast, onPending, refreshKey }: Props) {
  const t = useT();
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<Data>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const who = account ?? ZERO;
    try {
      const head = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: vault, abi: pofVaultAbi, functionName: "currentRound" },
          { address: vault, abi: pofVaultAbi, functionName: "launchedAt" },
          { address: vault, abi: pofVaultAbi, functionName: "config" },
          { address: vault, abi: pofVaultAbi, functionName: "unallocated" },
          { address: vault, abi: pofVaultAbi, functionName: "totalBought" },
          { address: vault, abi: pofVaultAbi, functionName: "totalPaid" },
          { address: vault, abi: pofVaultAbi, functionName: "plannedSpend" },
          { address: pofRouter, abi: pofRouterAbi, functionName: "activeRoundCount", args: [token] },
        ],
      });
      const g = <T,>(i: number) => (head[i].status === "success" ? (head[i].result as T) : undefined);
      const next: Data = { currentRound: g<bigint>(0), launchedAt: g<bigint>(1), config: g<Data["config"]>(2), unallocated: g<bigint>(3), totalBought: g<bigint>(4), totalPaid: g<bigint>(5), plannedSpend: g<bigint>(6) };
      const cur = next.currentRound;
      const count = g<bigint>(7);
      if (cur !== undefined) {
        const work = await publicClient.multicall({
          allowFailure: true,
          contracts: [
            { address: pofRouter, abi: pofRouterAbi, functionName: "workOf", args: [token, cur, who] },
            { address: pofRouter, abi: pofRouterAbi, functionName: "totalWork", args: [token, cur] },
          ],
        });
        next.myWork = account && work[0].status === "success" ? (work[0].result as bigint) : undefined;
        next.roundWork = work[1].status === "success" ? (work[1].result as bigint) : undefined;
      }
      if (account && cur !== undefined && count !== undefined && count > 0n) {
        const n = Number(count);
        const from = Math.max(0, n - SCAN_ROUNDS);
        const idx = Array.from({ length: n - from }, (_, i) => BigInt(from + i));
        const rs = await publicClient.multicall({ allowFailure: true, contracts: idx.map((i) => ({ address: pofRouter, abi: pofRouterAbi, functionName: "activeRoundAt", args: [token, i] })) });
        const rounds = rs.flatMap((r) => (r.status === "success" ? [r.result as bigint] : [])).filter((r) => r < cur);
        if (rounds.length > 0) {
          const st = await publicClient.multicall({
            allowFailure: true,
            contracts: rounds.flatMap((r) => [
              { address: vault, abi: pofVaultAbi, functionName: "settled", args: [r] } as const,
              { address: vault, abi: pofVaultAbi, functionName: "claimed", args: [r, account] } as const,
              { address: pofRouter, abi: pofRouterAbi, functionName: "workOf", args: [token, r, account] } as const,
            ]),
          });
          const claimable: bigint[] = [];
          let awaiting = 0;
          rounds.forEach((r, i) => {
            const settled = st[i * 3].result as boolean | undefined;
            const claimed = st[i * 3 + 1].result as boolean | undefined;
            const w = st[i * 3 + 2].result as bigint | undefined;
            if (!w || w === 0n || claimed) return;
            if (settled) claimable.push(r);
            else awaiting++;
          });
          next.claimable = claimable;
          next.awaiting = awaiting;
          if (claimable.length > 0) {
            try {
              next.pending = (await publicClient.readContract({ address: vault, abi: pofVaultAbi, functionName: "pendingOf", args: [account, claimable.slice(0, MAX_CLAIM)] })) as bigint;
            } catch {}
          } else next.pending = 0n;
        } else {
          next.claimable = [];
          next.awaiting = 0;
          next.pending = 0n;
        }
      }
      setD(next);
    } catch {}
  }, [vault, pofRouter, token, account]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 12000);
    return () => clearInterval(iv);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  async function claim() {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast(t("quick.identity"));
    const rounds = (d.claimable ?? []).slice(0, MAX_CLAIM);
    if (rounds.length === 0) return;
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast(t("create.noWallet"));
      onToast(t("pof.confirmClaim", { n: rounds.length }));
      const h = await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: vault, abi: pofVaultAbi, functionName: "claim", args: [rounds] });
      await waitReceipt(h, "claim", { token, what: "pof" });
      recordTx(wc.account, { hash: h, kind: "pofClaim", token, time: Date.now() });
      onToast(t("portfolio.claimed", { sym: symbol }));
      await load();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast(t("trade.pending"));
      } else {
        onToast(txErrorText(t, e, { fallback: t("portfolio.claimFailed") }));
      }
    } finally {
      setBusy(false);
    }
  }

  const cfg = d.config;
  const roundSecs = cfg ? Number(cfg[1]) : undefined;
  const endsIn = d.currentRound !== undefined && d.launchedAt !== undefined && roundSecs && now > 0 ? Number(d.launchedAt) + (Number(d.currentRound) + 1) * roundSecs - now : undefined;
  const q = (v?: bigint, digits = 4) => `${fmtAmount(v, quote.decimals, digits)} ${quote.symbol}`;
  const claimableN = d.claimable?.length;

  return (
    <Panel>
      <PanelHead title={t("pof.title")} address={vault} explorer={explorer.address} label={t("pof.vault")} />
      <Note className="mb-3">{t("pof.body", { sym: symbol, q: quote.symbol })}</Note>

      <Row label={t("pof.round")} value={`${d.currentRound === undefined ? "—" : `#${d.currentRound.toString()}`}${roundSecs ? ` · ${t("pof.each", { v: fmtDuration(roundSecs) })}` : ""}`} />
      <Row label={t("pof.endsIn")} value={endsIn === undefined ? "—" : fmtDuration(Math.max(0, endsIn))} />
      <Row label={t("pof.yourWork")} value={account ? q(d.myWork) : t("pof.signIn")} />
      <Row label={t("pof.roundTotal")} value={`${q(d.roundWork)}${cfg ? ` (${t("pof.target", { v: `${fmtAmount(cfg[0], quote.decimals)} ${quote.symbol}` })})` : ""}`} />
      <Divider />
      <Row label={t("pof.bought")} value={`${fmtAmount(d.totalBought, 18, 0)} ${symbol}`} />
      <Row label={t("pof.paid")} value={`${fmtAmount(d.totalPaid, 18, 0)} ${symbol}`} />
      <Row label={t("pof.unallocated")} value={`${fmtAmount(d.unallocated, 18, 0)} ${symbol}`} />
      <Row label={t("pof.nextSpend")} value={q(d.plannedSpend)} />
      <Row label={t("wall.config")} small tone="muted" value={cfg ? `${t("pof.cfgRound")} ${fmtDuration(Number(cfg[1]))} · ${t("pof.cfgTarget")} ${fmtAmount(cfg[0], quote.decimals)} ${quote.symbol} · ${t("pof.cfgCap")} ≤ ${(Number(cfg[3]) / 100).toFixed(1)}% · ${t("wall.cfgEvery")} ≥ ${fmtDuration(Number(cfg[2]))}` : "—"} />
      <Divider />
      {account ? (
        <>
          <Row label={t("pof.settledRounds")} value={claimableN === undefined ? "—" : claimableN} />
          <Row label={t("pof.claimableNow")} value={`${fmtAmount(d.pending, 18, 2)} ${symbol}`} tone="pos" />
          {!!d.awaiting && <Note className="mt-2">{t("pof.awaiting", { n: d.awaiting })}</Note>}
          {claimableN !== undefined && claimableN > 0 && (
            <Note className="mt-1">
              {t("pof.rounds")} {d.claimable!.slice(0, 12).map((r) => `#${r}`).join(", ")}
              {claimableN > 12 ? ` … (+${claimableN - 12})` : ""}
              {claimableN > MAX_CLAIM ? ` — ${t("pof.perClaim", { n: MAX_CLAIM })}` : ""}
            </Note>
          )}
        </>
      ) : (
        <Note>{t("pof.signInNote")}</Note>
      )}
      <PrimaryButton type="button" className="mt-4" onClick={claim} disabled={busy || (identity.checked && !identity.ok) || (authenticated && !(claimableN && d.pending && d.pending > 0n))}>
        {busy ? <Spinner /> : !authenticated ? t("pof.signInClaim") : claimableN ? t("pof.claimN", { n: Math.min(claimableN, MAX_CLAIM) }) : t("pof.nothing")}
      </PrimaryButton>
    </Panel>
  );
}
