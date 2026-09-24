"use client";

// The MORE dropdown. Opens on hover, click pins it open (a second click closes),
// outside click / Escape / route change close it. `open = hovered || pinned` so
// a mouse user who hovers first and then clicks does not accidentally close it.
// The 8px gap between button and panel is padding, not margin, so the pointer
// never crosses a non-hover zone on the way down.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_MORE } from "@/lib/routes";
import { useT, useTDynamic } from "@/components/LangProvider";

export function NavMore({ active }: { active: boolean }) {
  const t = useT();
  const td = useTDynamic();
  const pathname = usePathname();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const close = () => {
    setHovered(false);
    setPinned(false);
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setHovered(false);
    setPinned(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        id="nav-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (pinned ? close() : setPinned(true))}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-[15px] py-2.5 text-base transition-colors ${
          active || open ? "grad-fill" : "text-ink-2 hover:bg-glass-2 hover:text-ink"
        }`}
      >
        {t("nav.more")}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`size-[15px] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9.5 12 15.5 18 9.5" />
        </svg>
      </button>

      {open && (
        <div id={menuId} role="menu" aria-labelledby="nav-more" className="absolute left-1/2 z-40 w-[220px] -translate-x-1/2 pt-2">
          <div className="rounded-xl border border-stroke bg-night p-1.5 shadow-[0_18px_44px_-18px_rgba(0,0,0,.8)]">
            {NAV_MORE.map((n) => (
              <Link
                key={n.name}
                role="menuitem"
                href={n.href}
                className={`block rounded-lg px-3 py-2.5 text-[14px] transition-colors ${
                  pathname.startsWith(n.href) ? "bg-glass-2 text-ink" : "text-ink-2 hover:bg-glass-2 hover:text-ink"
                }`}
              >
                {td(`nav.${n.name}`)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
