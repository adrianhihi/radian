"use client";

// The Pack as a picture (baskvia's holdings tiles, placed by weightLayout so every tile stays
// readable): one TokenTile per Pack coin, its area ∝ the quote spent burning that coin so far
// (equal until the first burn), the coin's launch logo or pixel mark, the symbol chip and the
// share; the coin next in rotation ringed with a NEXT chip; paused coins dimmed. Above it the
// one-line brief — coins, rotation, floor, last burn — and who is next; below it the legend.
// The same tiles, smaller and unlabelled, are the explore page's Pack card.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useT } from "@/components/LangProvider";
import { TokenTile } from "@/components/ui/TokenTile";
import type { TKey, TVars } from "@/lib/i18n";
import type { PackBurnFacts } from "@/lib/indexer";
import type { PoundPack, PoundView } from "@/lib/pound";
import { fmtNum, shortAddr } from "@/lib/ui/format";
import { assetColors } from "@/lib/ui/tokens";
import { panelHeight, weightLayout } from "@/lib/ui/weightLayout";

export type PackRow = PoundPack & PackBurnFacts;
type T = (key: TKey, vars?: TVars) => string;

/** 7 d / 24 h / 30 min, from seconds. */
export function fmtDuration(seconds: number, t: T): string {
  if (seconds >= 86400) return t("pound.durD", { n: Math.round(seconds / 86400) });
  if (seconds >= 3600) return t("pound.durH", { n: Math.round(seconds / 3600) });
  return t("pound.durMin", { n: Math.max(1, Math.round(seconds / 60)) });
}

/** `now` is unix seconds; 0 (the first client frame, before the clock effect runs) reads the wall clock. */
const clock = (now: number) => now || Math.floor(Date.now() / 1000);

/** never / 12 min ago / 3 h ago / 2 d ago, from unix seconds. */
export function agoText(unix: number, now: number, t: T): string {
  if (!unix) return t("pound.never");
  const s = Math.max(0, clock(now) - unix);
  return s < 3600 ? t("pound.minAgo", { n: Math.floor(s / 60) }) : s < 86400 ? t("pound.hAgo", { n: Math.floor(s / 3600) }) : t("pound.dAgo", { n: Math.floor(s / 86400) });
}

/** "allowed now" or "allowed in 3 h": the burner's minInterval measured from its last burn. */
export function nextAllowedText(view: PoundView, now: number, t: T): string {
  const wait = Math.max(0, view.burner.lastBurnAt + view.burner.minInterval - clock(now));
  return wait > 0 ? t("pound.allowedIn", { when: fmtDuration(wait, t) }) : t("pound.allowedNow");
}

/** One identity colour per coin, distinct within the Pack (keyed like `colorKey`). */
export const colorKey = (p: PackRow) => p.symbol ?? p.token;
export const packColors = (packs: PackRow[]) => assetColors(packs.map(colorKey));

/** The quote spent burning a coin so far, in the pack's asset units. */
const burnedValue = (p: PackRow): number => Number(formatUnits(BigInt(p.burnedQuote ?? "0"), p.assetDecimals ?? 18));
const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

/** Measured width of a box (ResizeObserver), from a guess so the first frame already draws. */
function useWidth(initial: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setW(Math.round(el.getBoundingClientRect().width) || initial);
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [initial]);
  return [ref, w] as const;
}

