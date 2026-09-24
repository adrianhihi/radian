"use client";

// The creators page's three explainer blocks, on baskvia's /creators:
//   ALREADY HERE · THE CREATORS USING IT — creator cards from the launch list (→ /profile)
//   HOW YOU EARN — the simulator: daily volume · fee mode · creator tax → your fees per day / month
//   STRAIGHT ANSWERS — eight question cards
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import type { FeeMode } from "@/lib/draft";
import { creatorRows } from "@/lib/explore";
import { ROLE_COLOR, feeSplit, type SplitRole } from "@/lib/feeSplit";
import type { TKey } from "@/lib/i18n";
import type { LaunchRow } from "@/lib/radian";
import { shortAddr } from "@/lib/ui/format";

function Scroller({ children, label }: { children: React.ReactNode; label: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const go = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <button type="button" aria-label={t("cr.prevPage")} onClick={() => go(-1)} className="grid size-9 place-items-center rounded-full border border-stroke-2 text-ink-3 hover:text-ink">
          <ChevronLeft size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" aria-label={t("cr.nextPage")} onClick={() => go(1)} className="grid size-9 place-items-center rounded-full border border-stroke-2 text-ink-3 hover:text-ink">
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <div ref={ref} role="list" aria-label={label} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
        {children}
      </div>
    </div>
  );
}

export function CreatorsUsing({ rows, chain }: { rows: LaunchRow[]; chain: string }) {
  const t = useT();
  const creators = creatorRows(rows);
  return (
    <section id="creators-using" aria-labelledby="cr-using" className="mt-24 scroll-mt-24">
      <p className="mono-label text-center text-[10.5px] tracking-[.2em] text-ink-3">{t("cr.alreadyHere")}</p>
      <h2 id="cr-using" className="mt-2 text-center text-[clamp(28px,4vw,44px)] font-bold uppercase tracking-[-1px] text-ink">
        {t("cr.usingIt")}
      </h2>
      <div className="mt-8">
        {creators.length ? (
          <Scroller label={t("cr.usingIt")}>
            {creators.map((r) => {
              const p = r.top.graduated ? 100 : Math.round(r.top.progress * 100);
              return (
                <Link role="listitem" key={r.addr} href={`/profile/${r.addr}`} className="glass-panel w-[300px] flex-none snap-start overflow-hidden rounded-2xl text-center transition-colors hover:border-brand/50">
                  <div className="h-20 bg-[image:var(--grad-soft)]" />
                  <div className="-mt-8 flex justify-center">
                    <span className="rounded-full border-4 border-night">
                      <AddressAvatar address={r.addr} size={56} />
                    </span>
                  </div>
                  <div className="px-4 pb-5 pt-2">
                    <b className="tnum block text-[15px] text-ink">{shortAddr(r.addr)}</b>
                    <p className="mt-1 line-clamp-2 text-[12px] text-muted">{r.top.name}</p>
                    <p className="mono-label mt-2 text-[10px] tracking-[.12em] text-ink-3">{t(r.launches.length === 1 ? "cr.creatorStatOne" : "cr.creatorStat", { n: r.launches.length, sym: r.top.symbol, p })}</p>
                  </div>
                </Link>
              );
            })}
          </Scroller>
        ) : (
          <p className="text-center text-[14px] text-muted">{t("cr.noCreators", { chain })}</p>
        )}
      </div>
      <p className="mt-5 text-center">
        <Link href="/explore" className="mono-label inline-flex items-center gap-1.5 text-[10.5px] tracking-[.16em] text-ink-3 hover:text-brand">
          {t("cr.leaderboard")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}

const ROLE_LABEL: Record<SplitRole, TKey> = {
  you: "create.roleYou",
  buyback: "create.roleBuyback",
  treasury: "create.roleTreasury",
  vault: "create.roleVault",
  pound: "create.rolePound",
  protocol: "create.roleProtocol",
};

export function EarnSimulator({ protocolShareBps, pound, maxTaxPct = 10 }: { protocolShareBps: number | null; pound: boolean; maxTaxPct?: number }) {
  const t = useT();
  const [mode, setMode] = useState<FeeMode>("creator");
  const [volume, setVolume] = useState(50_000);
  const [tax, setTax] = useState(0);
  const FEE = 1; // percent of every trade on the curve
  const rows = feeSplit("standard", mode, protocolShareBps, pound);
  const you = rows.find((r) => r.role === "you")?.pct ?? 0;
  const perDay = (pctOfFee: number) => (volume * (FEE / 100) * pctOfFee) / 100;
  const yours = perDay(you) + (mode === "creator" ? volume * (tax / 100) : 0);
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1000 ? 2 : 0 })}`;

  return (
    <section aria-labelledby="cr-earn" className="mt-24">
      <p className="mono-label text-[10.5px] tracking-[.2em] text-ink-3">{t("cr.howEarn")}</p>
      <h2 id="cr-earn" className="mt-2 text-[clamp(28px,4vw,44px)] font-bold uppercase tracking-[-1px] text-ink">
        {t("cr.keepShare")}
      </h2>
      <p className="mt-3 max-w-[60ch] text-[15px] leading-[1.7] text-muted">{t("cr.keepShareBody")}</p>

      <div className="glass-panel mt-6 rounded-2xl p-5 nav:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[18px] font-bold uppercase text-ink">{t("cr.simulate")}</h3>
          <span className="flex gap-2" role="group" aria-label={t("cr.modeAria")}>
            {(["creator", "buyback"] as FeeMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition-colors ${mode === m ? "border-brand bg-glass-2 text-brand" : "border-stroke text-ink-3 hover:text-ink"}`}>
                {t(m === "creator" ? "create.fmCreator" : "create.fmBuyback")}
              </button>
            ))}
          </span>
        </div>

        <div className="mt-6 grid gap-6 min-[720px]:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="sim-vol" className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">
                {t("cr.dailyVolume")}
              </label>
              <span className="tnum text-[24px] font-semibold text-ink">{usd(volume)}</span>
            </div>
            <input id="sim-vol" type="range" min={1000} max={1_000_000} step={1000} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand)]" />
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="sim-tax" className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">
                {t("cr.creatorTax")}
              </label>
              <span className="tnum text-[24px] font-semibold text-ink">{tax}%</span>
            </div>
            <input id="sim-tax" type="range" min={0} max={maxTaxPct} step={0.5} value={tax} disabled={mode !== "creator"} onChange={(e) => setTax(Number(e.target.value))} className="mt-2 w-full accent-[var(--brand)] disabled:opacity-40" />
            <p className="mono-label mt-1 text-[10px] tracking-[.08em] text-ink-3">{t("cr.taxNote", { max: maxTaxPct })}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 min-[720px]:grid-cols-2">
          <div className="rounded-2xl border border-brand/40 bg-[image:var(--grad-soft)] p-5">
            <div className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">{t("cr.yourFeesDay")}</div>
            <div className="tnum mt-2 text-[40px] font-bold text-brand" aria-live="polite">
              {usd(yours)}
            </div>
            <div className="mono-label mt-1 text-[10.5px] text-ink-3">{t("cr.perMonth", { v: usd(yours * 30) })}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {rows
              .filter((r) => r.role !== "you")
              .map((r) => (
                <div key={r.role} className="rounded-xl border border-stroke p-3">
                  <div className="mono-label flex items-center gap-1.5 text-[9.5px] tracking-[.12em] text-ink-3">
                    <span className="size-1.5 rounded-full" style={{ background: ROLE_COLOR[r.role] }} />
                    {t(ROLE_LABEL[r.role])}
                  </div>
                  <div className="tnum mt-1 text-[15px] text-ink-2">{t("cr.perDay", { v: usd(perDay(r.pct)) })}</div>
                </div>
              ))}
          </div>
        </div>
        <p className="mt-5 text-[11.5px] leading-[1.7] text-ink-3">{t("cr.simNote", { fee: FEE, p: (protocolShareBps ?? 5000) / 100 })}</p>
      </div>
    </section>
  );
}

