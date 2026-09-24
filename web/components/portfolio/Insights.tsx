"use client";

// INSIGHTS · FACTS ABOUT YOUR MIX, AS IT STANDS (baskvia's Insights). Six cards shown, the rest
// behind "+N more". Each is a full sentence with an (i) on how it is measured; none is a score.
//   dust · the two largest · worst / best week · same-direction days · independent bets ·
//   quote assets spanned · graduated share
// The three that need price history use the 30D grid the chart draws.
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { Info } from "@/components/ui/Info";
import { Panel, SectionHead } from "@/components/ui/primitives";
import { independentBets, sameDirectionDays, worstBestWeek } from "@/lib/insightsMath";
import type { HistoryView } from "@/lib/portfolioHistory";
import type { Holding } from "@/lib/usePortfolio";

interface Card {
  key: string;
  title: string;
  value: string;
  body: string;
  info: string;
  bar?: { share: number; color: string }[];
}

const SHOWN = 6;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const pctText = (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`;

export function Insights({ bookHoldings, allHoldings, bookTotal, sym, m, color, h30 }: { bookHoldings: Holding[]; allHoldings: Holding[]; bookTotal: number; sym: string; m: (v: number, d?: number) => string; color: (s: string) => string; h30?: HistoryView }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const pos = bookHoldings.slice().sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const shareOf = (h: Holding) => (bookTotal > 0 ? (h.value ?? 0) / bookTotal : 0);
  const cards: Card[] = [];

  const dust = pos.filter((h) => shareOf(h) < 0.01);
  if (dust.length && dust.length < pos.length) {
    const total = dust.reduce((n, h) => n + (h.value ?? 0), 0);
    cards.push({ key: "dust", title: t("pf.dustTitle"), value: `${m(total, 2)} ${sym}`, body: t("pf.dustBody", { total: `${m(total, 2)} ${sym}`, n: dust.length }), info: t("pf.infoDust") });
  }
  if (pos.length >= 3) {
    const [a, b] = pos;
    const both = shareOf(a) + shareOf(b);
    cards.push({
      key: "top2",
      title: `$${a.row.symbol} + $${b.row.symbol}`,
      value: pctText(both),
      body: t("pf.topTwoBody", { pct: pctText(both), a: a.row.symbol, pa: pctText(shareOf(a)), b: b.row.symbol, pb: pctText(shareOf(b)), n: pos.length }),
      info: t("pf.infoTopTwo"),
      bar: [
        { share: shareOf(a), color: color(a.row.symbol) },
        { share: shareOf(b), color: color(b.row.symbol) },
      ],
    });
  }
  if (h30) {
    const wb = worstBestWeek(h30.values);
    if (wb) cards.push({ key: "weeks", title: t("pf.weeksTitle"), value: signed(wb.worst), body: t("pf.weeksBody", { worst: signed(wb.worst), best: signed(wb.best) }), info: t("pf.infoWeeks") });
    const px = (token: string) => h30.assets.find((a) => a.token === token && a.covered)?.prices;
    const [a, b] = pos;
    const pa = a && px(a.row.token);
    const pb = b && px(b.row.token);
    if (a && b && pa && pb) {
      const d = sameDirectionDays(pa, pb);
      if (d.days > 0) cards.push({ key: "together", title: `$${a.row.symbol} + $${b.row.symbol}`, value: t("pf.daysOf", { same: d.same, days: d.days }), body: t("pf.togetherBody", { a: a.row.symbol, b: b.row.symbol, same: d.same, days: d.days }), info: t("pf.infoTogether") });
    }
    const bets = independentBets(pos.map((h) => ({ weight: h.value ?? 0, prices: px(h.row.token) ?? [] })).filter((i) => i.prices.length));
    if (bets != null && pos.length >= 2) cards.push({ key: "bets", title: t("pf.betsTitle"), value: `≈${bets.toFixed(1)}`, body: t("pf.betsBody", { n: pos.length, bets: bets.toFixed(1) }), info: t("pf.infoBets") });
  }
  const quotes = [...new Set(allHoldings.map((h) => h.row.quoteSymbol))];
  if (quotes.length) cards.push({ key: "quotes", title: t("pf.quotesTitle"), value: String(quotes.length), body: quotes.length === 1 ? t("pf.quotesBodyOne", { list: quotes[0] }) : t("pf.quotesBody", { n: quotes.length, list: quotes.join(" · ") }), info: t("pf.infoQuotes") });
  const graduated = allHoldings.filter((h) => h.row.graduated).length;
  if (graduated > 0) cards.push({ key: "graduated", title: t("pf.gradTitle"), value: `${graduated}/${allHoldings.length}`, body: t("pf.gradBody", { n: graduated, all: allHoldings.length }), info: t("pf.infoGrad") });

  if (!cards.length) return null;
  const shown = all ? cards : cards.slice(0, SHOWN);
  return (
    <section aria-label={t("pf.insights")}>
      <SectionHead title={t("pf.insights")} aside={<span className="mono-label text-[10.5px] tracking-[.12em] text-ink-3">{t("pf.insightsSub")}</span>} />
      <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2 nav:grid-cols-3">
        {shown.map((c) => (
          <Panel key={c.key} className="!p-4">
            <div className="mono-label flex items-center gap-2 text-[10.5px] tracking-[.12em] text-ink-3">
              {c.title} <Info text={c.info} />
            </div>
            <div className="tnum mt-2 text-[26px] font-medium text-ink">{c.value}</div>
            {c.bar && (
              <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-glass-2" aria-hidden="true">
                {c.bar.map((s, i) => (
                  <span key={i} style={{ width: `${s.share * 100}%`, background: s.color }} />
                ))}
              </div>
            )}
            <p className="mt-2 text-[12.5px] leading-[1.65] text-muted">{c.body}</p>
          </Panel>
        ))}
      </div>
      {cards.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mono-label mt-3 rounded-full border border-stroke px-3 py-1.5 text-[10.5px] tracking-[.12em] text-ink-3 hover:text-ink">
          {all ? t("pf.fewerFacts") : t("pf.moreFacts", { n: cards.length - SHOWN })}
        </button>
      )}
    </section>
  );
}
