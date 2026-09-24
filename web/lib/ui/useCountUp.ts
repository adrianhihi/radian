"use client";

import { useEffect, useState } from "react";

/**
 * Count-up for headline numbers: 0 → target with easeOutCubic, landing exactly
 * on target. Initial state is the target, so SSR, no-JS and reduced motion all
 * show the final value without a setState.
 */
export function useCountUp(target: number, durationMs = 640): number {
  const [value, setValue] = useState(target);

  useEffect(() => {
    if (!(target > 0)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const e = 1 - Math.pow(1 - p, 3);
      if (p < 1) {
        setValue(target * e);
        raf = requestAnimationFrame(step);
      } else {
        setValue(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}
