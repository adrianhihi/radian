"use client";

// Everything this wallet did here, from the indexer's scan (curve trades, launches,
// referral claims), with the transactions this browser sent merged in front until the
// index has them ("indexing…"). The line under the title says how far the index
// reaches, so an empty list is never mistaken for "nothing happened".
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useLang, useT } from "@/components/LangProvider";
import { Empty, Footer, OutlineLink, PageHead, Panel, PrimaryButton } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { NotLive } from "@/components/TrustBanners";
import { fetchWalletActivity, hasIndexer, type WalletEvent } from "@/lib/indexer";
import { useNetwork } from "@/lib/networks";
import { quoteByAddress } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useTxLog, type TxKind } from "@/lib/txLog";
import { useLaunches } from "@/lib/useLaunches";
import { fmtNum, shortAddr } from "@/lib/ui/format";

type Row = { key: string; kind: string; ts: number; token?: string; symbol?: string; amount?: string; hash?: string; pending?: boolean };

export default function ActivityPage() {
  const t = useT();
  const { lang } = useLang();
  const net = useNetwork();
  const { authenticated, login, address } = useRadianWallet();
  const { rows: launches } = useLaunches();
  const local = useTxLog(address);
  const [data, setData] = useState<{ indexed: boolean; through: string; events: WalletEvent[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!address || !hasIndexer()) {
      setData({ indexed: false, through: "0", events: [] });
      return;
    }
    let alive = true;
    setFailed(false);
    fetchWalletActivity(address)
      .then((d) => alive && setData(d))
      .catch(() => alive && (setFailed(true), setData({ indexed: false, through: "0", events: [] })));
    return () => {
      alive = false;
    };
    // a new local transaction re-syncs the index right away
  }, [address, local.length]);

  const sym = new Map(launches.map((r) => [r.token.toLowerCase(), r.symbol]));
  const KIND: Record<string, string> = {
    buy: t("tx.buy"), sell: t("tx.sell"), launch: t("tx.launch"), claim: t("tx.claim"), stake: t("tx.stake"), unstake: t("tx.unstake"),
    deposit: t("tx.deposit"), withdraw: t("tx.withdraw"), cancel: t("tx.cancel"), wallClaim: t("tx.wallClaim"), pofClaim: t("tx.pofClaim"), referralClaim: t("tx.referralClaim"),
  };
  const amountOf = (e: WalletEvent): string | undefined => {
    if (e.kind === "buy" && e.quote) return `${fmtNum(Number(formatUnits(BigInt(e.quote), e.quoteDecimals ?? 18)), 4)} ${e.quoteSymbol ?? ""}`;
    if (e.kind === "sell" && e.tokens) return `${fmtNum(Number(formatUnits(BigInt(e.tokens), 18)), 0)} ${e.symbol ?? ""}`;
    if (e.kind === "referralClaim" && e.amount) {
      const q = e.asset ? quoteByAddress(e.asset as `0x${string}`) : undefined;
      return `${fmtNum(Number(formatUnits(BigInt(e.amount), q?.decimals ?? 18)), 4)} ${q?.symbol ?? net.nativeSymbol ?? ""}`;
    }
    return undefined;
  };
  const indexed: Row[] = (data?.events ?? []).map((e) => ({ key: `${e.txHash ?? e.token}-${e.kind}-${e.ts}`, kind: e.kind, ts: e.ts, token: e.token, symbol: e.symbol || (e.token ? sym.get(e.token.toLowerCase()) : undefined), amount: amountOf(e), hash: e.txHash }));
  const seen = new Set(indexed.map((r) => r.hash?.toLowerCase()).filter(Boolean));
  const mine: Row[] = local
    .filter((r) => !seen.has(r.hash.toLowerCase()))
    .map((r) => ({ key: `local-${r.hash}`, kind: r.kind as TxKind, ts: r.time, token: r.token, symbol: r.token ? sym.get(r.token.toLowerCase()) : undefined, amount: r.amount, hash: r.hash, pending: !!data?.indexed }));
  const all = [...mine, ...indexed].sort((a, b) => b.ts - a.ts);
  const when = (ts: number) => new Date(ts).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <Shell>
      <div className="screen-in">
        <PageHead eyebrow={t("activity.eyebrow")} title={t("activity.title")} sub={t("activity.sub")} aside={<OutlineLink href="/portfolio">{t("activity.back")}</OutlineLink>} />
        <NotLive />
        {net.live &&
          (!authenticated || !address ? (
            <Panel>
              <div className="py-8 text-center">
                <p className="text-[14.5px] leading-[1.75] text-muted">{t("activity.signIn")}</p>
                <PrimaryButton type="button" onClick={login} className="mx-auto mt-5 max-w-[220px]">
                  {t("wallet.connect")}
                </PrimaryButton>
              </div>
            </Panel>
          ) : data === null ? (
            <p className="py-10 text-center">
              <Spinner size={20} label={t("portfolio.reading")} />
            </p>
          ) : (
            <Panel>
              <p className="mb-3 text-[12.5px] leading-[1.7] text-muted">
                {data.indexed ? t("activity.indexedThrough", { block: Number(data.through).toLocaleString("en-US") }) : failed ? t("activity.indexDown") : t("activity.noIndex")}
              </p>
              {all.length === 0 ? (
                <Empty>{t("activity.none")}</Empty>
              ) : (
                <ul className="divide-y divide-stroke rounded-xl border border-stroke">
                  {all.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                      <span className="w-32 flex-none font-semibold text-ink">{KIND[r.kind] ?? r.kind}</span>
                      <span className="min-w-0 flex-1 text-ink-2">
                        {r.token ? (
                          <Link href={`/token/${r.token}`} className="hover:text-brand">
                            {r.symbol ? `$${r.symbol}` : shortAddr(r.token)}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {r.amount && <span className="tnum ml-2 text-ink-3">{r.amount}</span>}
                        {r.pending && <span className="mono-label ml-2 rounded border border-stroke px-1.5 py-px text-[9.5px] tracking-[.1em] text-ink-3">{t("activity.indexing")}</span>}
                      </span>
                      <span className="tnum text-[12px] text-ink-3">{r.ts ? when(r.ts) : "—"}</span>
                      {r.hash && (
                        <a href={`${net.explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-brand hover:underline">
                          {t("trust.viewTx")} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ))}
        <Footer />
      </div>
    </Shell>
  );
}
