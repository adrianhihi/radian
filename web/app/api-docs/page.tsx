"use client";

// Developer docs, on baskvia's /docs skeleton: back · title · search (⌘K opens a
// dialog that filters sections and blocks and jumps to the match) · a sticky numbered
// "on this page" list on the left from 900px that follows the scroll · the sections
// (paragraphs / notes / code with Copy / tables that scroll sideways). The content is
// data in lib/content/apiDocs.ts, bilingual, filled in for the active network.
// This is /api-docs because /docs is the Learn page.
import { ArrowLeft, ArrowRight, Check, Copy, CornerDownLeft, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useLang, useT } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import { Info } from "@/components/ui/Info";
import { apiDocs, blockText, type DocBlock, type DocSection } from "@/lib/content/apiDocs";
import { useNetwork } from "@/lib/networks";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const blockId = (s: string, i: number) => `${s}-${i + 1}`;

function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="mt-3 min-w-0 max-w-full overflow-hidden rounded-[12px] border border-stroke bg-[rgba(0,0,0,.25)]">
      <div className="flex items-center justify-between gap-3 border-b border-stroke px-3 py-1.5">
        <span className="mono-label min-w-0 truncate text-[9.5px] tracking-[.14em] text-ink-3">{label}</span>
        <button
          type="button"
          aria-label={t("apiDocs.copyAria")}
          onClick={() =>
            navigator.clipboard?.writeText(code).then(
              () => {
                setDone(true);
                setTimeout(() => setDone(false), 1400);
              },
              () => {},
            )
          }
          className="mono-label inline-flex flex-none items-center gap-1 text-[9.5px] tracking-[.12em] text-ink-3 hover:text-brand"
        >
          {done ? <Check size={11} strokeWidth={2} aria-hidden="true" /> : <Copy size={11} strokeWidth={1.8} aria-hidden="true" />}
          <span aria-live="polite">{done ? t("apiDocs.copied") : t("apiDocs.copy")}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-[1.7] text-ink-2">{code}</pre>
    </div>
  );
}

