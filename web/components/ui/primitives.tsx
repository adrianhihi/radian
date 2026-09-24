"use client";

// Display primitives shared by every rebuilt page: the glass panel, page and
// section heads, stat cells, buttons, the empty state and the footer.
import Link from "next/link";
import { useT, useTDynamic } from "@/components/LangProvider";
import { NAV_FOOTER } from "@/lib/routes";
import { isTestnet, useNetwork } from "@/lib/networks";

/** Glass panel: the one card container. */
export function Panel({ children, className = "", ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={`glass-panel min-w-0 rounded-panel p-5 nav:p-[26px] ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** Title row inside a panel: title left, note or action right. */
export function SectionHead({ title, aside, className = "" }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-[18px] flex items-center justify-between gap-3.5 ${className}`}>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {aside != null && <span className="text-[13px] text-muted">{aside}</span>}
    </div>
  );
}

/** Page head: eyebrow + title + sub, with an optional action on the right. */
export function PageHead({ eyebrow, title, sub, aside }: { eyebrow?: string; title: React.ReactNode; sub?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-[26px] flex items-start justify-between gap-5 nav:items-end">
      <div>
        {eyebrow && <div className="mono-label mb-3 text-xs font-semibold tracking-[.2em] text-brand">{eyebrow}</div>}
        <h1 className="text-[clamp(30px,4vw,42px)] font-[650] leading-[1.3] tracking-[-.5px] text-ink">{title}</h1>
        {sub && <p className="mt-2.5 text-sm leading-[1.7] text-muted">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

export function Footer() {
  const t = useT();
  const td = useTDynamic();
  const net = useNetwork();
  return (
    <footer className="mt-9 border-t border-stroke pt-5 text-xs leading-[1.9] text-ink-3">
      <nav aria-label={t("footer.navAria")} className="mono-label mb-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[10.5px] tracking-[.14em]">
        {NAV_FOOTER.map((n) => (
          <Link key={n.name} href={n.href} className="uppercase text-ink-3 transition-colors hover:text-brand">
            {td(`nav.${n.name}`)}
          </Link>
        ))}
        <a href="https://logo.dev" target="_blank" rel="noreferrer" className="uppercase text-ink-3 transition-colors hover:text-brand">
          {t("footer.logos")}
        </a>
      </nav>
      <div className="flex flex-col justify-between gap-4 nav:flex-row">
        <span>{t("footer.brand")}</span>
        <span>{isTestnet(net) ? t("footer.noteTest") : t("footer.noteLive")}</span>
      </div>
    </footer>
  );
}

/** Stat cell: key metrics, conditions, fee rows. */
export function CondCell({ label, value, sub, small = false }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; small?: boolean }) {
  return (
    <div className="glass-panel min-w-0 rounded-[10px] px-3.5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`tnum mt-[5px] break-words text-ink ${small ? "text-[13px] font-normal" : "text-base font-[550]"}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function CondGrid({ children, className = "" }: React.ComponentProps<"div">) {
  return <div className={`mt-2 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] ${className}`}>{children}</div>;
}

export function OutlineButton({ className = "", ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      className={`rounded-[10px] border border-stroke-2 bg-glass-2 px-3.5 py-[7px] text-[13px] leading-[18px] text-ink backdrop-blur-[10px] transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

export function OutlineLink({ className = "", ...rest }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={`inline-block rounded-[10px] border border-stroke-2 bg-glass-2 px-3.5 py-[7px] text-[13px] leading-[18px] text-ink backdrop-blur-[10px] transition-colors hover:border-brand hover:text-brand ${className}`}
      {...rest}
    />
  );
}

export function PrimaryButton({ className = "", ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      className={`grad-fill w-full rounded-[10px] px-4 py-[15px] text-[15px] font-[550] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    />
  );
}

/** Pill CTA for hero rows. */
export function HeroLink({ ghost = false, className = "", ...rest }: React.ComponentProps<typeof Link> & { ghost?: boolean }) {
  return (
    <Link
      className={`inline-flex min-h-12 items-center gap-2.5 rounded-full px-7 text-[15px] font-[550] transition ${
        ghost ? "border border-stroke-2 bg-transparent text-ink hover:border-brand hover:bg-glass-2 hover:text-brand" : "grad-fill hover:brightness-110"
      } ${className}`}
      {...rest}
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-7 text-center text-sm leading-[1.9] text-muted">{children}</div>;
}
