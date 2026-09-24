"use client";

// Where the book's value sits along the curve (the slot baskvia's risk curve takes): a scale
// from a fresh curve to a graduated pool, by bonding progress, which is read from the chain.
// Not a risk score: only that a curve early in its bonding has less behind it than a pool.
// Collapsed: "x% still early on the curve · value" and the band bar; open: each holding's logo
// over its band, with its share underneath.
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Info } from "@/components/ui/Info";
import type { Holding } from "@/lib/usePortfolio";

type Band = "early" | "mid" | "late" | "graduated";
const BANDS: Band[] = ["early", "mid", "late", "graduated"];
const COLOR: Record<Band, string> = { early: "var(--neg)", mid: "var(--brand-2)", late: "var(--brand)", graduated: "var(--signal)" };
const bandOf = (h: Holding): Band => (h.row.graduated ? "graduated" : h.row.progress < 0.25 ? "early" : h.row.progress < 0.75 ? "mid" : "late");
const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

export function CurveStage({ holdings, allHoldings, total, sym, m }: { holdings: Holding[]; allHoldings: Holding[]; total: number; sym: string; m: (v: number, d?: number) => string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label: Record<Band, string> = { early: t("pf.bandEarly"), mid: t("pf.bandMid"), late: t("pf.bandLate"), graduated: t("tcard.graduated") };
  const bands = BANDS.map((k) => {
    const members = holdings.filter((h) => bandOf(h) === k);
    const value = members.reduce((n, h) => n + (h.value ?? 0), 0);
    return { k, members, value, share: total > 0 ? value / total : 0 };
  }).filter((b) => b.members.length > 0);
  const early = bands.find((b) => b.k === "early");
  const unpriced = allHoldings.filter((h) => h.value == null);
  if (!holdings.length) return null;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="mono-label flex items-center gap-2 text-[10.5px] tracking-[.14em] text-ink-3">
          {t("pf.curveStage")} <Info text={t("pf.infoCurveStage")} />
        </span>
        <span className="flex items-center gap-2 text-[13px] text-muted">
          <b className="tnum text-[22px] font-semibold text-ink">{pctText(early?.share ?? 0)}</b>
          {t("pf.earlyEnd", { v: `${m(early?.value ?? 0, 2)} ${sym}` })}
          <button type="button" aria-expanded={open} aria-label={t("pf.stageExpand")} onClick={() => setOpen((o) => !o)} className="grid size-7 place-items-center rounded-full border border-stroke-2 text-ink-3 hover:text-ink">
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </span>
      </div>
      {open && (
        <div className="relative mt-3 h-12">
          {bands.flatMap((b, bi) => {
            const left = bands.slice(0, bi).reduce((n, x) => n + x.share, 0);
            return b.members.map((h, j) => (
              <span key={h.row.token} className="absolute -translate-x-1/2 text-center" style={{ left: `${(left + (b.share * (j + 0.5)) / b.members.length) * 100}%` }}>
                <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={26} radius={13} />
                <span className="tnum mono-label block text-[9px] text-ink-3">{pctText(total > 0 ? (h.value ?? 0) / total : 0)}</span>
              </span>
            ));
          })}
        </div>
      )}
      <div className={`mt-3 flex overflow-hidden rounded-full ${open ? "h-7" : "h-2"}`} aria-hidden={!open}>
        {bands.map((b) => (
          <span key={b.k} className="mono-label flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] tracking-[.08em] text-night" style={{ width: `${b.share * 100}%`, background: COLOR[b.k] }}>
            {open ? `${m(b.value, 2)} ${label[b.k]}` : ""}
          </span>
        ))}
      </div>
      <div className="mono-label mt-1.5 flex justify-between text-[9.5px] tracking-[.14em] text-ink-3">
        <span>{t("pf.freshCurve")}</span>
        {open && <span>{t("pf.byProgress")}</span>}
        <span>{t("pf.inPool")}</span>
      </div>
      {open && unpriced.length > 0 && <p className="mono-label mt-2 text-[10px] tracking-[.08em] text-ink-3">{t("pf.notPlaced", { list: unpriced.map((h) => `$${h.row.symbol}`).join(" · ") })}</p>}
    </div>
  );
}
