"use client";
import { useEffect, useRef, useState } from "react";

// Crossfades between words every `interval` ms. Both words sit in the same
// grid cell, so the gradient text style applies to each word itself (a
// background-clipped container with animated children renders invisible on
// WebKit). Static when the list has one entry or motion is reduced.
export function WordRoller({ words, interval = 3000, wordClassName = "" }: { words: string[]; interval?: number; wordClassName?: string }) {
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = words.join("|");

  useEffect(() => {
    setIdx(0);
    setPrev(null);
    if (words.length < 2) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setIdx((i) => {
        setPrev(i);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setPrev(null), 900);
        return (i + 1) % words.length;
      });
    }, interval);
    return () => {
      clearInterval(t);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, interval]);

  return (
    <span className="roller" aria-label={words[idx]}>
      {prev !== null && (
        <span className={`roller-word roller-out ${wordClassName}`} aria-hidden="true">{words[prev]}</span>
      )}
      <span key={idx} className={`roller-word ${prev !== null ? "roller-in" : ""} ${wordClassName}`}>{words[idx]}</span>
    </span>
  );
}
