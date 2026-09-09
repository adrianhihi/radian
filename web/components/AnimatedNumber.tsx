"use client";
import { useEffect, useRef, useState } from "react";

// Count-up odometer, like the Pons analytics counters. Eases to `value`.
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  const from = useRef(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const dur = 900;
    const a = from.current;
    const b = value;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(a + (b - a) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    // Safety: if rAF is throttled (hidden tab), still land on the final value.
    const snap = window.setTimeout(() => {
      setDisplay(value);
      from.current = value;
    }, dur + 120);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      window.clearTimeout(snap);
    };
  }, [value]);

  return (
    <span>
      {prefix}
      {display.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}
