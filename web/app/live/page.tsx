"use client";

// Live: every curve on this network and the trade tape, refreshing from the
// chain and the indexer. On baskvia's activity skeleton: a head, one table of
// the curves, one panel of the latest trades.
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { DataTable, LiveDot, TD, TD_NUM } from "@/components/ui/DataTable";
import { Empty, Footer, PageHead, Panel, SectionHead } from "@/components/ui/primitives";
import { NotLive } from "@/components/TrustBanners";
import { useNetwork } from "@/lib/networks";
import { useLaunches } from "@/lib/useLaunches";
import { hasIndexer, fetchActivity, type Activity } from "@/lib/indexer";
import { ago, fmtNum, fmtPrice, shortAddr } from "@/lib/ui/format";

export default function LivePage() {
  const t = useT();
  const net = useNetwork();
  const { rows, loading } = useLaunches();
  const [trades, setTrades] = useState<Activity[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasIndexer()) return;
    const load = () =>
      fetchActivity(60)
        .then((tr) => {
          setTrades(tr);
          setNow(Date.now());
        })
        .catch(() => {});
    load();
    const iv = setInterval(load, 8000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Shell>
      <div className="screen-in">
        <PageHead
          eyebrow={t("live.eyebrow")}
          title={
            <span className="inline-flex items-center gap-3">
              <LiveDot /> {t("live.title")}
            </span>
          }
          sub={t("live.sub", { chain: net.chainName })}
        />
        <NotLive />
        {net.live && (
          <div className="grid gap-5">
            <Panel>
              <SectionHead title={t("live.curves")} aside={t("live.curvesN", { n: rows.length })} />
              {loading && rows.length === 0 ? (
                <Empty>{t("live.connecting", { chain: net.chainName })}</Empty>
              ) : rows.length === 0 ? (
                <Empty>{t("explore.emptyLive", { chain: net.chainName })}</Empty>
              ) : (
                <DataTable head={[t("live.colToken"), t("live.colStatus"), t("live.colSpot"), t("live.colReserve"), t("live.colProgress")]} align={["left", "left", "right", "right", "right"]}>
                  {rows.map((r) => {
                    const reserve = Number(formatUnits(r.trackedQuote, r.quoteDecimals));
                    const p = r.graduated ? 100 : Math.round(r.progress * 100);
                    return (
                      <tr key={r.token}>
                        <td className={TD}>
                          <Link href={`/token/${r.token}`} className="flex items-center gap-2.5 hover:text-brand">
                            <AssetLogo symbol={r.symbol} src={/^https?:\/\//.test(r.logo) ? r.logo : null} size={26} radius={13} />
                            <span className="min-w-0">
                              <b className="block truncate text-[13.5px] text-ink">{r.name}</b>
                              <span className="mono-label text-[10.5px] text-ink-3">${r.symbol}</span>
                            </span>
                          </Link>
                        </td>
                        <td className={TD}>
                          <span className={`mono-label rounded-md border px-1.5 py-px text-[9.5px] tracking-[.12em] ${r.graduated ? "border-signal/60 text-signal" : "border-brand/60 text-brand"}`}>{r.graduated ? t("tcard.graduated") : t("tcard.live")}</span>
                        </td>
                        <td className={TD_NUM}>{r.lastPrice != null ? `${fmtPrice(r.lastPrice)} ${r.quoteSymbol}` : "—"}</td>
                        <td className={TD_NUM}>
                          {fmtNum(reserve, 2)} {r.quoteSymbol}
                        </td>
                        <td className={`${TD_NUM} ${r.graduated ? "text-signal" : "text-pos"}`}>{p}%</td>
                      </tr>
                    );
                  })}
                </DataTable>
              )}
            </Panel>

            {hasIndexer() && (
              <Panel>
                <SectionHead
                  title={
                    <span className="inline-flex items-center gap-2.5">
                      <LiveDot /> {t("live.tape")}
                    </span>
                  }
                  aside={t("live.tapeSub")}
                />
                {trades.length === 0 ? (
                  <Empty>{t("live.noTrades")}</Empty>
                ) : (
                  <ul className="divide-y divide-stroke">
                    {trades.map((tr, i) => (
                      <li key={tr.txHash + tr.side + i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className={`mono-label w-10 rounded-md px-1.5 py-0.5 text-center text-[10px] uppercase tracking-[.08em] ${tr.side === "buy" ? "bg-[rgba(108,199,154,.14)] text-pos" : "bg-[rgba(240,102,90,.14)] text-neg"}`}>{tr.side === "buy" ? t("trade.buy") : t("trade.sell")}</span>
                          <Link href={`/token/${tr.token}`} className="font-semibold text-ink hover:text-brand">
                            ${tr.symbol || "?"}
                          </Link>
                          <AddressAvatar address={tr.trader} size={16} />
                          <Link href={`/profile/${tr.trader}`} className="tnum truncate font-mono text-[12px] text-ink-3 hover:text-brand">
                            {shortAddr(tr.trader)}
                          </Link>
                        </span>
                        <span className="flex flex-none items-center gap-3">
                          <span className="tnum text-ink">
                            {fmtNum(Number(formatUnits(BigInt(tr.quote), tr.quoteDecimals ?? 18)), 3)} {tr.quoteSymbol ?? "USDC"}
                          </span>
                          <a href={`${net.explorer}/tx/${tr.txHash}`} target="_blank" rel="noreferrer" className="tnum w-8 text-right text-[11px] text-ink-3 hover:text-brand">
                            {ago(tr.ts, now)}
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            <p className="text-center text-[11.5px] text-ink-3">{hasIndexer() ? t("live.indexed", { chain: net.chainName }) : t("live.autoRefresh")}</p>
          </div>
        )}
        <Footer />
      </div>
    </Shell>
  );
}
