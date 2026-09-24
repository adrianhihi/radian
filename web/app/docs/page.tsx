"use client";

// Learn, on baskvia's /learn skeleton: head · this page's contents · the four
// steps · launching · the details (searchable, tag-filtered accordion) · Q&A
// with anchors · the contracts for this network · bottom links. Copy lives in
// lib/content/learn.ts; live numbers and addresses come from the network.
import { ArrowRight, ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useLang, useT } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import { LEARN, type DetailItem, type LearnTag } from "@/lib/content/learn";
import type { TKey } from "@/lib/i18n";
import { useNetwork } from "@/lib/networks";

const STEPS: [TKey, TKey][] = [
  ["learn.step1Title", "learn.step1Body"],
  ["learn.step2Title", "learn.step2Body"],
  ["learn.step3Title", "learn.step3Body"],
  ["learn.step4Title", "learn.step4Body"],
];
const ZERO = "0x0000000000000000000000000000000000000000";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-|-$/g, "");

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="mono-label inline-block rounded-full border border-stroke-2 px-3 py-1 text-[10px] tracking-[.16em] text-ink-3">{children}</span>;
}

function TwoLine({ id, a, b }: { id?: string; a: string; b: string }) {
  return (
    <h2 id={id} className="mt-4 text-[clamp(28px,4vw,46px)] font-bold leading-[1.08] tracking-[-1px] text-ink">
      {a}
      <br />
      <span className="bg-[image:var(--brand-grad)] bg-clip-text text-transparent">{b}</span>
    </h2>
  );
}

