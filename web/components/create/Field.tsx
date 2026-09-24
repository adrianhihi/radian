"use client";

// Form field shells for the wizard: one look for every input, a label above,
// an optional hint or error below.

export const INPUT_CLASS = "w-full rounded-[10px] border border-stroke-2 bg-[rgba(255,238,220,.04)] px-3.5 py-3 text-ink outline-none placeholder:text-ink-3 focus-visible:border-brand disabled:opacity-50";

export function Field({ id, label, hint, error, children, aside }: { id: string; label: React.ReactNode; hint?: React.ReactNode; error?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[13px] leading-[1.6] text-muted">
          {label}
        </label>
        {aside && <span className="mono-label text-[10.5px] text-ink-3">{aside}</span>}
      </div>
      {children}
      {error ? <small className="block text-[12.5px] leading-[1.6] text-neg">{error}</small> : hint ? <small className="block text-[12.5px] leading-[1.6] text-ink-3">{hint}</small> : null}
    </div>
  );
}

/** Two fields side by side above 720px, stacked below. */
export function FieldRow({ children, cols = "even" }: { children: React.ReactNode; cols?: "even" | "wide" }) {
  return <div className={`grid grid-cols-1 gap-4 ${cols === "even" ? "min-[720px]:grid-cols-2" : "min-[720px]:grid-cols-[1fr_170px]"}`}>{children}</div>;
}

/** A selectable card (quote asset, template, fee mode). */
export function ChoiceCard({ on, off, note, onClick, children, className = "" }: { on: boolean; off?: boolean; note?: React.ReactNode; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={off}
      onClick={onClick}
      className={`flex flex-col gap-1.5 rounded-[14px] border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "border-brand bg-[rgba(232,148,76,.08)] shadow-[inset_0_0_0_1px_var(--brand)]" : "border-stroke bg-glass-2 hover:border-stroke-2"
      } ${className}`}
    >
      {children}
      {note && <span className="mono-label mt-1 text-[10px] tracking-[.1em] text-ink-3">{note}</span>}
    </button>
  );
}
