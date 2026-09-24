"use client";

// Token page body, on baskvia's basket-detail body (one big card, sections
// divided by rules):
//
//   curve        — bonding progress: the bar, what is in the curve, the goal
//   chart + trade — left: change over the period, period tabs, the dither chart
//                   (the indexer's spark, or one built from the trade log);
//                   right: the same trade form as /swap, locked to this token
//   stats        — spot price · 24H · in curve · 24h volume; sellable supply · trades · launched
//   trades       — the recent trade log (indexer)
//   fees & contracts — collapsible: the fee frozen at launch and where it goes
//                   (per this launch's own policy: The Pound's waterfall, or an
//                   older recipient), the addresses with explorer links
//
// Nothing here is invented: the chart needs two trades, a missing stat is "—".
import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { DitherChart } from "@/components/ui/DitherChart";
import { SwapForm, type TradeToken } from "@/components/trade/SwapForm";
import { PERIODS, sparkValues, type Period } from "@/lib/explore";
import type { TokenTrade } from "@/lib/indexer";
import { poundVaultAbi } from "@/lib/pound";
import { explorer, hasPound, POUND, publicClient, RADIAN, type LaunchRow, type LaunchTemplate } from "@/lib/radian";
import { ago, fmtNum, fmtPrice, pct, shortAddr } from "@/lib/ui/format";
import { ZERO_ADDR, type TokenState } from "./types";

const pctOf = (bps: bigint) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 2)}%`;
const fmtQ = (v: bigint, dec: number, digits = 2) => fmtNum(Number(formatUnits(v, dec)), digits);

/** Price of a trade = quote in/out ÷ tokens (quote per token). */
const priceOf = (tr: TokenTrade): number => {
  const q = Number(formatUnits(BigInt(tr.quote), tr.quoteDecimals ?? 18));
  const tok = Number(formatUnits(BigInt(tr.tokens), 18));
  return tok > 0 ? q / tok : 0;
};

/** The spark: the indexer's per-launch series, else one built from this token's trade log (newest first). */
export function sparkOf(row: LaunchRow | undefined, trades: TokenTrade[]): [number, number][] {
  if (row?.spark?.length) return row.spark;
  return [...trades]
    .reverse()
    .map((tr) => [tr.ts, priceOf(tr)] as [number, number])
    .filter((p) => p[1] > 0);
}

/** 24h facts: the indexer's row when it has them, else derived from the trade log. */
export function statsOf(row: LaunchRow | undefined, trades: TokenTrade[]) {
  const since = Date.now() - 86_400_000;
  const recent = trades.filter((tr) => tr.ts >= since);
  const volume24h = row?.volume24h ?? recent.reduce((n, tr) => n + Number(formatUnits(BigInt(tr.quote), tr.quoteDecimals ?? 18)), 0);
  const trades24h = row?.trades24h ?? recent.length;
  let change24h: number | null | undefined = row?.change24h;
  if (change24h === undefined) {
    const pts = sparkValues(sparkOf(row, trades), "24H");
    change24h = pts.length >= 2 && pts[0] > 0 ? ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100 : null;
  }
  return { volume24h, trades24h, change24h, createdAt: row?.createdAt };
}

/** Bonding progress. */
export function CurveSection({ st }: { st: TokenState }) {
  const t = useT();
  const p = st.graduated ? 100 : st.graduationThreshold > 0n ? Math.min(100, Number((st.trackedQuote * 10000n) / st.graduationThreshold) / 100) : 0;
  return (
    <div className="border-b border-stroke px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="mono-label text-[10.5px] tracking-[.16em] text-ink-3">{t("detail.progress")}</span>
        <span className="tnum mono-label text-[12px] text-ink">{p.toFixed(1)}%</span>
      </div>
      <div role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={t("tcard.progressAria", { p: p.toFixed(1) })} className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-glass-2">
        <span className={`block h-full rounded-full ${st.graduated ? "bg-signal" : "grad-fill"}`} style={{ width: `${Math.max(2, p)}%` }} />
      </div>
      <div className="tnum mt-2 flex justify-between gap-2 text-[11px] text-muted">
        <span>{t("tcard.inCurve", { v: fmtQ(st.trackedQuote, st.quoteDecimals), sym: st.quoteSymbol })}</span>
        <span>{t("tcard.goal", { v: fmtQ(st.graduationThreshold, st.quoteDecimals, 0), sym: st.quoteSymbol })}</span>
      </div>
    </div>
  );
}

/** Chart (left) + trade form (right). */
export function ChartTrade({
  st,
  spark,
  tk,
  onTraded,
  onPending,
}: {
  st: TokenState;
  spark: [number, number][];
  tk: TradeToken;
  onTraded: () => void;
  onPending: (hash: Hex) => void;
}) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("7D");
  const series = sparkValues(spark, period);
  const change = series.length > 1 && series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : null;
  return (
    <div className="grid border-b border-stroke nav:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col p-5 nav:border-r nav:border-stroke">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={`tnum text-[24px] font-semibold ${change == null ? "text-ink-3" : change >= 0 ? "text-brand" : "text-neg"}`}>{change == null ? "—" : pct(change)}</span>{" "}
            <span className="mono-label text-[11px] text-ink-3">
              {t("detail.past")} {period}
            </span>
            <div className="mono-label text-[10px] text-ink-3">{t("detail.price")}</div>
          </div>
          <div role="tablist" aria-label={t("detail.periodAria")} className="flex gap-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={p === period}
                onClick={() => setPeriod(p)}
                className={`mono-label rounded-md px-2.5 py-1 text-[10.5px] ${p === period ? "bg-glass-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {series.length >= 2 ? (
          <DitherChart series={series} label={t("tcard.chartAria", { name: st.name })} orient="vertical" className="mt-4 min-h-[260px] w-full flex-1" />
        ) : (
          <div className="mt-4 grid min-h-[260px] flex-1 place-items-center rounded-[12px] border border-dashed border-stroke-2 text-[13px] text-ink-3">{t("detail.noChart")}</div>
        )}
      </div>
      <div className="p-5">
        <SwapForm tk={tk} onTraded={onTraded} onPending={onPending} />
        <Link href="/launch" className="mono-label mt-4 flex items-center justify-center gap-1.5 text-[10.5px] tracking-[.14em] text-ink-3 hover:text-brand">
          {t("detail.launchOwn")} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/** Stat cells and chips. */