function Cell({ value, col, explorer }: { value: string; col: number; explorer: string }) {
  if (ADDRESS.test(value)) {
    return (
      <a href={`${explorer}/address/${value}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[12px] text-brand hover:underline">
        {value}
      </a>
    );
  }
  return <span className={col === 0 ? "text-ink" : "font-mono text-[12px] text-ink-2 [overflow-wrap:anywhere]"}>{value}</span>;
}

function Table({ head, rows, explorer }: { head: string[]; rows: string[][]; explorer: string }) {
  const wide = head.length >= 3;
  return (
    <div className="mt-3 min-w-0 max-w-full overflow-x-auto rounded-[12px] border border-stroke">
      <table className={`w-full text-left text-[13px] ${wide ? "min-w-[640px]" : ""}`}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="mono-label whitespace-nowrap border-b border-stroke px-4 py-2 text-[10px] font-normal tracking-[.14em] text-ink-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 leading-[1.6]">
                  <Cell value={c} col={j} explorer={explorer} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A search hit is scrolled to and outlined for a moment so the eye lands on it.
function Block({ b, id, flash, explorer }: { b: DocBlock; id: string; flash: boolean; explorer: string }) {
  const ring = flash ? "rounded-[12px] outline outline-2 outline-offset-4 outline-brand/70" : "outline-none";
  switch (b.kind) {
    case "p":
      return (
        <p id={id} className={`mt-3 scroll-mt-28 text-[14px] leading-[1.75] text-muted ${ring}`}>
          {b.text}
        </p>
      );
    case "note":
      return (
        <p id={id} className={`mt-3 scroll-mt-28 rounded-[12px] border border-brand/40 bg-brand/5 px-4 py-3 text-[13px] leading-[1.7] text-ink-2 ${ring}`}>
          {b.text}
        </p>
      );
    case "code":
      return (
        <div id={id} className={`scroll-mt-28 ${ring}`}>
          <CodeBlock code={b.code} label={b.label} />
        </div>
      );
    default:
      return (
        <div id={id} className={`scroll-mt-28 ${ring}`}>
          <Table head={b.head} rows={b.rows} explorer={explorer} />
        </div>
      );
  }
}

type Hit = { id: string; section: string; n: number; title: string; snippet: string };

function snippetOf(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 120);
  const from = Math.max(0, i - 48);
  const to = Math.min(text.length, i + q.length + 72);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).replace(/\s+/g, " ")}${to < text.length ? "…" : ""}`;
}

function SearchDialog({ sections, onClose, onJump }: { sections: DocSection[]; onClose: () => void; onJump: (id: string) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const titleId = useId();

  useEffect(() => {
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const query = q.trim().toLowerCase();
  const hits = useMemo<Hit[]>(() => {
    if (!query) return [];
    const out: Hit[] = [];
    sections.forEach((s, si) => {
      if (s.title.toLowerCase().includes(query)) out.push({ id: s.id, section: s.id, n: si + 1, title: s.title, snippet: s.title });
      s.blocks.forEach((b, bi) => {
        const text = blockText(b);
        if (text.toLowerCase().includes(query)) out.push({ id: blockId(s.id, bi), section: s.id, n: si + 1, title: s.title, snippet: snippetOf(text, query) });
      });
    });
    return out.slice(0, 40);
  }, [sections, query]);
  const active = Math.min(cursor, Math.max(0, hits.length - 1));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) onJump(hits[active].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-[8vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-stroke-2 bg-night shadow-[0_24px_58px_-26px_rgba(0,0,0,.72)]">
        <h2 id={titleId} className="sr-only">
          {t("apiDocs.searchTitle")}
        </h2>
        <div className="flex items-center gap-2 border-b border-stroke px-3 py-2.5">
          <Search size={15} strokeWidth={1.8} aria-hidden="true" className="flex-none text-ink-3" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKey}
            placeholder={t("apiDocs.search")}
            aria-label={t("apiDocs.search")}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <button type="button" onClick={onClose} aria-label={t("apiDocs.close")} className="grid size-7 flex-none place-items-center rounded-md text-ink-3 hover:bg-glass-2 hover:text-ink">
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label={t("apiDocs.searchTitle")} className="max-h-[52vh] overflow-y-auto p-1.5">
          {query && hits.length === 0 && (
            <li className="px-3 py-6 text-center text-[13px] text-muted" aria-live="polite">
              {t("apiDocs.noMatch", { q: q.trim() })}
            </li>
          )}
          {hits.map((h, i) => (
            <li
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onJump(h.id)}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${i === active ? "bg-glass-2" : "hover:bg-glass"}`}
            >
              <span className="mono-label mt-0.5 grid size-5 flex-none place-items-center rounded-[6px] border border-stroke-2 text-[9.5px] text-brand">{h.n}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-ink">{h.title}</span>
                {h.snippet !== h.title && <span className="mt-0.5 block text-[12px] leading-[1.55] text-muted [overflow-wrap:anywhere]">{h.snippet}</span>}
              </span>
              {i === active && <CornerDownLeft size={13} strokeWidth={1.8} aria-hidden="true" className="mt-1 flex-none text-ink-3" />}
            </li>
          ))}
        </ul>
        <div className="mono-label flex items-center justify-between border-t border-stroke px-3 py-2 text-[9.5px] tracking-[.12em] text-ink-3">
          <span>{t("apiDocs.searchHint")}</span>
          {query && hits.length > 0 && <span aria-live="polite">{t("apiDocs.results", { n: hits.length })}</span>}
        </div>
      </div>
    </div>
  );
}

export default function ApiDocsPage() {
  const t = useT();
  const { lang } = useLang();
  const net = useNetwork();
  const sections = useMemo(() => apiDocs(lang, net), [lang, net]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [flash, setFlash] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const cacheInfo = t("apiDocs.cacheInfo");

  const openSearch = () => {
    if (openRef.current) return;
    returnRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };
  // ⌘K / Ctrl-K opens the search; Escape inside the dialog closes it; focus goes back where it was.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeSearch = () => {
    setOpen(false);
    const back = returnRef.current && document.contains(returnRef.current) ? returnRef.current : openerRef.current;
    requestAnimationFrame(() => back?.focus());
  };
  const jump = (id: string) => {
    setOpen(false);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ block: "start" });
      if (el.tagName === "SECTION") {
        el.querySelector<HTMLElement>("h2")?.focus();
      } else {
        el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      }
      history.replaceState(null, "", `#${id}`);
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 1800);
    });
  };

  // Which section is in view: the last one whose top has passed the sticky header.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      let cur = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 140) cur = s.id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) cur = sections[sections.length - 1]?.id ?? cur;
      setActive(cur);
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  return (
    <Shell>
      <div className="screen-in min-w-0">
        <Link href="/builders" className="mono-label inline-flex items-center gap-1.5 text-[10.5px] tracking-[.16em] text-ink-3 hover:text-brand">
          <ArrowLeft size={12} strokeWidth={1.8} aria-hidden="true" /> {t("apiDocs.back")}
        </Link>
        <header className="glass-panel mt-5 min-w-0 rounded-2xl p-5 nav:p-8">
          <p className="mono-label text-[10.5px] tracking-[.2em] text-ink-3">{t("apiDocs.eyebrow")}</p>
          <h1 className="mt-3 text-[clamp(28px,4.6vw,48px)] font-bold uppercase leading-none tracking-[-1px] text-ink">{t("apiDocs.title")}</h1>
          <p className="mt-3 max-w-[64ch] text-[14.5px] leading-[1.7] text-muted">{t("apiDocs.sub")}</p>
          <button
            ref={openerRef}
            type="button"
            onClick={openSearch}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="mt-5 flex w-full max-w-[520px] items-center gap-2 rounded-[12px] border border-brand/50 bg-glass-2 px-3 py-2.5 text-left text-[14px] text-ink-3 transition-colors hover:border-brand hover:text-ink"
          >
            <Search size={15} strokeWidth={1.8} aria-hidden="true" className="flex-none" />
            <span className="min-w-0 flex-1 truncate">{t("apiDocs.search")}</span>
            <kbd className="mono-label flex-none rounded border border-stroke px-1.5 py-0.5 text-[9.5px] text-ink-3">⌘K</kbd>
          </button>
          <p className="mt-3 text-[12.5px] text-ink-3">{t("apiDocs.netNote", { net: net.chainName })}</p>
        </header>

        <div className="mt-6 grid min-w-0 items-start gap-6 nav:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label={t("apiDocs.onThisPage")} className="glass-panel min-w-0 rounded-2xl p-4 nav:sticky nav:top-24">
            <div className="mono-label text-[10px] tracking-[.16em] text-ink-3">{t("apiDocs.onThisPage")}</div>
            <ol className="mt-3 flex flex-wrap gap-1.5 nav:grid nav:gap-1">
              {sections.map((s, i) => {
                const on = s.id === active;
                return (
                  <li key={s.id} className="min-w-0">
                    <a
                      href={`#${s.id}`}
                      aria-current={on ? "location" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        jump(s.id);
                      }}
                      className={`flex items-center gap-2 rounded-[9px] border px-2.5 py-1.5 text-[12.5px] transition-colors nav:border-transparent nav:px-2 ${
                        on ? "border-brand/60 bg-glass-2 text-ink nav:bg-glass-2" : "border-stroke text-ink-2 hover:text-brand"
                      }`}
                    >
                      <span className={`mono-label text-[10px] ${on ? "text-brand" : "text-ink-3"}`}>{i + 1}</span>
                      <span className="truncate">{s.title}</span>
                    </a>
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 hidden border-t border-stroke pt-3 nav:block">
              <Link href="/builders" className="mono-label inline-flex items-center gap-1.5 text-[10px] tracking-[.14em] text-brand hover:underline">
                {t("apiDocs.builders")} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </div>
          </nav>

          <article className="grid min-w-0 gap-6">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`h-${s.id}`} className="glass-panel min-w-0 scroll-mt-24 rounded-2xl p-5 nav:p-6">
                <h2 id={`h-${s.id}`} tabIndex={-1} className="flex items-center gap-3 text-[20px] font-bold uppercase text-ink outline-none">
                  <span className="grad-fill grid size-7 flex-none place-items-center rounded-[8px] text-[12px]">{i + 1}</span>
                  <span className="min-w-0">{s.title}</span>
                  {s.id === "api" && <Info text={cacheInfo} />}
                </h2>
                {s.blocks.map((b, j) => {
                  const id = blockId(s.id, j);
                  return <Block key={id} b={b} id={id} flash={flash === id} explorer={net.explorer} />;
                })}
              </section>
            ))}
            <div className="flex flex-wrap gap-3">
              <Link href="/builders" className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink hover:border-brand hover:text-brand">
                {t("apiDocs.builders")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
              </Link>
              <Link href="/verify" className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink hover:border-brand hover:text-brand">
                {t("apiDocs.verify")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
              </Link>
              <Link href="/docs" className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink hover:border-brand hover:text-brand">
                {t("apiDocs.learn")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            </div>
          </article>
        </div>
        <Footer />
      </div>
      {open && <SearchDialog sections={sections} onClose={closeSearch} onJump={jump} />}
    </Shell>
  );
}
