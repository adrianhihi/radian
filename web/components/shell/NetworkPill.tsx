"use client";

// Network chooser in the header: the one thing that replaces baskvia's
// Live/Demo toggle. Switching reloads the page so every module-level
// contract constant re-derives from the chosen network (see lib/networks).
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NETWORKS, DEFAULT_NETWORK, getActiveNetworkKey, setActiveNetwork, type NetworkKey } from "@/lib/networks";
import { useT } from "@/components/LangProvider";

export function NetworkPill() {
  const t = useT();
  const [active, setActive] = useState<NetworkKey>(DEFAULT_NETWORK);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(getActiveNetworkKey()), []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cur = NETWORKS[active];
  const keys = (Object.keys(NETWORKS) as NetworkKey[]).filter((k) => !NETWORKS[k].hidden || k === active);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={t("shell.netAria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-[9px] border border-stroke bg-glass-2 px-2.5 py-[7px] text-xs font-semibold leading-none text-ink-2 transition-colors hover:text-ink"
      >
        <span className={`size-2 rounded-full ${cur.live ? "bg-pos shadow-[0_0_6px_rgba(108,199,154,.6)]" : "bg-signal"}`} />
        {cur.label}
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] z-30 grid min-w-[210px] gap-0.5 rounded-xl border border-stroke-2 bg-night p-1.5 shadow-panel">
          {keys.map((k) => {
            const n = NETWORKS[k];
            return (
              <button
                key={k}
                type="button"
                role="menuitem"
                className={`flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] ${k === active ? "bg-glass-2 text-ink" : "text-ink-2 hover:bg-glass-2 hover:text-ink"}`}
                onClick={() => {
                  setOpen(false);
                  if (k !== active) setActiveNetwork(k);
                }}
              >
                <span className={`size-2 flex-none rounded-full ${n.live ? "bg-pos" : "bg-signal"}`} />
                <span className="min-w-0 flex-1">
                  {n.chainName}
                  <span className="mono-label block text-[10px] text-ink-3">{n.live ? t("shell.netChain", { id: n.chainId }) : t("shell.netSoon")}</span>
                </span>
                {k === active && <span className="text-brand-3">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
