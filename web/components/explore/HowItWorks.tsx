"use client";

// "How this works": four pages, the same copy as the Learn page's four steps so
// the two never drift. Esc closes, ← → page, backdrop click closes, focus
// returns to the trigger.
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLang, useT } from "@/components/LangProvider";
import { learnVars } from "@/lib/content/learn";
import type { TKey } from "@/lib/i18n";

const STEPS: [TKey, TKey][] = [
  ["learn.step1Title", "learn.step1Body"],
  ["learn.step2Title", "learn.step2Body"],
  ["learn.step3Title", "learn.step3Body"],
  ["learn.step4Title", "learn.step4Body"],
];

export function HowItWorksButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btnRef} type="button" onClick={() => setOpen(true)} className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 px-3 py-1.5 text-[10.5px] tracking-[.14em] text-ink-2 transition-colors hover:border-brand hover:text-brand">
        <span aria-hidden="true" className="grid size-4 place-items-center rounded-full border border-current text-[9px]">
          ?
        </span>
        {t("explore.howItWorks")}
      </button>
      {open && (
        <HowItWorksDialog
          onClose={() => {
            setOpen(false);
            btnRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const vars = useMemo(() => learnVars(lang), [lang]); // the steps quote fees; same fill as the Learn page
  const [i, setI] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const last = i === STEPS.length - 1;
  const [titleKey, bodyKey] = STEPS[i];

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, STEPS.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(8,5,3,.72)] px-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="how-title" tabIndex={-1} className="glass-panel relative w-full max-w-[560px] overflow-hidden rounded-lg outline-none">
        <div className="grad-fill h-[3px]" aria-hidden="true" />
        <div className="px-6 pb-6 pt-5 nav:px-8">
          <div className="flex items-center justify-between">
            <span className="mono-label text-[10.5px] tracking-[.16em] text-ink-3">{t("explore.howStep", { n: i + 1, total: STEPS.length })}</span>
            <button type="button" aria-label={t("explore.howClose")} onClick={onClose} className="text-lg leading-none text-ink-3 hover:text-ink">
              <X size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <h2 id="how-title" className="mt-5 text-[clamp(26px,4vw,34px)] font-bold leading-[1.1] text-ink">
            {t(titleKey)}
          </h2>
          <p className="mt-3 min-h-[5.4em] text-[14.5px] leading-[1.75] text-muted">{t(bodyKey, vars)}</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-stroke px-6 py-4 nav:px-8">
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-[width] ${n === i ? "grad-fill w-5" : "w-1.5 bg-stroke-2"}`} />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="mono-label text-[11px] tracking-[.1em] text-ink-3 hover:text-ink">
                {t("explore.howBack")}
              </button>
            )}
            {last ? (
              <Link href="/docs" className="grad-fill mono-label rounded-lg px-4 py-2 text-[11px] tracking-[.12em]">
                {t("explore.howGuide")}
              </Link>
            ) : (
              <button type="button" onClick={() => setI(i + 1)} className="grad-fill mono-label rounded-lg px-4 py-2 text-[11px] tracking-[.12em]">
                {t("explore.howNext")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
