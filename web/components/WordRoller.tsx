"use client";
import { useEffect, useRef, useState } from "react";

// A combination-lock style word roller: every `interval` ms the current word
// rolls down and out while the next one drops in from above. Static (first
// word only) when the list has one entry or the viewer prefers reduced motion.
export function WordRoller({ words, interval = 3000, className = "" }: { words: string[]; interval?: number; className?: string }) {
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
        timer.current = setTimeout(() => setPrev(null), 700);
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
    <span className={`roller ${className}`} aria-label={words[idx]}>
      {prev !== null && (
        <span className="roller-word roller-out" aria-hidden="true">{words[prev]}</span>
      )}
      <span key={idx} className={`roller-word ${prev !== null ? "roller-in" : ""}`}>{words[idx]}</span>
    </span>
  );
}