export function StatsRow({ st, stats }: { st: TokenState; stats: ReturnType<typeof statsOf> }) {
  const t = useT();
  const price = st.tokenReserve > 0n ? Number(formatUnits(st.quoteReserve, st.quoteDecimals)) / Number(formatUnits(st.tokenReserve, 18)) : 0;
  const days = stats.createdAt ? Math.floor((Date.now() - stats.createdAt) / 86_400_000) : null;
  const cells: [string, string, string?][] = [
    [t("detail.stPrice"), `${fmtPrice(price)} ${st.quoteSymbol}`],
    [t("detail.st24"), stats.change24h == null ? "—" : pct(stats.change24h), stats.change24h == null ? "text-ink-3" : stats.change24h >= 0 ? "text-pos" : "text-neg"],
    [t("detail.stReserve"), `${fmtQ(st.trackedQuote, st.quoteDecimals)} ${st.quoteSymbol}`], // real quote in the curve (reserves also carry the virtual part)
    [t("detail.stVolume"), `${fmtNum(stats.volume24h, 2)} ${st.quoteSymbol}`],
  ];
  const chips: [string, string][] = [
    [t("detail.stSellable"), `${fmtQ(st.sellable, 18, 0)} ${st.symbol}`],
    [t("detail.stTrades", { n: stats.trades24h }), ""],
  ];
  if (days != null) chips.push([t("detail.stLaunched"), days < 1 ? t("detail.today") : t("detail.daysAgo", { n: days })]);
  return (
    <div className="border-b border-stroke p-5">
      <dl className="grid grid-cols-2 overflow-hidden rounded-[14px] border border-stroke nav:grid-cols-4">
        {cells.map(([k, v, cls]) => (
          <div key={k} className="min-w-0 border-stroke p-4 [&:not(:last-child)]:border-r max-nav:[&:nth-child(2n)]:border-r-0 max-nav:[&:nth-child(-n+2)]:border-b">
            <dt className="mono-label text-[9.5px] tracking-[.16em] text-ink-3">{k}</dt>
            <dd className={`tnum mt-1 truncate text-[22px] font-light ${cls ?? "text-ink"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map(([label, v]) => (
          <span key={label} className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke px-3 py-1.5 text-[10px] tracking-[.14em] text-ink-3">
            {label}
            {v && <b className="tnum rounded-full bg-glass-2 px-2 py-0.5 text-[11px] font-normal text-ink">{v}</b>}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The recent trade log. */
export function TradesSection({ trades, loaded, quoteSymbol }: { trades: TokenTrade[]; loaded: boolean; quoteSymbol: string }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(iv);
  }, []);
  return (
    <section aria-label={t("detail.trades")} className="border-b border-stroke p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold uppercase tracking-[.06em] text-ink">{t("detail.trades")}</h2>
        <span className="mono-label text-[10px] tracking-[.14em] text-ink-3">{t("detail.tradesN", { n: trades.length })}</span>
      </div>
      {trades.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-stroke-2 px-4 py-5 text-center text-[13px] text-ink-3">{loaded ? t("detail.noTrades") : t("detail.loadingTrades")}</p>
      ) : (
        <ul className="thin-scroll mt-3 max-h-[300px] divide-y divide-stroke overflow-y-auto">
          {trades.slice(0, 60).map((tr, i) => (
            <li key={tr.txHash + i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className={`mono-label w-10 rounded-md px-1.5 py-0.5 text-center text-[10px] uppercase tracking-[.08em] ${tr.side === "buy" ? "bg-[rgba(108,199,154,.14)] text-pos" : "bg-[rgba(240,102,90,.14)] text-neg"}`}>
                  {tr.side === "buy" ? t("trade.buy") : t("trade.sell")}
                </span>
                <AddressAvatar address={tr.trader} size={18} />
                <a href={explorer.tx(tr.txHash)} target="_blank" rel="noreferrer" className="tnum truncate font-mono text-[12px] text-ink-2 hover:text-brand">
                  {shortAddr(tr.trader)}
                </a>
              </span>
              <span className="flex flex-none items-center gap-3">
                <span className="tnum text-ink">
                  {fmtNum(Number(formatUnits(BigInt(tr.quote), tr.quoteDecimals ?? 18)), 3)} {tr.quoteSymbol ?? quoteSymbol}
                </span>
                <span className="tnum w-8 text-right text-[11px] text-ink-3">{ago(tr.ts, now)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Fees & contracts (collapsible). The waterfall is this launch's own: the vault's when its policy pays The Pound. */
export function FeesContracts({ token, st, template }: { token: Address; st: TokenState; template: LaunchTemplate | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [burnShareBps, setBurnShareBps] = useState(7000);
  const feedsPound = hasPound && !!POUND && st.protocolRecipient.toLowerCase() === POUND.vault.toLowerCase();

  useEffect(() => {
    if (!open || !feedsPound || !POUND) return;
    publicClient
      .readContract({ address: POUND.vault, abi: poundVaultAbi, functionName: "burnShareBps" })
      .then((v) => setBurnShareBps(Number(v)))
      .catch(() => {});
  }, [open, feedsPound]);

  const feePct = Number(st.feeBps) / 100;
  const protocol = Number(st.protocolShareBps) / 100; // % of the fee
  const creator = 100 - protocol;
  const REF = 5.55; // PoundVault.REFERRAL_BPS / LAUNCHER_BPS, constants
  const rows = useMemo(() => {
    const fmt = (n: number) => (n >= 10 ? n.toFixed(1) : Math.round(n * 100) / 100) + "%";
    if (!feedsPound) {
      return [
        [t("detail.rowCreator"), t("detail.rowCreatorSub"), fmt(creator)],
        [t("detail.rowProtocol"), t("detail.rowProtocolSub"), fmt(protocol)],
      ];
    }
    const afterRefs = Math.max(0, protocol - 2 * REF);
    const burn = (afterRefs * burnShareBps) / 10000;
    return [
      [t("detail.rowCreator"), t("detail.rowCreatorSub"), fmt(creator)],
      [t("detail.rowRef"), t("detail.rowRefSub"), fmt(REF)],
      [t("detail.rowLauncher"), t("detail.rowLauncherSub"), fmt(REF)],
      [t("detail.rowPack"), t("detail.rowPackSub", { p: burnShareBps / 100 }), `≈${fmt(burn)}`],
      [t("detail.rowTreasury"), t("detail.rowTreasurySub"), `≈${fmt(afterRefs - burn)}`],
    ];
  }, [t, feedsPound, creator, protocol, burnShareBps]);

  const contracts: [string, Address][] = [
    [t("detail.cToken"), token],
    [t("detail.cCurve"), st.curve],
  ];
  if (RADIAN.router !== ZERO_ADDR) contracts.push([t("detail.cRouter"), RADIAN.router]);
  if (feedsPound && POUND) contracts.push([t("detail.cVault"), POUND.vault], [t("detail.cBurner"), POUND.burner]);
  if (template?.kind === "wall") {
    contracts.push([t("detail.cTreasury"), template.treasury], [t("detail.cStaking"), template.staking]);
    if (template.ladder) contracts.push([t("detail.cLadder"), template.ladder]);
  }
  if (template?.kind === "pof") contracts.push([t("detail.cPofVault"), template.vault], [t("detail.cPofRouter"), template.pofRouter]);

  return (
    <section className="p-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <span className="mono-label text-[10.5px] tracking-[.16em] text-ink-2">{t("detail.feesContracts")}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-3">{t("detail.feesSub", { fee: feePct })}</span>
        <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={`text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid gap-4 px-5 pb-5 nav:grid-cols-2">
          <div className="rounded-[14px] border border-stroke p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="mono-label text-[10px] tracking-[.16em] text-ink-3">{t("detail.fees")}</span>
              <span className="mono-label rounded-full border border-stroke px-2 py-0.5 text-[9px] tracking-[.12em] text-ink-3">{t("detail.fixed")}</span>
            </div>
            <p className="mt-3">
              <span className="tnum text-[44px] font-light text-ink">{feePct}%</span> <span className="text-[12px] text-ink-3">{t("detail.onEvery")}</span>
            </p>
            {st.creatorTaxBps > 0n && <p className="mt-1 text-[12px] text-ink-3">{t("detail.creatorTaxNote", { v: Number(st.creatorTaxBps) / 100 })}</p>}
            <div className="mono-label mt-3 border-t border-stroke pt-3 text-[9.5px] tracking-[.16em] text-ink-3">{t("detail.whereGoes")}</div>
            <ul className="mt-1 divide-y divide-stroke">
              {rows.map(([h, sub, v]) => (
                <li key={h} className="flex items-start justify-between gap-3 py-2.5">
                  <span>
                    <span className="block text-[13px] text-ink">{h}</span>
                    <span className="text-[11px] text-ink-3">{sub}</span>
                  </span>
                  <span className="tnum flex-none text-[13px] text-ink">{v}</span>
                </li>
              ))}
            </ul>
            {feedsPound && <p className="mt-3 border-t border-stroke pt-3 text-[11px] leading-[1.6] text-ink-3">{t("detail.feeNote", { fee: feePct })}</p>}
          </div>
          <div className="rounded-[14px] border border-stroke p-5">
            <span className="mono-label text-[10px] tracking-[.16em] text-ink-3">{t("detail.contracts")}</span>
            <p className="mt-3 text-[13px] leading-[1.7] text-muted">{t("detail.contractBody")}</p>
            <ul className="mt-4 grid gap-1.5 border-t border-stroke pt-3">
              {contracts.map(([label, addr]) => (
                <li key={label} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-ink-2">{label}</span>
                  <a href={explorer.address(addr)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-brand hover:underline">
                    {shortAddr(addr)} <ExternalLink size={10} strokeWidth={1.8} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/verify" className="mono-label mt-4 inline-block text-[10.5px] tracking-[.12em] text-ink-2 hover:text-brand">
              {t("detail.verify")}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
