"use client";

// The action rail on the left (baskvia's ActionRail; the reference's sticky column), wide
// screens only. Collapsed: a TRADE pill, two icons and a vertical composition bar. On hover
// or keyboard focus it widens to 256 px:
//   TRADE →                          the swap console
//   LAUNCH · a token                  the wizard
//   CLAIMS · appear right here        scrolls to the claims panel
//   COMPOSITION · FACTS (i)           the book's largest positions, one row each
import { ChartPie, CirclePlus, Coins } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { Info } from "@/components/ui/Info";
import type { Holding } from "@/lib/usePortfolio";

export function ActionRail({ bookHoldings, bookTotal, color }: { bookHoldings: Holding[]; bookTotal: number; color: (sym: string) => string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rows = bookHoldings.slice(0, 4).map((h) => ({ sym: h.row.symbol, share: bookTotal > 0 ? (h.value ?? 0) / bookTotal : 0 }));
  const rest = bookHoldings.slice(4).reduce((n, h) => n + (bookTotal > 0 ? (h.value ?? 0) / bookTotal : 0), 0);
  if (rest > 0) rows.push({ sym: t("pf.others"), share: rest });
  const largest = bookHoldings[0];
  const item = "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-glass-2";
  const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;
  const toClaims = () => document.getElementById("claims")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <nav aria-label={t("pf.railAria")} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)} className="fixed left-5 top-[150px] z-30 hidden min-[1320px]:block">
      <div className={`glass-panel overflow-hidden rounded-[22px] border border-stroke-2 transition-[width] duration-200 ${open ? "w-[256px]" : "w-[64px]"}`}>
        <div className={`p-2 ${open ? "w-[256px]" : ""}`}>
          <button type="button" onClick={() => router.push("/swap")} className="grad-fill mono-label flex h-11 w-full items-center justify-center rounded-2xl text-[11px] font-semibold tracking-[.12em]">
            {open ? t("pf.railTrade") : t("pf.railTradeShort")}
          </button>
        </div>
        {open ? (
          <div className="w-[256px] px-2 pb-4">
            <button type="button" onClick={() => router.push("/create")} className={item}>
              <CirclePlus size={15} strokeWidth={1.8} aria-hidden="true" className="mt-0.5 flex-none text-ink-3" />
              <span>
                <span className="mono-label block text-[12px] font-semibold tracking-[.1em] text-ink">{t("pf.railLaunch")}</span>
                <span className="mono-label block text-[9.5px] tracking-[.12em] text-ink-3">{t("pf.railLaunchSub")}</span>
              </span>
            </button>
            <button type="button" onClick={toClaims} className={item}>
              <Coins size={15} strokeWidth={1.8} aria-hidden="true" className="mt-0.5 flex-none text-ink-3" />
              <span>
                <span className="mono-label block text-[12px] font-semibold tracking-[.1em] text-ink">{t("pf.railClaims")}</span>
                <span className="mono-label block text-[9.5px] tracking-[.12em] text-ink-3">{t("pf.railClaimsSub")}</span>
              </span>
            </button>
            <div className="mx-3 my-3 h-px bg-stroke" />
            <div className="px-3">
              <div className="mono-label flex items-center gap-2 text-[9.5px] tracking-[.14em] text-ink-3">
                {t("pf.compositionFacts")} <Info text={t("pf.infoComposition")} />
              </div>
              <div className="mt-3 grid gap-3">
                {rows.map((r) => (
                  <div key={r.sym}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="mono-label inline-flex items-center gap-2 tracking-[.1em] text-ink-2">
                        <span className="size-1.5 rounded-full" style={{ background: color(r.sym) }} />${r.sym}
                      </span>
                      <span className="tnum text-[14px] font-medium text-ink">{pctText(r.share)}</span>
                    </div>
                    <div className="mt-1.5 h-1 rounded-full bg-glass-2">
                      <div className="h-full rounded-full" style={{ width: `${r.share * 100}%`, background: color(r.sym) }} />
                    </div>
                  </div>
                ))}
              </div>
              {largest && (
                <p className="mono-label mt-4 text-[10px] tracking-[.12em] text-ink-3">
                  {t("pf.largest")}: <span className="text-ink">${largest.row.symbol}</span> · {pctText(bookTotal > 0 ? (largest.value ?? 0) / bookTotal : 0)}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 pb-4 pt-1 text-ink-3">
            <CirclePlus size={16} strokeWidth={1.8} aria-hidden="true" />
            <Coins size={16} strokeWidth={1.8} aria-hidden="true" />
            <ChartPie size={16} strokeWidth={1.8} aria-hidden="true" className="mt-2" />
            <div className="flex h-36 w-1.5 flex-col gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
              {rows.map((r) => (
                <span key={r.sym} className="w-full rounded-full" style={{ height: `${r.share * 100}%`, background: color(r.sym) }} />
              ))}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
