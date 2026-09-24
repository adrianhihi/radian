"use client";

// The wizard's step bar: 1 NAME → 2 MARKET & FEES → 3 LAUNCH. Finished steps
// show a check and can be revisited; steps ahead are not clickable.
import { Check } from "lucide-react";
import { useT } from "@/components/LangProvider";
import type { TKey } from "@/lib/i18n";

export const STEPS: { n: number; key: TKey }[] = [
  { n: 1, key: "create.stepName" },
  { n: 2, key: "create.stepMarket" },
  { n: 3, key: "create.stepLaunch" },
];

export function Stepper({ current, reachable, onGoto }: { current: number; reachable: (n: number) => boolean; onGoto: (n: number) => void }) {
  const t = useT();
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {STEPS.map((s, i) => {
        const done = s.n < current;
        const now = s.n === current;
        const can = !now && reachable(s.n);
        return (
          <li key={s.n} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="h-px w-5 bg-stroke" />}
            <button
              type="button"
              disabled={!can}
              aria-current={now ? "step" : undefined}
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
  );
}
