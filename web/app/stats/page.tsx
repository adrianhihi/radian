"use client";

// Stats: protocol numbers over 24h or all time from the indexer, with the
// on-chain launch list as the fallback. Four headline cells, the volume bars,
// buy / sell / average, the ranked tokens, and the buyback vault.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { DataTable, TD, TD_NUM } from "@/components/ui/DataTable";
import { CondCell, CondGrid, Empty, Footer, PageHead, Panel, SectionHead } from "@/components/ui/primitives";
import { NotLive } from "@/components/TrustBanners";
import { useNetwork } from "@/lib/networks";
import { useStats } from "@/lib/useStats";
import { useCountUp } from "@/lib/ui/useCountUp";
import { fmtNum } from "@/lib/ui/format";
import { hasIndexer, fetchStats, type ProtocolStats } from "@/lib/indexer";

function Big({ value, digits = 0, prefix = "" }: { value: number; digits?: number; prefix?: string }) {
  const v = useCountUp(value);
  return (
    <>
      {prefix}
      {fmtNum(v, digits)}
    </>
  );
}

function VolumeBars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1e-9);
  return (
    <div className="mt-3 flex h-[90px] items-end gap-[3px]" aria-hidden="true">
      {data.map((v, i) => (
        <div key={i} title={`${v.toFixed(3)}`} className={`min-h-[2px] flex-1 rounded-[3px] transition-[height] duration-500 ${v > 0 ? "grad-fill" : "bg-glass-2"}`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export default function StatsPage() {
  const t = useT();
  const net = useNetwork();
  const chain = useStats();
  const [win, setWin] = useState<"24h" | "all">("all");
  const [s, setS] = useState<ProtocolStats | null>(null);

  useEffect(() => {
    if (!hasIndexer()) return;
    const load = () => fetchStats(win).then(setS).catch(() => {});
    load();
    const iv = setInterval(load, 12000);
    return () => clearInterval(iv);
  }, [win]);

  const launches = s?.launches ?? chain.launches;
  const graduated = s?.graduated ?? chain.graduated;
  const buyback = s?.buybackLocked ?? chain.buybackLocked;
  // what sits in the live curves, per quote asset (a stock-priced curve is not dollars)
  const inCurves = Object.entries(
    chain.rows.filter((r) => !r.graduated).reduce<Record<string, number>>((m, r) => {
      m[r.quoteSymbol] = (m[r.quoteSymbol] ?? 0) + Number(r.trackedQuote) / 10 ** r.quoteDecimals;
      return m;
    }, {}),
  );
  const winLabel = win === "24h" ? t("stats.win24") : t("stats.winAll");

  return (
    <Shell>
      <div className="screen-in">
        <PageHead
          eyebrow={t("stats.eyebrow")}
          title={t("stats.title")}
          sub={t("stats.sub", { chain: net.chainName })}
          aside={
            hasIndexer() ? (
              <span role="group" aria-label={t("stats.winAria")} className="inline-flex flex-none gap-0.5 rounded-[9px] border border-stroke bg-glass-2 p-[3px]">
                {(["24h", "all"] as const).map((w) => (
                  <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)} className={`rounded-md px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${win === w ? "bg-glass-hi text-ink" : "text-muted hover:text-ink"}`}>
                    {w === "24h" ? t("stats.win24") : t("stats.winAll")}
                  </button>
                ))}
              </span>
            ) : undefined
          }
        />
        <NotLive />
        {net.live && (
          <div className="grid gap-5">
            <CondGrid className="mt-0">
              <CondCell label={t("stats.launched")} value={<Big value={launches} />} />
              <CondCell label={t("stats.graduated")} value={<Big value={graduated} />} />
              <CondCell label={`${t("stats.volume")} · ${winLabel}`} value={<Big value={s?.volume ?? 0} digits={2} prefix="$" />} />
              <CondCell label={t("stats.creatorRewards")} value={<Big value={s?.creatorRewards ?? 0} digits={3} prefix="$" />} />
            </CondGrid>

            {hasIndexer() && s && (
              <>
                <Panel>
                  <SectionHead title={t("stats.volume24")} aside={t("stats.tradesIn", { n: s.trades, win: winLabel })} />
                  <VolumeBars data={s.hourlyVolume} />
                  <CondGrid>
                    <CondCell label={t("stats.buyVolume", { n: s.buyTrades })} value={<span className="text-pos">${fmtNum(s.buyVolume, 2)}</span>} />
                    <CondCell label={t("stats.sellVolume", { n: s.sellTrades })} value={<span className="text-neg">${fmtNum(s.sellVolume, 2)}</span>} />
                    <CondCell label={t("stats.avgTrade")} value={`$${fmtNum(s.avgTrade, 3)}`} />
                  </CondGrid>
                </Panel>

                <Panel>
                  <SectionHead title={t("stats.ranked")} aside={t("stats.rankedSub", { win: winLabel })} />
                  {s.ranked.length === 0 ? (
                    <Empty>{t("stats.noTrades")}</Empty>
                  ) : (
                    <DataTable head={["#", t("live.colToken"), t("stats.colVolume"), t("stats.colBuys"), t("stats.colSells")]} align={["left", "left", "right", "right", "right"]}>
                      {s.ranked.map((r, i) => (
                        <tr key={r.token}>
                          <td className={`${TD} text-ink-3`}>{i + 1}</td>
                          <td className={TD}>
                            <Link href={`/token/${r.token}`} className="flex items-center gap-2.5 hover:text-brand">
                              <AssetLogo symbol={r.symbol || "?"} size={24} radius={12} />
                              <span className="min-w-0">
                                <b className="block truncate text-[13.5px] text-ink">{r.name || "—"}</b>
                                <span className="mono-label text-[10.5px] text-ink-3">${r.symbol}</span>
                              </span>
                            </Link>
                          </td>
                          <td className={TD_NUM}>${fmtNum(r.volume, 2)}</td>
                          <td className={`${TD_NUM} text-pos`}>{r.buys}</td>
                          <td className={`${TD_NUM} text-neg`}>{r.sells}</td>
                        </tr>
                      ))}
                    </DataTable>
                  )}
                </Panel>
              </>
            )}

            <Panel>
              <SectionHead title={t("stats.buybackTitle")} aside={t("stats.buybackSub")} />
              <CondGrid>
                <CondCell label={t("stats.lockedTokens")} value={<Big value={buyback} />} />
                <CondCell label={t("stats.inCurves")} value={inCurves.length ? inCurves.map(([sym, v]) => `${fmtNum(v, 2)} ${sym}`).join(" · ") : "0"} small />
              </CondGrid>
            </Panel>
          </div>
        )}
        <Footer />
      </div>
    </Shell>
  );
}
