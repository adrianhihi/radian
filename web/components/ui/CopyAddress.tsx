"use client";

// A launch token's contract address with a copy button (baskvia's CopyAddress, 2026-09-25): what a
// holder pastes into a wallet's "import token". `inline` under a position row, `pill` floating on a
// card's top edge beside "Most backed", `chip` in the token page's chip row.
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { shortAddr } from "@/lib/ui/format";

export function CopyAddress({ address, symbol, variant = "inline" }: { address: string; symbol: string; variant?: "inline" | "pill" | "chip" }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const cls =
    variant === "pill"
      ? "rounded-full border border-stroke-2 bg-bg-2 px-2.5 py-1 text-[9.5px] tracking-[.06em] text-ink-2 hover:border-brand hover:text-brand"
      : variant === "chip"
        ? "gap-1.5 rounded-md border border-stroke bg-glass-2 px-2.5 py-1 text-[11px] text-ink-2 hover:border-brand hover:text-brand"
        : "mt-0.5 rounded-md text-[10.5px] text-ink-3 hover:text-brand";
  return (
    <button
      type="button"
      aria-label={t("copy.token", { sym: symbol })}
      title={address}
      onClick={(e) => {
        // the row or card around it may be a link: copy, never navigate
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(address).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          },
          () => {},
        );
      }}
      className={`tnum mono-label inline-flex items-center gap-1 transition-colors ${cls}`}
    >
      {shortAddr(address)}
      {copied ? <Check size={11} strokeWidth={2} aria-hidden="true" className="text-pos" /> : <Copy size={11} strokeWidth={1.8} aria-hidden="true" />}
      {copied && <span className="text-pos">{t("wallet.copied")}</span>}
    </button>
  );
}
