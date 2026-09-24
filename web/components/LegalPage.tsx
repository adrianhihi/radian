"use client";

// One layout for the legal pages (Terms, Privacy, Risk), on baskvia's legal
// skeleton: back · LEGAL · title · "not advice" · intro · sections · an optional
// network note · the see-also line. The documents themselves live in
// lib/content/legal.ts in both languages.
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell/Shell";
import { useLang, useT } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import type { LegalDoc } from "@/lib/content/legal";
import { isTestnet, useNetwork } from "@/lib/networks";

export function LegalPage({ doc, showNetwork = false, children }: { doc: { en: LegalDoc; zh: LegalDoc }; showNetwork?: boolean; children?: ReactNode }) {
  const t = useT();
  const { lang } = useLang();
  const net = useNetwork();
  const d = doc[lang] ?? doc.en;
  return (
    <Shell>
      <div className="screen-in mx-auto max-w-[760px]">
        <Link href="/" className="mono-label inline-flex items-center gap-1.5 text-[10.5px] tracking-[.16em] text-ink-3 hover:text-brand">
          <ArrowLeft size={12} strokeWidth={1.8} aria-hidden="true" /> {t("legal.back")}
        </Link>
        <p className="mono-label mt-8 text-[10.5px] tracking-[.2em] text-ink-3">{t("legal.eyebrow")}</p>
        <h1 className="mt-2 text-[clamp(34px,5vw,54px)] font-bold uppercase leading-none tracking-[-1px] text-ink">{d.title}</h1>
        <p className="mono-label mt-4 text-[10.5px] tracking-[.14em] text-ink-3">{t("legal.notAdvice")}</p>
        <p className="mt-5 text-[16px] leading-[1.75] text-ink-2">{d.intro}</p>
        {showNetwork && (
          <p className="mt-3 rounded-[12px] border border-stroke bg-glass-2 px-4 py-3 text-[13px] leading-[1.7] text-muted">
            <b className="text-ink">{net.label}</b> · {isTestnet(net) ? t("legal.netTest") : t("legal.netLive")}
          </p>
        )}
        <div className="mt-8 grid gap-7">
          {d.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-[18px] font-semibold text-ink">{s.h}</h2>
              {s.p.map((x, i) => (
                <p key={i} className="mt-2 text-[14.5px] leading-[1.8] text-muted">
                  {x}
                </p>
              ))}
            </section>
          ))}
        </div>
        {children}
        <Footer />
      </div>
    </Shell>
  );
}

/** "See also: A · B · C" under a legal document. */
export function SeeAlso({ links }: { links: { href: string; label: string }[] }) {
  const t = useT();
  return (
    <p className="mt-8 text-[13px] text-ink-3">
      {t("legal.seeAlso")}{" "}
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && " · "}
          <Link href={l.href} className="text-brand hover:underline">
            {l.label}
          </Link>
        </span>
      ))}
    </p>
  );
}
