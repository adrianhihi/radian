"use client";

// A creator's page, on baskvia's /profile: centred avatar and address, three
// cards (the top token's chart · launches · graduated), buy into their
// launches, the per-token record, their token cards, and the way to launch
// your own. Every number is read from the launch list; nothing is invented.
import { Copy } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { DitherChart } from "@/components/ui/DitherChart";
import { Empty, Footer, HeroLink, Panel, SectionHead } from "@/components/ui/primitives";
import { TokenCard, PeriodChips } from "@/components/explore/TokenCards";
import { SwapForm, type TradeToken } from "@/components/trade/SwapForm";
import { CreatorTools } from "@/components/profile/CreatorTools";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import { useProfile } from "@/lib/profile";
import { PendingBar } from "@/components/TrustBanners";
import { filterSortLaunches, sparkValues, type Period } from "@/lib/explore";
import { useNetwork } from "@/lib/networks";
import { explorer, quoteByAddress, type LaunchRow } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { fmtNum, pct, shortAddr } from "@/lib/ui/format";

const ZERO = "0x0000000000000000000000000000000000000000";

const toTradeToken = (r: LaunchRow): TradeToken => ({
  token: r.token,
  curve: r.curve,
  pairToken: r.pairToken,
  native: quoteByAddress(r.pairToken)?.native ?? r.pairToken === ZERO,
  template: r.template,
  name: r.name,
  symbol: r.symbol,
  quoteSymbol: r.quoteSymbol,
  quoteDecimals: r.quoteDecimals,
  graduated: r.graduated,
});