export function PackTiles({ packs, nextPack, explorer, mini = false, height, className = "" }: { packs: PackRow[]; nextPack: number | null; explorer: string; /** the explore card: smaller tiles, symbol only, no links */ mini?: boolean; height?: number; className?: string }) {
  const t = useT();
  const [ref, w] = useWidth(mini ? 300 : 880);
  const colors = useMemo(() => packColors(packs), [packs]);
  const h = height ?? (mini ? 84 : packs.length <= 4 ? 200 : panelHeight(w));
  const { layout, values, total } = useMemo(() => {
    const values = packs.map(burnedValue);
    const total = values.reduce((n, v) => n + v, 0);
    const weights = total > 0 ? values.map((v) => (v / total) * 100) : packs.map(() => 100 / Math.max(1, packs.length));
    return { layout: weightLayout(weights, w, h, mini ? 56 : 84, mini ? 28 : 60), values, total };
  }, [packs, w, h, mini]);
  const radius = mini ? 8 : 12;
  const gap = mini ? 2 : 3;
  const chip = "mono-label absolute bottom-1.5 left-1.5 rounded-[5px] px-1.5 text-[9px] font-bold leading-[16px] tracking-[.12em] shadow-[0_1px_3px_rgba(0,0,0,.4)]";
  return (
    <div ref={ref} className={`relative w-full ${className}`} style={{ height: h }}>
      {layout.map((r) => {
        const p = packs[r.index];
        const sym = p.symbol ?? shortAddr(p.token);
        const share = total > 0 ? values[r.index] / total : 0;
        const isNext = nextPack === p.index;
        const ours = !!(p.name || p.logo);
        const logoSrc = p.logo && /^https?:\/\//.test(p.logo) ? p.logo : null;
        const label = t("pound.tileAria", { sym, pct: total > 0 ? pctText(share) : "0%", n: p.burnCount ?? 0 });
        const cls = `absolute block transition-opacity hover:brightness-110 ${p.active ? "" : "opacity-35"} ${isNext ? "ring-2 ring-brand ring-offset-2 ring-offset-night" : ""}`;
        const style = { left: r.x + gap, top: r.y + gap, width: r.w - gap * 2, height: r.h - gap * 2, borderRadius: radius };
        const body = (
          <>
            <TokenTile symbol={sym} color={colors[colorKey(p)]} label={mini ? sym : `$${sym}`} pct={mini || total === 0 ? undefined : pctText(share)} logo={mini ? 0 : r.h >= 72 && r.w >= 100 ? 22 : 0} logoSrc={logoSrc} seed={p.token} className="h-full w-full" style={{ borderRadius: radius }} />
            {!mini && isNext && <span className={`${chip} bg-brand text-white`}>{t("pound.nextChip")}</span>}
            {!mini && !p.active && <span className={`${chip} bg-night/85 text-ink-2`}>{t("pound.pausedChip")}</span>}
          </>
        );
        if (mini)
          return (
            <span key={p.index} className={cls} style={style} title={label} aria-label={label} role="img">
              {body}
            </span>
          );
        return ours ? (
          <Link key={p.index} href={`/token/${p.token}`} className={cls} style={style} title={label} aria-label={label}>
            {body}
          </Link>
        ) : (
          <a key={p.index} href={`${explorer}/address/${p.token}`} target="_blank" rel="noreferrer" className={cls} style={style} title={label} aria-label={label}>
            {body}
          </a>
        );
      })}
    </div>
  );
}

/** The brief, the picture and the legend (the parent draws the empty and unread states). */
export function PackBasket({ view, now, explorer }: { view: PoundView; now: number; explorer: string }) {
  const t = useT();
  const packs = view.packs as PackRow[];
  const active = packs.filter((p) => p.active);
  const next = view.burner.nextPack != null ? packs.find((p) => p.index === view.burner.nextPack) : undefined;
  const floorOf = (p: PackRow) => `${fmtNum(Number(formatUnits(BigInt(p.floor), p.assetDecimals ?? 18)), 4)} ${p.assetSymbol ?? ""}`.trim();
  const floorPack = next ?? active[0] ?? packs[0];
  return (
    <div>
      <p className="mono-label text-[10.5px] leading-[1.8] tracking-[.14em] text-ink-2">
        {t("pound.packHeadline", { n: active.length, interval: fmtDuration(view.burner.minInterval, t), floor: floorPack ? floorOf(floorPack) : "—", ago: agoText(view.burner.lastBurnAt, now, t) })}
      </p>
      {next && (
        <p className="mt-1 text-[13px] text-ink">
          <span className="mr-1.5 inline-block size-2 rounded-full bg-brand align-middle" aria-hidden="true" />
          {t("pound.nextBurnLine", { sym: next.symbol ?? shortAddr(next.token), when: nextAllowedText(view, now, t) })}
        </p>
      )}
      {packs.length > 0 && <PackTiles packs={packs} nextPack={view.burner.nextPack} explorer={explorer} className="mt-3" />}
      <p className="mono-label mt-2 text-[10px] leading-[1.7] tracking-[.1em] text-ink-3">{t("pound.legend")}</p>
    </div>
  );
}
