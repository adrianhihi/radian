"use client";

// The "(i)" beside a number: what it measures and what it leaves out, in a small
// popover. Opens on click, closes on Escape or a click outside; also shown on hover
// and keyboard focus so it works without a pointer. Copy is methodology and limits,
// never marketing.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/LangProvider";

export function Info({ text, className = "" }: { text: string; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
  return (
    <span ref={ref} className={`group relative inline-flex align-middle normal-case tracking-normal ${className}`}>
      <button
        type="button"
        aria-label={t("info.aria")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-[15px] place-items-center rounded-full border border-current text-[9px] font-semibold leading-none text-ink-3 hover:text-brand focus-visible:text-brand"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`absolute left-1/2 top-6 z-30 w-[280px] -translate-x-1/2 rounded-xl border border-stroke-2 bg-night p-3 font-sans text-[12px] font-normal leading-[1.6] text-ink-2 shadow-[0_18px_44px_-18px_rgba(0,0,0,.8)] ${
          open ? "" : "pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
