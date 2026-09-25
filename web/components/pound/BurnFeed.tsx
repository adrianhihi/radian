"use client";

// The burn feed: one card per Pack burn, newest first, read from the indexer's /pound/feed.json —
// the very list an auto-poster reads — so what people see here and what gets posted agree. Each
// card: the coin's colour dot and logo, "Burned N $SYM for Q ASSET", when, the explorer link, and
// three ways to pass it on without this site holding any social credential: an X intent link with
// a pre-written line in the reader's language, the Web Share sheet where the browser has one, and
// copy. A failed read says so; it is never drawn as "no burns".
import { Check, Copy, ExternalLink, RefreshCw, Share2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { fetchBurnFeed, type BurnFeedItem } from "@/lib/indexer";
import { fmtNum, shortAddr } from "@/lib/ui/format";
import { assetColor } from "@/lib/ui/tokens";
import { agoText, colorKey, type PackRow } from "./PackBasket";

const PAGE = 8;
const fmtQ = (v: string, dec: number) => {
  const n = Number(formatUnits(BigInt(v), dec));
  return n >= 1 ? fmtNum(n, 2) : n.toLocaleString(undefined, { maximumSignificantDigits: 3 });
};
const fmtTokens = (v: string) => fmtNum(Number(formatUnits(BigInt(v), 18)), 0);

/** The X mark, drawn inline so no icon set is needed for it. */
function XMark({ size = 11 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <path d="M5 4l14 16M19 4L5 20" />
    </svg>
  );
}

export function BurnFeed({ packs, colors, explorer, now, onToast }: { packs: PackRow[]; colors: Record<string, string>; explorer: string; /** unix seconds */ now: number; onToast?: (s: string) => void }) {
  const t = useT();
  const [items, setItems] = useState<BurnFeedItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [copied, setCopied] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await fetchBurnFeed());
      setFailed(false);
    } catch {
      setFailed(true); // keep what was read before; say the refresh failed
    }
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, 60000);
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const txUrl = (b: BurnFeedItem) => b.url || `${explorer}/tx/${b.txHash}`;
  const symOf = (b: BurnFeedItem) => b.symbol || packs.find((p) => p.token.toLowerCase() === b.token.toLowerCase())?.symbol || shortAddr(b.token);
  const postText = (b: BurnFeedItem) => t("pound.postText", { tokens: fmtTokens(b.tokensOut), sym: symOf(b), quote: fmtQ(b.quoteIn, b.assetDecimals), asset: b.assetSymbol, url: txUrl(b) });
  const copy = (b: BurnFeedItem) => {
    const text = postText(b);
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(b.id);
        setTimeout(() => setCopied(null), 1600);
      },
      () => onToast?.(text),
    );
  };
  const share = (b: BurnFeedItem) => {
    navigator.share({ text: postText(b) }).catch(() => {
      /* the reader closed the sheet, or the browser refused: nothing to report */
    });
  };

  const btn = "mono-label inline-flex items-center gap-1.5 rounded-[10px] border border-stroke-2 px-2.5 py-1.5 text-[10.5px] tracking-[.12em] text-ink-2 transition-colors hover:border-brand hover:text-brand";
  const btnBrand = "mono-label inline-flex items-center gap-1.5 rounded-[10px] border border-brand/60 px-2.5 py-1.5 text-[10.5px] tracking-[.12em] text-brand transition-colors hover:bg-glass-2";

  if (!items) {
    return failed ? (
      <p role="alert" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-dashed border-neg/50 px-4 py-4 text-[13px] leading-[1.7] text-ink-2">
        {t("pound.feedReadFailed")}
        <button type="button" onClick={load} className="inline-flex items-center gap-1 text-brand hover:underline">
          <RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" /> {t("pound.retry")}
        </button>
      </p>
    ) : (
      <p className="text-[13px] text-muted">{t("pound.readingBurner")}</p>
    );
  }
  if (!items.length) return <p className="rounded-[12px] border border-dashed border-stroke-2 px-4 py-5 text-center text-[13px] text-ink-3">{t("pound.noBurnsYet")}</p>;

  return (
    <>
      {failed && (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-neg">
          {t("pound.feedStale")}
          <button type="button" onClick={load} className="inline-flex items-center gap-1 text-brand hover:underline">
            <RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" /> {t("pound.retry")}
          </button>
        </p>
      )}
      <ul className="grid gap-2.5">
        {items.slice(0, shown).map((b) => {
          const pack = packs.find((p) => p.token.toLowerCase() === b.token.toLowerCase());
          const sym = symOf(b);
          const color = (pack && colors[colorKey(pack)]) ?? assetColor(sym);
          const logoSrc = pack?.logo && /^https?:\/\//.test(pack.logo) ? pack.logo : null;
          const intent = `https://x.com/intent/post?text=${encodeURIComponent(postText(b))}`;
          const when = new Date(b.ts);
          return (
            <li key={b.id} className="glass-panel flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
              <span className="size-2.5 flex-none rounded-full" style={{ background: color }} aria-hidden="true" />
              <AssetLogo symbol={sym} src={logoSrc} seed={b.token} size={28} radius={14} />
              <span className="min-w-0 flex-1">
                <span className="tnum block text-[14px] font-semibold text-ink">{t("pound.cardBurned", { tokens: fmtTokens(b.tokensOut), sym, quote: fmtQ(b.quoteIn, b.assetDecimals), asset: b.assetSymbol })}</span>
                <span className="mono-label tnum block text-[10.5px] tracking-[.1em] text-ink-3">
                  <time dateTime={when.toISOString()}>{when.toLocaleString()}</time> · {agoText(Math.floor(b.ts / 1000), now, t)}
                  {b.bounty !== "0" && ` · ${t("pound.cardBounty", { v: fmtQ(b.bounty, b.assetDecimals), asset: b.assetSymbol })}`}
                </span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                <a href={txUrl(b)} target="_blank" rel="noreferrer" className={btn}>
                  <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" /> {t("pound.viewTx")}
                </a>
                <a href={intent} target="_blank" rel="noreferrer noopener" className={btnBrand}>
                  <XMark /> {t("pound.postOnX")}
                </a>
                {canShare && (
                  <button type="button" onClick={() => share(b)} className={btn}>
                    <Share2 size={11} strokeWidth={1.8} aria-hidden="true" /> {t("pound.shareBtn")}
                  </button>
                )}
                <button type="button" onClick={() => copy(b)} className={btn} aria-live="polite">
                  {copied === b.id ? <Check size={11} strokeWidth={2} aria-hidden="true" /> : <Copy size={11} strokeWidth={1.8} aria-hidden="true" />} {copied === b.id ? t("pound.copiedText") : t("pound.copyText")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {items.length > shown && (
        <div className="mt-3 text-center">
          <button type="button" onClick={() => setShown((s) => s + PAGE)} className="mono-label rounded-full border border-stroke-2 px-4 py-1.5 text-[10.5px] tracking-[.14em] text-ink-2 transition-colors hover:border-brand hover:text-brand">
            {t("pound.moreBurns")}
          </button>
        </div>
      )}
    </>
  );
}
