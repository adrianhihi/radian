"use client";

// The wizard's step bar: 1 NAME → 2 MARKET & FEES → 3 LAUNCH. Finished steps
// show a check and can be revisited; steps ahead are not clickable. A "← Back"
// sits in the bar itself once past the first step, so going back never needs
// the bottom of the page. Each step button tells a screen reader its state.
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "@/components/LangProvider";
import type { TKey } from "@/lib/i18n";

export const STEPS: { n: number; key: TKey }[] = [
  { n: 1, key: "create.stepName" },
  { n: 2, key: "create.stepMarket" },
  { n: 3, key: "create.stepLaunch" },
];

export function Stepper({ current, reachable, onGoto, onBack }: { current: number; reachable: (n: number) => boolean; onGoto: (n: number) => void; onBack?: () => void }) {
  const t = useT();
  return (
    <nav aria-label={t("create.progressAria")} className="flex flex-wrap items-center gap-1.5">
      {current > 1 && onBack && (
        <button type="button" onClick={onBack} className="mono-label mr-1 rounded-lg border border-stroke-2 px-2.5 py-1.5 text-[10.5px] tracking-[.1em] text-ink-2 hover:border-brand hover:text-brand">
          {t("create.back")}
        </button>
      )}
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((s, i) => {
          const done = s.n < current;
          const now = s.n === current;
          const can = !now && reachable(s.n);
          const state = now ? t("create.stateCurrent") : done ? t("create.stateDone") : t("create.stateTodo");
          return (
            <li key={s.n} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden="true" className="h-px w-5 bg-stroke" />}
              <button
                type="button"
                disabled={!can}
                aria-current={now ? "step" : undefined}
                aria-label={t("create.stepAria", { n: s.n, label: t(s.key), state })}
                onClick={() => can && onGoto(s.n)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors ${now ? "grad-fill" : can ? "text-ink-2 hover:bg-glass-2 hover:text-ink" : "cursor-default text-ink-3"}`}
              >
                <span className={`grid size-[18px] flex-none place-items-center rounded-full text-[10px] ${now ? "bg-white/25" : done ? "bg-glass-2 text-pos" : "bg-glass-2"}`} aria-hidden="true">
                  {done ? <Check size={13} strokeWidth={1.8} aria-hidden="true" /> : s.n}
                </span>
                <span className="mono-label tracking-[.06em]">{t(s.key)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A step's heading: the step number in a circle that turns into a check once the step's data is complete. */
export function StepTitle({ n, done, children }: { n: number; done: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden="true" className={`grid size-7 flex-none place-items-center rounded-full border text-[12px] ${done ? "border-pos/60 text-pos" : "border-brand/60 text-brand"}`}>
        {done ? <Check size={14} strokeWidth={2.2} /> : n}
      </span>
      {children}
    </span>
  );
}
