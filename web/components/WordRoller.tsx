"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type RollerItem = { key: string; label: string; node?: ReactNode };

// Rotates through `items` every `interval` ms in three strictly sequential
// steps: the current item fades out completely, the box glides to the next
// item's width while nothing is visible, then the next item fades in. Each
// step is a CSS transition on the SAME element (opacity on the word, width on
// the box), started by a timer once the previous step has finished, so the
// two words are never on screen together and nothing is replaced mid-fade.
// Widths come from hidden copies of every item (a ResizeObserver keeps them
// honest through font and image loads), so the surrounding text never jumps
// and the shorter item leaves no gap. Static with one item or reduced motion.
export const ROLLER_OUT_MS = 450;
export const ROLLER_SWAP_MS = 250;
export const ROLLER_IN_MS = 450;
const SLACK_MS = 40; // let a transition finish before the next step starts

export function WordRoller({ items, interval = 3000 }: { items: RollerItem[]; interval?: number }) {
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const probes = useRef<(HTMLSpanElement | null)[]>([]);
  const widths = useRef<number[]>([]);
  const busy = useRef(false);
  const idxRef = useRef(0);
  const key = items.map((i) => i.key).join("|");

  // Measure every item; outside a beat, the box takes the current item's width at once.
  useLayoutEffect(() => {
    const measure = () => {
      widths.current = probes.current.map((el) => (el ? Math.ceil(el.getBoundingClientRect().width) : 0));
      const w = widths.current[idxRef.current];
      if (!busy.current && box.current && w) box.current.style.width = `${w}px`;
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    probes.current.forEach((el) => el && ro?.observe(el));
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [key]);

  useEffect(() => {
    idxRef.current = 0;
    setIdx(0);
    busy.current = false;
    if (word.current) word.current.style.opacity = "";
    if (items.length < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const timers = new Set<ReturnType<typeof setTimeout>>();
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const beat = () => {
      const w = word.current;
      const b = box.current;
      if (!w || !b || busy.current) return;
      busy.current = true;
      // 1. fade the current word out
      w.style.opacity = "0";
      after(ROLLER_OUT_MS + SLACK_MS, () => {
        // 2. swap the (invisible) word and glide the box to its width
        const to = (idxRef.current + 1) % items.length;
        idxRef.current = to;
        setIdx(to);
        const target = widths.current[to];
        if (target) b.style.width = `${target}px`;
        after(ROLLER_SWAP_MS + SLACK_MS, () => {
          // 3. fade the new word in
          w.style.opacity = "1";
          after(ROLLER_IN_MS + SLACK_MS, () => {
            w.style.opacity = "";
            busy.current = false;
          });
        });
      });
    };
    const t = setInterval(beat, interval);
    return () => {
      clearInterval(t);
      timers.forEach(clearTimeout);
      busy.current = false;
      if (word.current) word.current.style.opacity = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, interval]);

  const cur = items[idx] ?? items[0];

  return (
    <span ref={box} className="roller" aria-label={cur?.label}>
      <span ref={word} className="roller-word">{cur?.node ?? cur?.label}</span>
      <span className="roller-probe" aria-hidden="true">
        {items.map((it, i) => (
          <span key={it.key} className="roller-word" ref={(el) => { probes.current[i] = el; }}>
            {it.node ?? it.label}
          </span>
        ))}
      </span>
    </span>
  );
}
