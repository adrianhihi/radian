"use client";

// Terms & risks, on baskvia's legal page layout: back · LEGAL · title ·
// "not advice" · intro · sections · network note · links.
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Shell } from "@/components/shell/Shell";
import { useLang, useT } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import { TERMS } from "@/lib/content/legal";
import { isTestnet, useNetwork } from "@/lib/networks";

export default function TermsPage() {
  const t = useT();
  const { lang } = useLang();
  const net = useNetwork();
  const d = TERMS[lang] ?? TERMS.en;
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
        <p className="mt-3 rounded-[12px] border border-stroke bg-glass-2 px-4 py-3 text-[13px] leading-[1.7] text-muted">
          <b className="text-ink">{net.label}</b> · {isTestnet(net) ? t("legal.netTest") : t("legal.netLive")}
        </p>
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
        <p className="mt-8 text-[13px] text-ink-3">
          {t("legal.seeAlso")}{" "}
          <Link href="/verify" className="text-brand hover:underline">
            {t("nav.verify")}
          </Link>{" "}
          ·{" "}
          <Link href="/factory" className="text-brand hover:underline">
            {t("nav.factory")}
          </Link>{" "}
          ·{" "}
          <Link href="/docs" className="text-brand hover:underline">
            {t("nav.learn")}
          </Link>
        </p>
        <Footer />
      </div>
    </Shell>
  );
}
