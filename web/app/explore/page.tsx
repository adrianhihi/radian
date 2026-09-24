"use client";

// Explore, on baskvia's /explore skeleton:
//   head: EXPLORE + "How this works" · creators / tokens / graduated
//   hero: the claim + launch entry · the most-backed token's card
//   showcase carousel
//   tabs: Top / Tokens / Creators / Graduating soon
//     Top: sort chips + quote filter · quick search + quick buy · card grid (curve / graph)
//     Tokens: same chips · search on the tab row · cards or list
//     Creators: launches / 24h volume · ranking
//     Graduating: tokens ordered by bonding progress
import { Command, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Empty, Footer, HeroLink, OutlineButton } from "@/components/ui/primitives";
import { RichText } from "@/components/ui/RichText";
import { useNetwork } from "@/lib/networks";
import { useLaunches } from "@/lib/useLaunches";
import { useCountUp } from "@/lib/ui/useCountUp";
import type { TKey } from "@/lib/i18n";
import type { LaunchRow } from "@/lib/radian";
import { DEFAULT_EXPLORE_CONTROLS, EXPLORE_SORTS, creatorRows, filterSortLaunches, globalStats, mostBackedToken, quoteOptions, sortHasData, type ExploreControls, type ExploreSort } from "@/lib/explore";
import { TokenCard, type CardView } from "@/components/explore/TokenCards";
import { Showcase, ViewToggle } from "@/components/explore/Showcase";
import { HowItWorksButton } from "@/components/explore/HowItWorks";
import { CreatorBoard } from "@/components/explore/CreatorBoard";
import { TokenList } from "@/components/explore/TokenList";
import { QuickBuy } from "@/components/explore/QuickBuy";

type Tab = "top" | "tokens" | "creators" | "graduating";
type CreatorSort = "launches" | "volume";

const SORT_LABEL: Record<ExploreSort, TKey> = {
  top: "explore.sortTop",
  change: "explore.sortChange",
  value: "explore.sortValue",
  newest: "explore.sortNewest",
  progress: "explore.sortProgress",
};

