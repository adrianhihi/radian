"use client";

// "YOUR POSITIONS" (baskvia's Positions): title with the book's total · share (PNG, percentages
// only) and download (CSV) tools · a Trade pill · the curve-stage bar · SHOW AS list / picture ·
// SPOTLIGHT (dims what does not match, never filters) · per-quote subtotals · the list grouped by
// quote asset with a proportion line per group, or the picture (a readable treemap of the book
// with a hover card) · legend by status · small positions folded · a Trade CTA.
import { ArrowLeftRight, Download, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { DitherChart } from "@/components/ui/DitherChart";
import { Info } from "@/components/ui/Info";
import { Panel } from "@/components/ui/primitives";
import type { HistoryView } from "@/lib/portfolioHistory";
import type { Holding } from "@/lib/usePortfolio";
import { MASK } from "@/lib/ui/hideAmounts";
import { fmtNum, fmtPrice, pct } from "@/lib/ui/format";
import { panelHeight, weightLayout } from "@/lib/ui/weightLayout";
import { shareMixImage } from "@/lib/shareImage";
import { CurveStage } from "./CurveStage";

export const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
const SMALL_SHARE = 0.01;

type Spot = string; // a quote symbol, or "curve" / "graduated"
type Props = {
  holdings: Holding[]; // every priced holding, all books
  allHoldings: Holding[]; // incl. unpriced, for counts
  book: string;
  bookTotal: number;
  totals: [string, number][];
  hidden: boolean;
  m: (v: number, d?: number) => string;
  color: (sym: string) => string;
  h24?: HistoryView;
  onToast: (s: string) => void;
};

export function Positions({ holdings, allHoldings, book, bookTotal, totals, hidden, m, color, h24, onToast }: Props) {
  const t = useT();
  const [view, setView] = useState<"list" | "picture">("list");
  const [spots, setSpots] = useState<Set<Spot>>(new Set());
  const [showSmall, setShowSmall] = useState(false);
  const totalOf = new Map(totals);
  const shareOf = (h: Holding) => {
    const tot = totalOf.get(h.row.quoteSymbol) ?? 0;
    return tot > 0 ? (h.value ?? 0) / tot : 0;
  };
  const big = holdings.filter((h) => shareOf(h) >= SMALL_SHARE);
  const small = holdings.filter((h) => shareOf(h) < SMALL_SHARE);
  const fold = big.length > 0 && small.length > 0 && !showSmall; // never fold when everything is small
  const shown = fold ? big : holdings;
  const smallTotal = small.filter((h) => h.row.quoteSymbol === book).reduce((n, h) => n + (h.value ?? 0), 0);
  const quotes = totals.map(([sym]) => sym);
  const spotOptions: { s: Spot; label: string }[] = [
    ...(quotes.length > 1 ? quotes.map((q) => ({ s: q, label: q })) : []),
    { s: "curve", label: t("tcard.live") },
    ...(allHoldings.some((h) => h.row.graduated) ? [{ s: "graduated", label: t("tcard.graduated") }] : []),
  ];
  const matches = (h: Holding) => !spots.size || [...spots].some((s) => (s === "curve" ? !h.row.graduated : s === "graduated" ? h.row.graduated : h.row.quoteSymbol === s));
  const toggleSpot = (s: Spot) =>
    setSpots((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const bookHoldings = holdings.filter((h) => h.row.quoteSymbol === book);
  const share = async () => {
    const r = await shareMixImage(
      bookHoldings.map((h) => ({ symbol: h.row.symbol, share: shareOf(h), color: color(h.row.symbol) })),
      t("portfolio.shareTitle"),
    );
    onToast(r === "shared" ? t("portfolio.shared") : r === "saved" ? t("portfolio.saved") : t("portfolio.shareFailed"));
  };
  const csv = () => {
    const lines = ["symbol,token,quote,balance,price,value,share_pct,status"];
    for (const h of allHoldings) lines.push([h.row.symbol, h.row.token, h.row.quoteSymbol, formatUnits(h.bal, 18), h.spot ?? "", h.value ?? "", h.value != null ? (shareOf(h) * 100).toFixed(2) : "", h.row.graduated ? "graduated" : "curve"].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radian-holdings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const tool = "grid size-9 place-items-center rounded-full border border-stroke-2 text-[13px] text-ink-2 transition-colors hover:border-brand hover:text-brand";
  const pill = (on: boolean) => `mono-label rounded-full border px-3 py-1.5 text-[10.5px] tracking-[.12em] transition-colors ${on ? "border-brand/60 bg-glass-2 text-ink" : "border-stroke text-ink-3 hover:text-ink-2"}`;
  const onCurve = allHoldings.filter((h) => !h.row.graduated).length;
  const graduated = allHoldings.length - onCurve;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[clamp(22px,3vw,30px)] font-bold uppercase tracking-[-.3px] text-ink">
          {t("portfolio.positions")} <span className="tnum font-medium text-ink-3">{m(bookTotal, 2)} {book}</span> <Info text={t("portfolio.infoPositions")} />
        </h2>
        <span className="ml-auto flex gap-2">
          <button type="button" className={tool} aria-label={t("portfolio.share")} title={t("portfolio.share")} onClick={() => void share()}>
            <Share2 size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" className={tool} aria-label={t("portfolio.csv")} title={t("portfolio.csv")} onClick={csv}>
            <Download size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <Link href="/swap" className="mono-label inline-flex items-center gap-1.5 rounded-full border border-brand/60 px-4 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2">
            <ArrowLeftRight size={13} strokeWidth={1.8} aria-hidden="true" /> {t("pf.trade")}
          </Link>
        </span>
      </div>

      <CurveStage holdings={bookHoldings} allHoldings={allHoldings.filter((h) => h.row.quoteSymbol === book)} total={bookTotal} sym={book} m={m} />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="mono-label text-[10px] tracking-[.14em] text-ink-3">{t("pf.showAs")}</span>
        <span role="tablist" aria-label={t("pf.showAs")} className="flex gap-1.5">
          {(["list", "picture"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={pill(view === v)}>
              {t(v === "list" ? "pf.list" : "pf.picture")}
            </button>
          ))}
        </span>
        {spotOptions.length > 1 && (
          <>
            <span className="mx-1 h-5 w-px bg-stroke" aria-hidden="true" />
            <span className="mono-label text-[10px] tracking-[.14em] text-ink-3">{t("pf.spotlight")}</span>
            {spotOptions.map((o) => (
              <button key={o.s} type="button" aria-pressed={spots.has(o.s)} onClick={() => toggleSpot(o.s)} className={pill(spots.has(o.s))}>
                {o.label}
              </button>
            ))}
          </>
        )}
        <span className="mono-label ml-auto flex flex-wrap gap-4 text-[10px] tracking-[.12em] text-ink-3">
          {totals.map(([sym, v]) => (
            <span key={sym}>
              {sym} <b className="tnum ml-1 text-[12px] font-medium text-ink">{m(v, 2)}</b>
            </span>
          ))}
        </span>
      </div>

      <div className="mt-4">
        {view === "list" ? (
          <PositionList positions={shown} totals={totals} order={quotes} matches={matches} color={color} hidden={hidden} m={m} shareOf={shareOf} />
        ) : (
          <Picture positions={shown.filter((h) => h.row.quoteSymbol === book)} matches={matches} color={color} m={m} shareOf={shareOf} h24={h24} sym={book} />
        )}
      </div>

      <div className="mono-label mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tracking-[.1em] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-brand" aria-hidden="true" />
          {t("tcard.live")} · {onCurve}
        </span>
        {graduated > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-signal" aria-hidden="true" />
            {t("tcard.graduated")} · {graduated}
          </span>
        )}
      </div>

      {small.length > 0 && big.length > 0 && (
        <div className="mono-label mt-4 flex items-center justify-between border-t border-stroke pt-3 text-[10.5px] tracking-[.1em] text-ink-3">
          <span className="flex items-center gap-2">
            {t("pf.small", { n: small.length, total: `${m(smallTotal, 2)} ${book}` })} <Info text={t("pf.infoSmall")} />
          </span>
          <button type="button" onClick={() => setShowSmall((v) => !v)} className="text-ink-2 hover:text-brand">
            {showSmall ? t("pf.hideSmall") : t("pf.showSmall")}
          </button>
        </div>
      )}

      <div className="mt-5 flex justify-center">
        <Link href="/swap" className="grad-fill mono-label inline-flex items-center gap-2 rounded-full px-6 py-3 text-[11.5px] font-semibold tracking-[.14em]">
          <ArrowLeftRight size={14} strokeWidth={1.8} aria-hidden="true" /> {t("pf.tradeCta")}
        </Link>
      </div>
    </Panel>
  );
}

function PositionList({ positions, totals, order, matches, color, hidden, m, shareOf }: { positions: Holding[]; totals: [string, number][]; order: string[]; matches: (h: Holding) => boolean; color: (s: string) => string; hidden: boolean; m: (v: number, d?: number) => string; shareOf: (h: Holding) => number }) {
  const t = useT();
  const totalOf = new Map(totals);
  const grand = totals.reduce((n, x) => n + x[1], 0);
  return (
    <div className="grid gap-5">
      {order.map((sym) => {
        const rows = positions.filter((h) => h.row.quoteSymbol === sym);
        if (!rows.length) return null;
        const sub = totalOf.get(sym) ?? 0;
        return (
          <section key={sym} aria-label={sym} className="min-w-0">
            <div className="mono-label flex items-center justify-between text-[10.5px] tracking-[.14em] text-ink-3">
              <span>{t("pf.pricedIn", { sym })}</span>
              <span className="tnum">
                {m(sub, 2)} {sym} · <b className="font-medium text-ink">{rows.length}</b>
              </span>
            </div>
            <div className="mb-2 mt-1.5 h-px bg-stroke">
              <div className="h-px bg-ink-3" style={{ width: `${order.length > 1 ? (grand > 0 ? (sub / grand) * 100 : 0) : 100}%` }} />
            </div>
            <ul className="divide-y divide-stroke rounded-xl border border-stroke">
              {rows.map((h) => (
                <li key={h.row.token} className={`flex items-center gap-3 px-3.5 py-3 transition-opacity ${matches(h) ? "" : "opacity-30"}`}>
                  <span className="size-2 flex-none rounded-full" style={{ background: color(h.row.symbol) }} aria-hidden="true" />
                  <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={28} radius={14} />
                  <span className="min-w-0 flex-1">
                    <Link href={`/token/${h.row.token}`} className="block truncate text-sm font-semibold text-ink hover:text-brand">
                      ${h.row.symbol}
                    </Link>
                    <span className="mono-label block truncate text-[10.5px] text-ink-3">
                      {h.row.name} · {h.row.graduated ? t("tcard.graduated") : t("tcard.live")}
                    </span>
                    <CopyAddress address={h.row.token} symbol={h.row.symbol} />
                  </span>
                  <span className="tnum hidden w-36 text-right text-[12.5px] text-muted nav:block">
                    {hidden ? MASK : fmtNum(Number(formatUnits(h.bal, 18)), 0)}
                    {h.spot != null && <span className="block text-[11px] text-ink-3">@ {fmtPrice(h.spot)}</span>}
                  </span>
                  <span className="tnum flex-none text-right text-sm text-ink nav:w-28">
                    {m(h.value ?? 0, 4)} {sym}
                    <span className="block text-[11px] text-muted nav:hidden">{pctText(shareOf(h))}</span>
                  </span>
                  <span className="tnum hidden w-14 text-right text-[12.5px] text-muted nav:block">{pctText(shareOf(h))}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Picture({ positions, matches, color, m, shareOf, h24, sym }: { positions: Holding[]; matches: (h: Holding) => boolean; color: (s: string) => string; m: (v: number, d?: number) => string; shareOf: (h: Holding) => number; h24?: HistoryView; sym: string }) {
  const t = useT();
  const [hover, setHover] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(880);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tiles = useMemo(() => positions.slice().sort((a, b) => (b.value ?? 0) - (a.value ?? 0)), [positions]);
  const h = panelHeight(w);
  const layout = weightLayout(
    tiles.map((x) => shareOf(x) * 100),
    w,
    h,
    120,
    86,
  );
  if (!tiles.length) return <p className="py-6 text-center text-[13px] text-ink-3">{t("pf.pictureEmpty", { sym })}</p>;
  return (
    <div ref={boxRef} className="relative w-full" style={{ height: h }}>
      {layout.map((r) => {
        const x = tiles[r.index];
        const on = matches(x);
        const px = h24?.assets.find((a) => a.token === x.row.token)?.prices;
        const ch = px && px.length > 1 && px[0] > 0 ? ((px[px.length - 1] - px[0]) / px[0]) * 100 : null;
        return (
          <Link
            key={x.row.token}
            href={`/token/${x.row.token}`}
            onMouseEnter={() => setHover(x.row.token)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(x.row.token)}
            onBlur={() => setHover(null)}
            aria-label={t("pf.assetChipAria", { sym: x.row.symbol })}
            className={`absolute overflow-hidden rounded-xl border border-white/15 p-2.5 text-left text-night transition-opacity hover:brightness-110 ${on ? "" : "opacity-30"}`}
            style={{ left: r.x + 2, top: r.y + 2, width: r.w - 4, height: r.h - 4, background: color(x.row.symbol) }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[12px] font-bold text-night">${x.row.symbol}</span>
              <span className="tnum text-[13px] font-semibold">{pctText(shareOf(x))}</span>
            </div>
            <span className="tnum absolute bottom-2 left-2.5 text-[15px] font-bold">{m(x.value ?? 0, 2)}</span>
            <span className="absolute bottom-2 right-2">
              <AssetLogo symbol={x.row.symbol} src={/^https?:\/\//.test(x.row.logo) ? x.row.logo : null} seed={x.row.token} size={26} radius={13} />
            </span>
            {hover === x.row.token && (
              <span role="tooltip" className="absolute left-1/2 top-1/2 z-20 w-[210px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-stroke-2 bg-night p-3 text-left text-ink shadow-[0_18px_44px_-18px_rgba(0,0,0,.8)]">
                <span className="flex items-center gap-2">
                  <AssetLogo symbol={x.row.symbol} src={/^https?:\/\//.test(x.row.logo) ? x.row.logo : null} seed={x.row.token} size={22} radius={11} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold">{x.row.name}</span>
                    <span className="mono-label block text-[9.5px] tracking-[.08em] text-ink-3">{t("pf.ofPortfolio", { pct: pctText(shareOf(x)) })}</span>
                  </span>
                </span>
                <span className="mt-2 flex items-baseline justify-between">
                  <span className="tnum text-[16px] font-semibold">{x.spot != null ? `${fmtPrice(x.spot)} ${sym}` : "—"}</span>
                  {ch != null && (
                    <span className={`tnum text-[12px] ${ch >= 0 ? "text-pos" : "text-neg"}`}>
                      {pct(ch)} <span className="text-ink-3">24h</span>
                    </span>
                  )}
                </span>
                {px && px.length > 1 && <DitherChart series={px} label={`${x.row.symbol} 24h`} className="mt-1.5 h-10 w-full" />}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
