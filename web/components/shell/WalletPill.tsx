"use client";

// Wallet pill + menu, on Privy. Three states: loading (Privy mounts client-side,
// so the first frame is never "connected"), signed out, signed in (address with
// copy / explorer / sign out).
import { ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
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
  const { ready, authenticated, login, logout, address, wallets, selectWallet } = useRadianWallet();
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
        <Loader2 size={12} className="mr-1.5 inline-block animate-spin align-[-2px]" aria-hidden="true" />
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
          {wallets.length > 1 && (
            <div className="mb-1 grid gap-0.5 border-b border-stroke pb-1">
              <span className="mono-label px-2.5 pt-1 text-[9.5px] tracking-[.14em] text-ink-3">{t("wallet.switchTitle")}</span>
              {wallets.map((w) => {
                const current = w.address.toLowerCase() === address.toLowerCase();
                return (
                  <button key={w.address} type="button" aria-current={current ? "true" : undefined} className={`${MENU_ITEM} flex items-center justify-between gap-3 ${current ? "text-brand" : ""}`} onClick={() => { selectWallet(w.address); setOpen(false); }}>
                    <span className="tnum">{shortAddr(w.address)}</span>
                    <span className="mono-label text-[9.5px] tracking-[.1em] text-ink-3">{w.clientType === "privy" ? t("wallet.embedded") : w.clientType.replace(/_/g, " ")}</span>
                  </button>
                );
              })}
            </div>
          )}
          <button type="button" className={MENU_ITEM} onClick={copy}>
            {copied ? t("wallet.copied") : t("wallet.copy")}
          </button>
          <Link className={MENU_ITEM} href={`/profile/${address}`} onClick={() => setOpen(false)}>
            {t("wallet.mine")}
          </Link>
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