export default function ExplorePage() {
  const t = useT();
  const net = useNetwork();
  const { rows, loading, error } = useLaunches();

  const [tab, setTab] = useState<Tab>("top");
  const [controls, setControls] = useState<ExploreControls>(DEFAULT_EXPLORE_CONTROLS);
  const [topView, setTopView] = useState<CardView>("curve");
  const [listView, setListView] = useState<"slides" | "list">("slides");
  const [creatorSort, setCreatorSort] = useState<CreatorSort>("launches");
  const [buyToken, setBuyToken] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => globalStats(rows), [rows]);
  const ranked = useMemo(() => filterSortLaunches(rows, {}), [rows]);
  const list = useMemo(() => filterSortLaunches(rows, controls), [rows, controls]);
  const graduating = useMemo(() => filterSortLaunches(rows, { ...controls, sort: "progress" }).filter((r) => !r.graduated && r.progress > 0), [rows, controls]);
  const backedToken = useMemo(() => mostBackedToken(rows), [rows]);
  const creators = useMemo(() => {
    const q = controls.q.trim().toLowerCase();
    const src = q ? filterSortLaunches(rows, { q }) : rows;
    return creatorRows(src, creatorSort);
  }, [rows, controls.q, creatorSort]);
  const featured = rows.find((r) => r.token === backedToken) ?? ranked[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setQ = (q: string) => setControls((c) => ({ ...c, q }));
  const reset = () => setControls(DEFAULT_EXPLORE_CONTROLS);
  const noData = !sortHasData(rows, controls.sort);

  return (
    <Shell>
      <div className="screen-in">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[clamp(38px,5vw,56px)] font-bold uppercase leading-none tracking-[-1px] text-ink">{t("explore.title")}</h1>
            <div className="mt-3">
              <HowItWorksButton />
            </div>
          </div>
          <GlobalStats creators={stats.creators} tokens={stats.tokens} graduated={stats.graduated} />
        </div>

        <div className="mt-10 grid grid-cols-1 items-center gap-8 nav:grid-cols-2 nav:gap-12">
          <div className="min-w-0">
            <h2 className="text-[clamp(32px,4.4vw,50px)] font-[650] leading-[1.12] tracking-[-1px] text-ink">
              <RichText text={t("explore.heroTitle")} />
            </h2>
            <p className="my-4 max-w-[46ch] text-[15px] leading-[1.7] text-muted">{t("explore.heroBody")}</p>
            <HeroLink href="/create">{t("explore.createCta")}</HeroLink>
          </div>
          {featured && <TokenCard row={featured} badge={featured.token === backedToken} />}
        </div>

        {ranked.length > 0 && (
          <div className="mt-10">
            <Showcase rows={ranked.slice(0, 6)} />
          </div>
        )}

        <section className="mt-10">
          <div className="flex flex-wrap items-center gap-3 border-y border-stroke py-2.5">
            <div role="tablist" aria-label={t("explore.modeAria")} className="flex flex-wrap gap-1">
              {(
                [
                  ["top", "explore.tabTop"],
                  ["tokens", "explore.tabTokens"],
                  ["creators", "explore.tabCreators"],
                  ["graduating", "explore.tabGraduating"],
                ] as [Tab, TKey][]
              ).map(([v, k]) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`mono-label rounded-lg px-4 py-2.5 text-[13px] tracking-[.1em] transition-colors ${tab === v ? "bg-glass-2 text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                  {t(k)}
                </button>
              ))}
            </div>
            {tab !== "top" && <SearchBox ref={searchRef} value={controls.q} onChange={setQ} className="ml-auto w-full nav:w-[300px]" />}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {tab === "creators" ? (
              (["launches", "volume"] as CreatorSort[]).map((s) => (
                <Chip key={s} on={creatorSort === s} onClick={() => setCreatorSort(s)}>
                  {t(s === "launches" ? "explore.creatorSortLaunches" : "explore.creatorSortVolume")}
                </Chip>
              ))
            ) : (
              <>
                {tab !== "graduating" &&
                  EXPLORE_SORTS.map((s) => (
                    <Chip key={s} on={controls.sort === s} onClick={() => setControls((c) => ({ ...c, sort: s }))}>
                      {t(SORT_LABEL[s])}
                    </Chip>
                  ))}
                <QuoteSelect rows={rows} value={controls.quote} onChange={(quote) => setControls((c) => ({ ...c, quote }))} />
              </>
            )}
            <span className="ml-auto">
              {tab === "top" && (
                <ViewToggle
                  value={topView}
                  onChange={setTopView}
                  options={[
                    ["curve", t("explore.vCurve")],
                    ["graph", t("explore.vGraph")],
                  ]}
                  label={t("explore.viewAria")}
                />
              )}
              {tab === "tokens" && (
                <ViewToggle
                  value={listView}
                  onChange={setListView}
                  options={[
                    ["slides", t("explore.vSlides")],
                    ["list", t("explore.vList")],
                  ]}
                  label={t("explore.viewAria")}
                />
              )}
            </span>
          </div>

          {tab === "top" && rows.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-6 nav:grid-cols-2">
              <div>
                <h3 className="mono-label mb-3 text-[12px] tracking-[.16em] text-ink">
                  <Search size={13} strokeWidth={1.8} aria-hidden="true" className="mr-1 inline align-[-2px] text-brand" /> {t("explore.quickSearch")}
                </h3>
                <SearchBox ref={searchRef} value={controls.q} onChange={setQ} large />
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="mono-label text-[12px] tracking-[.16em] text-ink">
                    <span className="text-brand">ϟ</span> {t("explore.quickBuy")}
                  </h3>
                  {buyToken && (
                    <Link href={`/token/${buyToken}`} className="mono-label text-[10.5px] tracking-[.12em] text-ink-3 hover:text-brand">
                      {t("explore.tokenPage")}
                    </Link>
                  )}
                </div>
                <QuickBuy rows={ranked} token={buyToken} onToken={setBuyToken} />
              </div>
            </div>
          )}

          <div className="mt-6">
            {loading && rows.length === 0 ? (
              <Empty>{t("explore.loading")}</Empty>
            ) : error && rows.length === 0 ? (
              <Empty>{t("explore.error", { msg: error })}</Empty>
            ) : tab === "creators" ? (
              creators.length ? (
                <CreatorBoard rows={creators} />
              ) : (
                <Empty>{t("explore.noCreators")}</Empty>
              )
            ) : tab === "graduating" ? (
              graduating.length ? (
                <CardGrid rows={graduating} view="curve" backedToken={backedToken} />
              ) : (
                <Empty>{t("explore.emptyGraduating")}</Empty>
              )
            ) : (
              <>
                {noData && list.length > 0 && (
                  <p role="status" className="mb-4 rounded-xl border border-stroke bg-glass-2 px-4 py-3 text-[13px] leading-[1.7] text-muted">
                    {t(controls.sort === "change" ? "explore.noChange" : "explore.noNewest")}
                  </p>
                )}
                {list.length ? (
                  tab === "tokens" && listView === "list" ? (
                    <TokenList rows={list} />
                  ) : (
                    <CardGrid rows={list} view={tab === "top" ? topView : "curve"} backedToken={backedToken} />
                  )
                ) : !rows.length ? (
                  <Empty>
                    {t("explore.emptyLive", { chain: net.chainName })}
                    <br />
                    <Link href="/create" className="mt-3 inline-block text-brand hover:underline">
                      {t("explore.emptyCta")}
                    </Link>
                  </Empty>
                ) : (
                  <Empty>
                    {t("explore.noMatch")}
                    <br />
                    <OutlineButton className="mt-3" onClick={reset}>
                      {t("explore.resetFilter")}
                    </OutlineButton>
                  </Empty>
                )}
              </>
            )}
          </div>

          {rows.length > 0 && <p className="mt-6 text-xs leading-[1.8] text-muted">{t("explore.rankNote")}</p>}
        </section>

        <Footer />
      </div>
    </Shell>
  );
}

function CardGrid({ rows, view, backedToken }: { rows: LaunchRow[]; view: CardView; backedToken?: string }) {
  const t = useT();
  return (
    <section className="grid grid-cols-1 gap-5 nav:grid-cols-2" aria-label={t("explore.feedAria")}>
      {rows.map((r, i) => (
        <div key={r.token} className={`flex ${i < 12 ? "card-in" : ""}`} style={i < 12 ? { animationDelay: `${i * 45}ms` } : undefined}>
          <TokenCard row={r} view={view} badge={r.token === backedToken} />
        </div>
      ))}
    </section>
  );
}

function GlobalStats({ creators, tokens, graduated }: { creators: number; tokens: number; graduated: number }) {
  const t = useT();
  const cUp = useCountUp(creators);
  const tUp = useCountUp(tokens);
  const gUp = useCountUp(graduated);
  const cell = "px-5 text-right first:pl-0 last:pr-0 [&+&]:border-l [&+&]:border-stroke";
  return (
    <div className="flex items-start">
      {(
        [
          [String(Math.round(cUp)), t("gstats.creators"), false],
          [String(Math.round(tUp)), t("gstats.tokens"), false],
          [String(Math.round(gUp)), t("gstats.graduated"), true],
        ] as [string, string, boolean][]
      ).map(([v, label, accent]) => (
        <div key={label} className={cell}>
          <b className={`tnum block text-[clamp(26px,3.2vw,36px)] font-medium leading-[1.15] ${accent ? "text-brand" : "text-ink"}`}>{v}</b>
          <span className="mono-label text-[10px] uppercase tracking-[.14em] text-muted">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`mono-label rounded-full border px-3.5 py-1.5 text-[10.5px] uppercase tracking-[.12em] transition-colors ${on ? "border-stroke-2 bg-glass-2 text-ink" : "border-stroke text-ink-3 hover:text-ink-2"}`}>
      {children}
    </button>
  );
}

function QuoteSelect({ rows, value, onChange }: { rows: LaunchRow[]; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const options = quoteOptions(rows);
  return (
    <span className="relative">
      <select
        aria-label={t("explore.quoteAria")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mono-label appearance-none rounded-full border py-1.5 pl-3.5 pr-7 text-[10.5px] tracking-[.08em] focus-visible:border-brand ${value === "all" ? "border-stroke bg-transparent text-ink-3" : "border-stroke-2 bg-glass-2 text-ink"}`}
      >
        <option value="all">{t("explore.quoteAll")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            #{o.symbol} ({o.n})
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </span>
    </span>
  );
}

function SearchBox({ ref, value, onChange, large = false, className = "" }: { ref: React.Ref<HTMLInputElement>; value: string; onChange: (v: string) => void; large?: boolean; className?: string }) {
  const t = useT();
  return (
    <label className={`flex items-center gap-2.5 rounded-xl border border-stroke-2 bg-glass-2 px-3.5 text-muted focus-within:border-brand ${large ? "py-3.5" : "py-2"} ${className}`}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input ref={ref} type="search" autoComplete="off" placeholder={t("explore.searchPh")} aria-label={t("explore.searchAria")} value={value} onChange={(e) => onChange(e.target.value)} className={`w-full min-w-0 border-0 bg-transparent text-ink outline-none ${large ? "text-[15px]" : "text-[13px]"}`} />
      <kbd className="mono-label inline-flex flex-none items-center gap-0.5 rounded border border-stroke px-1.5 py-0.5 text-[9.5px] text-ink-3">
        <Command size={10} strokeWidth={1.8} aria-hidden="true" />K
      </kbd>
    </label>
  );
}