const FAQ: { tag: TKey; q: TKey; a: TKey; color: string }[] = [
  { tag: "cr.faq1Tag", q: "cr.faq1Q", a: "cr.faq1A", color: "var(--brand-3)" },
  { tag: "cr.faq2Tag", q: "cr.faq2Q", a: "cr.faq2A", color: "var(--brand)" },
  { tag: "cr.faq3Tag", q: "cr.faq3Q", a: "cr.faq3A", color: "var(--brand-2)" },
  { tag: "cr.faq4Tag", q: "cr.faq4Q", a: "cr.faq4A", color: "var(--signal)" },
  { tag: "cr.faq5Tag", q: "cr.faq5Q", a: "cr.faq5A", color: "var(--brand-2)" },
  { tag: "cr.faq6Tag", q: "cr.faq6Q", a: "cr.faq6A", color: "var(--pos)" },
  { tag: "cr.faq7Tag", q: "cr.faq7Q", a: "cr.faq7A", color: "var(--signal)" },
  { tag: "cr.faq8Tag", q: "cr.faq8Q", a: "cr.faq8A", color: "var(--brand-3)" },
];

export function Faq() {
  const t = useT();
  return (
    <section aria-labelledby="cr-faq" className="mt-24">
      <p className="mono-label text-[10.5px] tracking-[.2em] text-ink-3">{t("cr.straight")}</p>
      <h2 id="cr-faq" className="mt-2 text-[clamp(28px,4vw,44px)] font-bold uppercase tracking-[-1px] text-ink">
        {t("cr.questions")}
      </h2>
      <p className="mt-3 text-[15px] text-muted">
        {t("cr.questionsBody")}{" "}
        <Link href="/docs" className="text-brand hover:underline">
          {t("nav.learn")} →
        </Link>
      </p>
      <div className="mt-6">
        <Scroller label={t("cr.questions")}>
          {FAQ.map((f, i) => (
            <article role="listitem" key={f.q} className="glass-panel w-[340px] flex-none snap-start rounded-2xl p-6" style={{ borderTop: `3px solid ${f.color}` }}>
              <div className="flex items-center justify-between">
                <span className="mono-label rounded-full border px-3 py-1 text-[10px] tracking-[.14em]" style={{ borderColor: `color-mix(in srgb, ${f.color} 55%, transparent)`, color: f.color }}>
                  {t(f.tag)}
                </span>
                <span className="mono-label tnum text-[11px] text-ink-3">
                  {String(i + 1).padStart(2, "0")} / {String(FAQ.length).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-[19px] font-semibold leading-[1.35] text-ink">{t(f.q)}</h3>
              <p className="mt-3 text-[13.5px] leading-[1.75] text-muted">{t(f.a)}</p>
            </article>
          ))}
        </Scroller>
      </div>
    </section>
  );
}
