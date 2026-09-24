"use client";

// What the wallet has let Radian's contracts spend: allowances of each ERC-20
// quote asset to the routers, the executor and the curves, read from the chain.
// Revoke sends approve(spender, 0) from the wallet — the only transaction this
// panel asks for, user-initiated and risk-reducing. A read that fails says so
// and never claims "no approvals"; after a revoke the list re-reads at 6 s and
// 15 s so the card disappears once the chain shows zero.
import { useCallback, useEffect, useState } from "react";
import { formatUnits, maxUint256, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { Info } from "@/components/ui/Info";
import { Panel, SectionHead } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { useNetwork } from "@/lib/networks";
import { publicClient, erc20Abi, explorer, RADIAN, arcTestnet, hasLaunchRouter, hasPofRouter, hasExecutor, type LaunchRow } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { txErrorText } from "@/lib/txError";
import { fmtNum, shortAddr } from "@/lib/ui/format";

type Row = { token: Address; symbol: string; decimals: number; spender: Address; spenderName: string; amount: bigint };
type Sent = { hash: Hex } | { failed: string } | "confirm";
const UNLIMITED = maxUint256 / 2n;

export function Approvals({ address, rows }: { address: Address; rows: LaunchRow[] }) {
  const t = useT();
  const net = useNetwork();
  const { getWalletClient } = useRadianWallet();
  const [list, setList] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState<"all" | "some" | null>(null);
  const [sent, setSent] = useState<Record<string, Sent>>({});

  const spenders: { address: Address; name: string }[] = [
    ...(hasLaunchRouter ? [{ address: RADIAN.router, name: t("approvals.router") }] : []),
    ...(hasPofRouter ? [{ address: RADIAN.pofRouter, name: t("approvals.pofRouter") }] : []),
    ...(hasExecutor ? [{ address: RADIAN.executor, name: t("approvals.executor") }] : []),
    ...rows.filter((r) => !r.graduated).map((r) => ({ address: r.curve, name: t("approvals.curve", { sym: r.symbol }) })),
  ];
  const tokens = net.quoteAssets.filter((q) => !q.native);

  const load = useCallback(async () => {
    if (!tokens.length || !spenders.length) {
      setList([]);
      return;
    }
    const pairs = tokens.flatMap((q) => spenders.map((s) => ({ q, s })));
    try {
      const res = await publicClient.multicall({
        allowFailure: true,
        contracts: pairs.map(({ q, s }) => ({ address: q.address, abi: erc20Abi, functionName: "allowance" as const, args: [address, s.address] as const })),
      });
      const out: Row[] = [];
      let bad = 0;
      pairs.forEach(({ q, s }, i) => {
        const r = res[i];
        if (!r || r.status !== "success") {
          bad++;
          return;
        }
        const v = r.result as bigint;
        if (v > 0n) out.push({ token: q.address, symbol: q.symbol, decimals: q.decimals, spender: s.address, spenderName: s.name, amount: v });
      });
      setList(out);
      setFailed(bad === 0 ? null : bad === pairs.length ? "all" : "some");
    } catch {
      setList([]);
      setFailed("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, net.key, rows.map((r) => r.curve).join(",")]);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (r: Row) => {
    const k = `${r.token}:${r.spender}`;
    setSent((s) => ({ ...s, [k]: "confirm" }));
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error("wallet");
      const hash = await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: r.token, abi: erc20Abi, functionName: "approve", args: [r.spender, 0n] });
      setSent((s) => ({ ...s, [k]: { hash } }));
      setTimeout(() => void load(), 6_000);
      setTimeout(() => void load(), 15_000);
    } catch (e) {
      setSent((s) => ({ ...s, [k]: { failed: txErrorText(t, e, { fallback: t("approvals.notRevoked") }) } }));
    }
  };

  if (!tokens.length) return null;
  return (
    <Panel>
      <SectionHead
        title={
          <>
            {t("approvals.title")} <Info text={t("approvals.info")} />
          </>
        }
        aside={t("approvals.aside")}
      />
      {failed && (
        <p role="status" className="mb-3 rounded-xl border border-[#f0a060]/50 bg-[rgba(240,160,96,.06)] px-3.5 py-2.5 text-[13px] leading-[1.6] text-ink-2">
          {failed === "all" ? t("approvals.readFailed") : t("approvals.readPartial")}{" "}
          <button type="button" onClick={() => void load()} className="text-brand hover:underline">
            {t("portfolio.tryAgain")}
          </button>
        </p>
      )}
      {list === null ? (
        <p className="text-[13px] text-muted">
          <Spinner size={14} label={t("portfolio.reading")} /> {t("portfolio.reading")}
        </p>
      ) : list.length === 0 ? (
        failed ? null : <p className="text-[13px] leading-[1.7] text-muted">{t("approvals.none")}</p>
      ) : (
        <ul className="grid gap-3 min-[720px]:grid-cols-2">
          {list.map((r) => {
            const k = `${r.token}:${r.spender}`;
            const st = sent[k];
            const unlimited = r.amount >= UNLIMITED;
            return (
              <li key={k} className="rounded-xl border border-stroke bg-glass-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <b className="text-[15px] text-ink">{r.symbol}</b>
                  <span className={`mono-label rounded-full border px-2 py-0.5 text-[10px] tracking-[.1em] ${unlimited ? "border-neg/60 text-neg" : "border-stroke text-ink-2"}`}>
                    {unlimited ? t("approvals.unlimited") : `${fmtNum(Number(formatUnits(r.amount, r.decimals)), 4)} ${r.symbol}`}
                  </span>
                </div>
                <div className="mt-1.5 text-[12.5px] text-ink-2">
                  {r.spenderName} · <span className="tnum font-mono text-[11.5px] text-ink-3">{shortAddr(r.spender)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-ink-3">{t("approvals.noExpiry")}</span>
                  {st && typeof st === "object" && "hash" in st ? (
                    <a href={explorer.tx(st.hash)} target="_blank" rel="noreferrer" className="text-[12px] text-pos hover:underline">
                      {t("approvals.sent")}
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled={st === "confirm"}
                      onClick={() => void revoke(r)}
                      className="mono-label rounded-[10px] border border-stroke-2 px-3 py-1.5 text-[10.5px] tracking-[.12em] text-ink-2 transition-colors hover:border-neg hover:text-neg disabled:opacity-60"
                    >
                      {st === "confirm" ? t("approvals.confirm") : t("approvals.revoke")}
                    </button>
                  )}
                </div>
                {st && typeof st === "object" && "failed" in st && (
                  <p role="status" className="mt-2 text-[12px] text-neg">
                    {st.failed}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