export default function ProfilePage() {
  const t = useT();
  const net = useNetwork();
  const params = useParams();
  const { address: me } = useRadianWallet();
  const { rows, loading, refresh } = useLaunches();
  const [period, setPeriod] = useState<Period>("7D");
  const [buy, setBuy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);

  const raw = params?.addr;
  const addr = String(Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? ""));
  const valid = isAddress(addr, { strict: false });
  const isMe = !!me && me.toLowerCase() === addr.toLowerCase();
  const profile = useProfile(valid ? addr : null);

  const mine = useMemo(() => filterSortLaunches(rows, {}).filter((r) => r.deployer.toLowerCase() === addr.toLowerCase()), [rows, addr]);
  const graduated = mine.filter((r) => r.graduated).length;
  const top = mine[0];
  const series = top ? sparkValues(top.spark, period) : [];
  const change = series.length >= 2 && series[0] > 0 ? ((series[series.length - 1] - series[0]) / series[0]) * 100 : null;
  const candidates = mine.filter((r) => !r.graduated);
  const buyRow = rows.find((r) => r.token.toLowerCase() === (buy ?? "").toLowerCase()) ?? candidates[0];

  const onCopy = () => {
    navigator.clipboard?.writeText(addr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  if (!valid)
    return (
      <Shell>
        <div className="screen-in">
          <Empty>{t("profile.badAddr")}</Empty>
          <Footer />
        </div>
      </Shell>
    );

  return (
    <Shell>
      <div className="screen-in">
        <Link href="/explore" className="mono-label mb-6 inline-flex rounded-full border border-stroke px-3 py-1.5 text-[11px] tracking-[.08em] text-ink-2 hover:border-brand hover:text-brand">
          {t("profile.back")}
        </Link>

        <header className="flex flex-col items-center text-center">
          <AddressAvatar address={addr} size={96} />
          <div className="mono-label mt-4 text-[11px] tracking-[.14em] text-ink-3">{isMe ? t("profile.you") : t("profile.eyebrow")}</div>
          <h1 className={`mt-1 break-all text-[clamp(30px,5vw,48px)] font-[650] leading-[1.15] text-ink ${profile?.name ? "" : "tnum"}`}>{profile?.name || shortAddr(addr)}</h1>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={onCopy} aria-label={t("profile.copy")} className="mono-label rounded-full border border-stroke bg-glass-2 px-3 py-1 text-[11px] text-ink-2 hover:border-brand hover:text-brand">
              {copied ? t("profile.copied") : shortAddr(addr)} <Copy size={11} strokeWidth={1.8} aria-hidden="true" className="inline align-[-1px]" />
            </button>
            <a href={explorer.address(addr)} target="_blank" rel="noreferrer" className="mono-label rounded-full border border-stroke bg-glass-2 px-3 py-1 text-[11px] text-ink-3 hover:border-brand hover:text-brand">
              {t("profile.explorer")}
            </a>
            {profile?.x && (
              <a href={`https://x.com/${profile.x}`} target="_blank" rel="noreferrer" className="mono-label rounded-full border border-stroke bg-glass-2 px-3 py-1 text-[11px] text-ink-2 hover:border-brand hover:text-brand">
                @{profile.x}
              </a>
            )}
            {isMe && <ProfileEditor key={profile?.updatedAt ?? 0} profile={profile ?? null} />}
          </div>
          <p className="mt-4 max-w-[560px] whitespace-pre-line text-[13px] leading-[1.8] text-muted">{profile?.bio || t("profile.desc")}</p>
        </header>

        <div className="mt-8 grid gap-4 nav:grid-cols-[2fr_1fr_1fr]">
          <Panel>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span>
                <span className={`tnum text-[22px] font-[550] ${change == null ? "text-ink-3" : change >= 0 ? "text-pos" : "text-neg"}`}>{change == null ? "—" : pct(change)}</span>
                {top && <span className="mono-label ml-2 text-[10px] tracking-[.1em] text-ink-3">{t("profile.topToken", { sym: top.symbol })}</span>}
              </span>
              <PeriodChips period={period} onPeriod={setPeriod} />
            </div>
            {series.length >= 2 ? (
              <DitherChart series={series} label={t("tcard.chartAria", { name: top?.name ?? "" })} orient="vertical" className="h-[140px] w-full" />
            ) : (
              <div className="grid h-[140px] place-items-center text-xs text-ink-3">{loading ? t("profile.loading") : t("profile.noChart")}</div>
            )}
          </Panel>
          <Panel>
            <div className="mono-label text-[10px] tracking-[.08em] text-ink-3">{t("profile.launches")}</div>
            <div className="tnum mt-2 text-[30px] font-light text-ink">{mine.length}</div>
          </Panel>
          <Panel>
            <div className="mono-label text-[10px] tracking-[.08em] text-ink-3">{t("profile.graduated")}</div>
            <div className="tnum mt-2 text-[30px] font-light text-ink">{graduated}</div>
          </Panel>
        </div>

        {isMe && mine.length > 0 && (
          <section className="mt-10">
            <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
            <CreatorTools mine={mine} onPending={setPendingHash} onChanged={refresh} />
          </section>
        )}

        {mine.length > 0 && (
          <>
            {candidates.length > 0 && buyRow && (
              <section className="mx-auto mt-10 max-w-[520px]">
                <div className="mono-label mb-3 text-center text-[11px] tracking-[.12em] text-ink-3">{t("profile.buyInto")}</div>
                <Panel>
                  <SwapForm tk={toTradeToken(buyRow)} candidates={candidates.map(toTradeToken)} onToken={(tk) => setBuy(tk)} />
                </Panel>
              </section>
            )}

            <section className="mt-10">
              <SectionHead title={t("profile.record")} aside={t("profile.recordSub")} />
              <div className="grid gap-2">
                {mine.map((r, i) => (
                  <Link key={r.token} href={`/token/${r.token}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-[12px] border border-stroke bg-glass-2 px-4 py-3 transition-colors hover:border-brand">
                    <span className="min-w-0">
                      <span className="mono-label text-[12px] text-ink">${r.symbol}</span> <span className="text-[13px] text-muted">{r.name}</span>
                      {i === 0 && mine.length > 1 && <span className="mono-label ml-2 rounded-full border border-stroke-2 px-2 py-0.5 text-[10px] text-ink-2">{t("profile.mostBacked")}</span>}
                    </span>
                    <span className={`tnum text-sm ${typeof r.change24h !== "number" ? "text-ink-3" : r.change24h >= 0 ? "text-pos" : "text-neg"}`}>{typeof r.change24h === "number" ? pct(r.change24h) : "—"}</span>
                    <span className="tnum text-right text-sm text-ink-2">
                      <span className="mono-label mr-1.5 text-[10px] text-ink-3">{r.graduated ? t("tcard.graduated") : t("tcard.live")}</span>
                      {fmtNum(Number(r.trackedQuote) / 10 ** r.quoteDecimals, 2)} {r.quoteSymbol}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="mt-10">
          <SectionHead title={isMe ? t("profile.tokensMine") : t("profile.tokens")} aside={String(mine.length)} />
          {mine.length ? (
            <div className="grid gap-5 min-[640px]:grid-cols-2">
              {mine.map((r) => (
                <TokenCard key={r.token} row={r} />
              ))}
            </div>
          ) : (
            <Empty>{loading ? t("profile.loading") : t("profile.noLaunches", { chain: net.chainName })}</Empty>
          )}
        </section>

        <div className="mt-10 text-center">
          <HeroLink href="/create" ghost>
            {isMe && mine.length ? t("profile.launchAnother") : t("profile.become")}
          </HeroLink>
        </div>

        <Footer />
      </div>
    </Shell>
  );
}
