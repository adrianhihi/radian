"use client";

// Token page head, on baskvia's basket-detail head: a top row (back · Share ·
// Open in Swap) and a hero card washed in the quote asset's colour — name,
// chips ($SYMBOL · fee · priced in · template · status), the story with the
// project links; on the right the 24h change, the big spot price, the creator
// and the logo.
import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatUnits, type Address } from "viem";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { OutlineButton, OutlineLink } from "@/components/ui/primitives";
import { hasPound, type LaunchRow, type LaunchTemplate } from "@/lib/radian";
import { emptyDraft, saveDraft } from "@/lib/draft";
import type { Sunset } from "@/lib/indexer";
import { projectLinks, safeHttpUrl, xUrl } from "@/lib/projects";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { fmtPrice, shortAddr } from "@/lib/ui/format";
import { assetColor } from "@/lib/ui/tokens";
import type { TokenState } from "./types";

const pctOf = (bps: bigint) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 2)}%`;

export function DetailHead({
  token,
  st,
  creator,
  row,
  template,
  sunset,
  onToast,
}: {
  token: Address;
  st: TokenState;
  creator?: Address | null;
  row?: LaunchRow;
  template: LaunchTemplate | null;
  sunset: Sunset | null;
  onToast: (text: string) => void;
}) {
  const t = useT();
  const { address: account } = useRadianWallet();
  const accent = assetColor(st.quoteSymbol);
  const price = st.tokenReserve > 0n ? Number(formatUnits(st.quoteReserve, st.quoteDecimals)) / Number(formatUnits(st.tokenReserve, 18)) : 0;
  const change = row?.change24h;
  const curated = projectLinks(token);
  const site = safeHttpUrl(st.website) ?? safeHttpUrl(curated?.website);
  const x = xUrl(st.twitter) ?? xUrl(curated?.twitter);
  const description = st.description.trim();

  // Share copies this page's link. Signed in where The Pound runs, the link
  // carries the viewer's referral tag: trades it brings pay them a share.
  const onShare = () => {
    const url = new URL(window.location.href);
    url.search = "";
    const ref = hasPound && account ? account : null;
    if (ref) url.searchParams.set("ref", ref);
    const ok = () => onToast(ref ? t("detail.copiedRef") : t("detail.copied"));
    const fail = () => onToast(t("detail.copyFailed"));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url.toString()).then(ok, fail);
    else fail();
  };

  // "Use as template": the wizard opens with this launch's market, template and creator tax;
  // the name, symbol and story are the new creator's own.
  const router = useRouter();
  const remix = () => {
    saveDraft({
      ...emptyDraft(),
      quoteKey: st.quoteAsset.key ?? "",
      template: template?.kind ?? "standard",
      creatorTax: (Number(st.creatorTaxBps) / 100).toString(),
    });
    router.push("/create");
  };

  const chip = "mono-label rounded-md border border-stroke bg-glass-2 px-2.5 py-1 text-[12px] text-ink-2";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/explore" className="mono-label text-[11px] tracking-[.08em] text-ink-2 hover:text-brand">
          {t("detail.back")}
        </Link>
        <div className="flex flex-wrap gap-2">
          <OutlineButton type="button" onClick={onShare}>
            {t("detail.share")}
          </OutlineButton>
          <OutlineButton type="button" onClick={remix}>
            {t("detail.remix")} <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" className="inline align-[-2px]" />
          </OutlineButton>
          {!st.graduated && (
            <OutlineLink href={`/swap?token=${token}`}>
              {t("detail.swapHere")} <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" className="inline align-[-2px]" />
            </OutlineLink>
          )}
        </div>
      </div>

      {/* The wash is background only; text colours never follow it, so any asset colour stays readable. */}
      <section
        className="relative overflow-hidden rounded-[18px] border border-stroke p-5 nav:p-7"
        style={{
          background: `radial-gradient(120% 90% at 85% 10%, color-mix(in srgb, ${accent} 26%, transparent), transparent 62%), linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, var(--glass-2, transparent)), transparent)`,
          borderTopColor: accent,
          borderTopWidth: 2,
        }}
      >
        <div className="grid gap-6 nav:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <h1 className="text-[clamp(32px,5vw,56px)] font-[700] uppercase leading-[1.05] tracking-[-1px] text-ink">{st.name}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mono-label rounded-md border px-2.5 py-1 text-[12px] text-ink" style={{ borderColor: accent, background: `color-mix(in srgb, ${accent} 16%, transparent)` }}>
                ${st.symbol}
              </span>
              <span className={chip}>
                <b className="font-semibold text-ink">{pctOf(st.feeBps)}</b> {t("detail.feeChip")}
                {st.creatorTaxBps > 0n && <> + {pctOf(st.creatorTaxBps)}</>}
              </span>
              <span className={`${chip} inline-flex items-center gap-1.5`}>
                {st.quoteAsset.stock && <AssetLogo symbol={st.quoteSymbol} ticker={st.quoteAsset.stock.refSymbol} size={14} radius={4} />}
                {t("detail.pricedIn", { sym: st.quoteSymbol })}
              </span>
              {template && <span className={chip}>{template.kind === "wall" ? t("tcard.wall") : t("tcard.pof")}</span>}
              <span className={`mono-label rounded-md border px-2.5 py-1 text-[11px] ${sunset ? "border-stroke text-ink-3" : st.graduated ? "border-signal/60 text-signal" : "border-brand/60 text-brand"}`}>
                {sunset ? t("detail.retired") : st.graduated ? t("tcard.graduated") : t("tcard.live")}
              </span>
            </div>

            <div className="mt-4 rounded-[14px] border border-stroke bg-glass-2 p-4">
              {description ? (
                <p className="text-sm leading-[1.8] text-ink-2">{description}</p>
              ) : (
                <p className="mono-label text-[11px] tracking-[.06em] text-ink-3">{t("tcard.noDesc")}</p>
              )}
              {(site || x) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {site && (
                    <a href={site} target="_blank" rel="noreferrer noopener" className="mono-label rounded-full border border-stroke px-2.5 py-0.5 text-[10.5px] uppercase tracking-[.06em] text-muted hover:border-brand hover:text-brand">
                      {t("detail.site")}
                    </a>
                  )}
                  {x && (
                    <a href={x} target="_blank" rel="noreferrer noopener" className="mono-label rounded-full border border-stroke px-2.5 py-0.5 text-[10.5px] uppercase tracking-[.06em] text-muted hover:border-brand hover:text-brand">
                      {t("detail.x")}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 nav:items-end nav:text-right">
            <div>
              <div className="mono-label flex items-center gap-3 text-[10.5px] tracking-[.14em] text-ink-3 nav:justify-end">
                24H
                {typeof change === "number" ? (
                  <span className={`tnum inline-flex items-center gap-1 text-[13px] tracking-normal ${change >= 0 ? "text-pos" : "text-neg"}`}>
                    {change >= 0 ? <ArrowUp size={12} strokeWidth={2} aria-hidden="true" /> : <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />}
                    {change >= 0 ? "+" : "−"}
                    {Math.abs(change).toFixed(2)}%
                  </span>
                ) : (
                  <span className="tnum text-[13px] tracking-normal text-ink-3">—</span>
                )}
              </div>
              <div className="text-xs text-muted">{t("detail.spot", { sym: st.quoteSymbol })}</div>
              <div className="tnum text-[clamp(34px,5vw,54px)] font-light leading-none tracking-[-1.5px] text-ink">{fmtPrice(price)}</div>
            </div>

            {creator && (
              <div className="flex items-center gap-3">
                <div className="nav:text-right">
                  <div className="mono-label text-[10px] tracking-[.08em] text-ink-3">{t("detail.creator")}</div>
                  <div className={`text-sm font-medium text-ink ${row?.creatorName ? "" : "tnum"}`}>{row?.creatorName || shortAddr(creator)}</div>
                  <Link href={`/profile/${creator}`} className="mono-label text-[11px] text-brand hover:underline">
                    {t("detail.viewCreator")}
                  </Link>
                </div>
                <AddressAvatar address={creator} size={42} />
              </div>
            )}

            <span className="rounded-full ring-2 ring-night">
              <AssetLogo symbol={st.symbol} src={/^https?:\/\//.test(row?.logo || st.logo) ? row?.logo || st.logo : null} seed={token} size={48} radius={24} />
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
