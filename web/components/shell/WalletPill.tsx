"use client";

// Wallet pill + menu, on Privy. Three states: loading (Privy mounts client-side,
// so the first frame is never "connected"), signed out, signed in (address with
// copy / explorer / sign out).
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useNetwork } from "@/lib/networks";
import { useT } from "@/components/LangProvider";
import { shortAddr } from "@/lib/ui/format";

const MENU_ITEM = "block w-full rounded-[7px] px-2.5 py-2.5 text-left text-[13px] text-ink hover:bg-glass-2";
const BASE = "tnum whitespace-nowrap rounded-lg border px-3 py-2 text-[13px] backdrop-blur-[10px]";

export function WalletPill() {
  const t = useT();
  const net = useNetwork();
  const { ready, authenticated, login, logout, address } = useRadianWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready) {
    return (
      <span className={`${BASE} border-stroke-2 bg-glass-2 text-ink-3`} aria-busy="true">
        {t("wallet.loading")}
      </span>
    );
  }

  if (!authenticated || !address) {
    return (
      <button type="button" className={`${BASE} border-stroke-2 bg-glass-2 text-ink transition-colors hover:border-brand`} onClick={login}>
        {t("wallet.connect")}
      </button>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused: the address is visible in the pill */
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button type="button" className={`${BASE} grad-soft-fill`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {shortAddr(address)} <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" className="inline align-[-2px]" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-20 grid min-w-[200px] gap-0.5 rounded-xl border border-stroke-2 bg-night p-1.5 shadow-panel">
          <button type="button" className={MENU_ITEM} onClick={copy}>
            {copied ? t("wallet.copied") : t("wallet.copy")}
          </button>
          <a className={MENU_ITEM} href={`${net.explorer}/address/${address}`} target="_blank" rel="noreferrer">
            {t("wallet.explorer")}
          </a>
          <button
            type="button"
            className={MENU_ITEM}
            onClick={() => {
              logout();
              setOpen(false);
            }}
          >
            {t("wallet.disconnect")}
          </button>
        </div>
      )}
    </div>
  );
}
