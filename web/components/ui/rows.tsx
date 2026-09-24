"use client";

// Small pieces the per-launch panels share: a titled head with a contract
// link, key/value rows, a hairline, a note, a chip group and a spinner.
import { ExternalLink } from "lucide-react";
import { useT } from "@/components/LangProvider";
import { shortAddr } from "@/lib/ui/format";

export function PanelHead({ title, aside, address, explorer, label }: { title: React.ReactNode; aside?: React.ReactNode; address?: string; explorer?: (a: string) => string; label?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      {aside ?? (address && explorer ? (
        <a href={explorer(address)} target="_blank" rel="noreferrer" className="mono-label inline-flex items-center gap-1 text-[10.5px] tracking-[.08em] text-ink-3 hover:text-brand">
          {label ? `${label} ` : ""}
          {shortAddr(address)} <ExternalLink size={10} strokeWidth={1.8} aria-hidden="true" />
        </a>
      ) : null)}
    </div>
  );
}

export function Row({ label, value, tone, small = false }: { label: React.ReactNode; value: React.ReactNode; tone?: "pos" | "neg" | "muted"; small?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-stroke py-[7px] last:border-b-0 ${small ? "text-[12.5px]" : "text-[13px]"}`}>
      <span className="text-muted">{label}</span>
      <span className={`tnum text-right ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "muted" ? "text-ink-2 font-normal" : "text-ink font-[550]"}`}>{value}</span>
    </div>
  );
}

export function Divider() {
  return <div className="my-2.5 h-px bg-stroke" aria-hidden="true" />;
}

export function Note({ children, tone, className = "", role }: { children: React.ReactNode; tone?: "neg"; className?: string; role?: "status" | "alert" }) {
  return (
    <p role={role} className={`text-[12px] leading-[1.6] ${tone === "neg" ? "text-neg" : "text-ink-3"} ${className}`}>
      {children}
    </p>
  );
}

/** A row of exclusive chips (intervals, caps, assets). */
export function ChipGroup<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-md border border-stroke bg-glass-2 p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={`tnum rounded px-2.5 py-1 text-[11.5px] ${value === o.value ? "bg-glass-hi text-ink" : "text-ink-3 hover:text-ink-2"}`}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A ring spinner. With `label` it is announced (`role="status"`); without, it is decoration next to text. */
export function Spinner({ size = 14, label }: { size?: number; label?: string }) {
  const a11y = label ? { role: "status" as const, "aria-label": label } : { "aria-hidden": true as const };
  return <span {...a11y} className="inline-block animate-spin rounded-full border-2 border-stroke-2 border-t-brand" style={{ width: size, height: size }} />;
}

/** A small "sign in" fallback for panels that act on the wallet. */
export function SignInButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick} className="w-full rounded-[10px] border border-stroke-2 bg-glass-2 px-3.5 py-2.5 text-[13px] text-ink transition-colors hover:border-brand hover:text-brand">
      {label ?? t("wallet.connect")}
    </button>
  );
}
