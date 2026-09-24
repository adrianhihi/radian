"use client";

// The trade form's visual shell: pay card / flip button / receive card / pills.
// Used by the full form on /swap and the token page, and by the compact quick
// buy on Explore in spirit (that one keeps its own single-card shape). Only the
// look lives here; amounts, quotes and when a send happens are the caller's.
import type { InputHTMLAttributes, ReactNode } from "react";

const CARD = "rounded-xl border border-stroke-2 bg-[rgba(255,238,220,.04)] p-4";

/** Pay card: label + balance on top, the big amount input below, the asset pill on the right. */
export function PayCard({
  label,
  inputId,
  balance,
  inputProps,
  trailing,
}: {
  label: string;
  inputId: string;
  /** top-right: the wallet's balance of what is being paid */
  balance: ReactNode;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  trailing: ReactNode;
}) {
  return (
    <div className={`${CARD} focus-within:border-brand`}>
      <div className="mb-1.5 flex items-center justify-between gap-2.5 text-xs text-muted">
        <label htmlFor={inputId}>{label}</label>
        <span className="tnum">{balance}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          {...inputProps}
          className="tnum w-full min-w-0 border-0 bg-transparent text-[28px] tracking-[-.5px] text-ink outline-none"
        />
        {trailing}
      </div>
    </div>
  );
}

/** The button between the two cards: swaps buy and sell. */
export function FlipButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="relative z-10 -my-2.5 flex justify-center">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="grid size-9 place-items-center rounded-full border border-stroke-2 bg-night text-ink-2 transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>
    </div>
  );
}

/** Receive card: the quoted amount, not editable. */
export function ReceiveCard({ label, value, trailing }: { label: string; value: ReactNode; trailing: ReactNode }) {
  return (
    <div className={CARD}>
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      <div className="flex items-center gap-2.5">
        <span className="tnum w-full min-w-0 truncate text-[28px] tracking-[-.5px] text-ink">{value}</span>
        {trailing}
      </div>
    </div>
  );
}

/** Static pill: the quote asset, or the locked token. */
export function TokenPill({ children }: { children: ReactNode }) {
  return <span className="mono-label flex-shrink-0 rounded-full border border-stroke-2 bg-glass-2 px-3 py-1.5 text-[11px] text-ink-2">{children}</span>;
}

/** One quote line: label left, value right. */
export function QuoteLine({ label, value, muted = false }: { label: ReactNode; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={`tnum text-right ${muted ? "text-ink-2" : "text-ink"}`}>{value}</span>
    </div>
  );
}