export default function LearnPage() {
  const t = useT();
  const { lang } = useLang();
  const net = useNetwork();
  const c = LEARN[lang] ?? LEARN.en;
  const pound = !!net.pound;
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<LearnTag | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const all = c.detail.items.filter((it) => !it.when || (it.when === "pound") === pound);
  const items = all.filter((it) => (tag === "all" || it.tag === tag) && (!query || [it.kicker, it.title, ...it.body].join(" ").toLowerCase().includes(query)));
  const toggle = (k: string) => setOpen((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  const contracts: [string, string][] = [
    ["LaunchFactory", net.contracts.factory],
    ["MemeHook (Uniswap V4)", net.contracts.hook],
    ["BuybackVault", net.contracts.vault],
    ["LaunchLocker", net.contracts.locker],
    ["FeeEscrow", net.contracts.escrow],
    ["PoolManager (Uniswap V4)", net.contracts.poolManager],
    ["LaunchRouter", net.contracts.router],
    ["PoFRouter", net.contracts.pofRouter],
    ["RadianExecutor", net.contracts.executor],
    ...(net.pound ? ([["PoundVault", net.pound.vault], ["PackBurner", net.pound.burner]] as [string, string][]) : []),
  ].filter(([, a]) => a && a !== ZERO) as [string, string][];

  return (
    <Shell>
      <div className="screen-in">
        <header className="pt-8 text-center">
          <Eyebrow>{c.eyebrow}</Eyebrow>
          <h1 className="mt-6 text-[clamp(38px,6.4vw,76px)] font-bold leading-[1.02] tracking-[-2px] text-ink">
            {c.title[0]}
            <br />
            <span className="bg-[image:var(--brand-grad)] bg-clip-text text-transparent">{c.title[1]}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[44ch] text-[16px] leading-[1.7] text-ink-2">{c.sub}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {(["/explore", "/create", "/earn"] as const).map((href, i) => (
              <Link key={href} href={href} className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink hover:border-brand hover:text-brand">
                {c.ctas[i]} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </header>

        <nav aria-label={c.toc} className="glass-panel mx-auto mt-12 max-w-[760px] rounded-2xl px-5 py-4">
          <div className="mono-label text-[10px] tracking-[.16em] text-ink-3">{c.toc}</div>
          <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-[13.5px] min-[520px]:grid-cols-2">
            {c.tocItems.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-ink-2 hover:text-brand">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section id="how" aria-labelledby="h-how" className="mt-20 scroll-mt-24">
          <Eyebrow>{c.how.eyebrow}</Eyebrow>
          <TwoLine id="h-how" a={c.how.title[0]} b={c.how.title[1]} />
          <ol className="mt-8 grid gap-4 min-[620px]:grid-cols-2 nav:grid-cols-4">
            {STEPS.map(([h, p], i) => (
              <li key={h} className="glass-panel flex flex-col rounded-2xl p-5">
                <span className="mono-label text-[10px] text-ink-3">0{i + 1}</span>
                <h3 className="mt-3 text-[14px] font-bold uppercase tracking-[.04em] text-ink">{t(h)}</h3>
                <p className="mt-2 text-[12.5px] leading-[1.7] text-muted">{t(p)}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="launching" aria-labelledby="h-launch" className="mt-20 scroll-mt-24">
          <Eyebrow>{c.launch.eyebrow}</Eyebrow>
          <TwoLine id="h-launch" a={c.launch.title[0]} b={c.launch.title[1]} />
          <p className="mt-4 max-w-[62ch] text-[15px] leading-[1.7] text-muted">{c.launch.body}</p>
          <div className="mt-8 grid gap-4 nav:grid-cols-3">
            {c.launch.cards.map(([h, p]) => (
              <article key={h} className="glass-panel rounded-2xl p-6">
                <span className="block h-0.5 w-12 rounded bg-brand/70" aria-hidden="true" />
                <h3 className="mt-5 text-[16px] font-bold uppercase leading-[1.35] text-ink">{h}</h3>
                <p className="mt-3 text-[13.5px] leading-[1.7] text-muted">{p}</p>
              </article>
            ))}
          </div>
          <Link href="/create" className="mono-label mt-6 inline-flex items-center gap-2 rounded-full border border-stroke-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink hover:border-brand hover:text-brand">
            {c.launch.cta} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </section>

        <section id="detail" aria-labelledby="h-detail" className="mx-auto mt-24 max-w-[780px] scroll-mt-24">
          <Eyebrow>{c.detail.eyebrow}</Eyebrow>
          <h2 id="h-detail" className="mt-4 text-[clamp(26px,3.4vw,38px)] font-bold tracking-[-.5px] text-ink">
            {c.detail.title}
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-muted">{c.detail.body}</p>
          <label className="mt-6 flex items-center gap-2 rounded-[12px] border border-stroke-2 bg-glass-2 px-3 py-2.5">
            <Search size={15} strokeWidth={1.8} aria-hidden="true" className="text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.detail.search} aria-label={c.detail.search} className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none" />
          </label>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group">
            {(Object.keys(c.detail.tags) as (LearnTag | "all")[])
              .filter((k) => k !== "pound" || pound)
              .map((k) => (
                <button key={k} type="button" aria-pressed={tag === k} onClick={() => setTag(k)} className={`mono-label rounded-full border px-3 py-1 text-[10px] tracking-[.12em] ${tag === k ? "border-brand text-brand" : "border-stroke text-ink-3 hover:text-ink-2"}`}>
                  {c.detail.tags[k]}
                </button>
              ))}
          </div>
          <div className="glass-panel mt-4 divide-y divide-stroke rounded-2xl px-5">
            {items.length === 0 && <p className="py-6 text-center text-[13.5px] text-muted">{c.detail.noMatch.replace("{q}", q)}</p>}
            {items.map((it: DetailItem) => {
              const i = all.indexOf(it);
              const k = `d${i}`;
              const isOpen = open.has(k) || !!query;
              return (
                <div key={k}>
                  <button type="button" aria-expanded={isOpen} onClick={() => toggle(k)} className="flex w-full items-center gap-3 py-4 text-left">
                    <span className="mono-label flex-none text-[9.5px] tracking-[.14em] text-ink-3">
                      {String(i + 1).padStart(2, "0")} · {it.kicker}
                    </span>
                    <span className="min-w-0 flex-1 text-[15.5px] font-semibold text-ink">{it.title}</span>
                    <span className="grid size-7 flex-none place-items-center rounded-full border border-stroke-2 text-ink-3">
                      <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="pb-5">
                      {it.body.map((p, j) => (
                        <p key={j} className="mt-2 text-[14px] leading-[1.75] text-muted first:mt-0">
                          {p}
                        </p>
                      ))}
                      {it.link && (
                        <Link href={it.link.href} className="mono-label mt-3 inline-flex items-center gap-1.5 text-[10.5px] tracking-[.14em] text-brand hover:underline">
                          {it.link.label} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section id="qa" aria-labelledby="h-qa" className="mx-auto mt-20 max-w-[780px] scroll-mt-24">
          <Eyebrow>{c.qa.eyebrow}</Eyebrow>
          <h2 id="h-qa" className="mt-4 text-[clamp(26px,3.4vw,38px)] font-bold tracking-[-.5px] text-ink">
            {c.qa.title}
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-muted">
            {c.qa.body}{" "}
            <Link href="/terms" className="text-brand hover:underline">
              {t("nav.terms")} →
            </Link>
          </p>
          <div className="mt-6 grid gap-6">
            {c.qa.groups.map((g) => (
              <div key={g.name}>
                <h3 className="mono-label flex items-center gap-2 text-[10.5px] tracking-[.16em] text-ink-3">
                  {g.name} <span className="rounded-full bg-glass-2 px-1.5 text-ink-2">{g.items.length}</span>
                </h3>
                <div className="glass-panel mt-2 divide-y divide-stroke rounded-2xl px-5">
                  {g.items.map((it) => {
                    const id = `q-${slug(it.q)}`;
                    const isOpen = open.has(id);
                    return (
                      <div key={id} id={id} className="scroll-mt-24">
                        <div className="flex items-center gap-3">
                          <button type="button" aria-expanded={isOpen} onClick={() => toggle(id)} className="flex min-w-0 flex-1 items-center gap-3 py-3.5 text-left">
                            <span className="min-w-0 flex-1 text-[14.5px] text-ink">{it.q}</span>
                            <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" className={`flex-none text-ink-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                          </button>
                          <a href={`#${id}`} aria-label={it.q} className="text-[12px] text-ink-3 hover:text-brand">
                            #
                          </a>
                        </div>
                        {isOpen && <p className="pb-4 text-[13.5px] leading-[1.75] text-muted">{it.a}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="contracts" aria-labelledby="h-contracts" className="mx-auto mt-20 max-w-[780px] scroll-mt-24">
          <Eyebrow>{net.chainName}</Eyebrow>
          <h2 id="h-contracts" className="mt-4 text-[clamp(26px,3.4vw,38px)] font-bold tracking-[-.5px] text-ink">
            {c.contracts.title}
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-muted">{c.contracts.body}</p>
          <ul className="glass-panel mt-4 divide-y divide-stroke rounded-2xl px-5">
            {contracts.map(([label, a]) => (
              <li key={label} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
                <span className="text-ink-2">{label}</span>
                <a href={`${net.explorer}/address/${a}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-brand hover:underline">
                  {a.slice(0, 10)}…{a.slice(-8)}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/verify" className="mono-label mt-4 inline-flex items-center gap-1.5 text-[10.5px] tracking-[.14em] text-brand hover:underline">
            {c.contracts.verify} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </section>

        <nav className="mt-16 flex flex-wrap justify-center gap-3">
          {c.footer.map(([href, label]) => (
            <Link key={href} href={href} className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink-2 hover:border-brand hover:text-brand">
              {label} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
            </Link>
          ))}
        </nav>

        <Footer />
      </div>
    </Shell>
  );
}
