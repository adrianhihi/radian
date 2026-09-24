"use client";
import Link from "next/link";
import type { Hex } from "viem";
import { useT } from "@/components/LangProvider";
import type { IdentityResult } from "@/lib/identity";
import { useNetwork } from "@/lib/networks";

// Shown above any action panel. A proven code-hash mismatch is a hard stop;
// "unverified" only informs.
export function IdentityBanner({ identity }: { identity: IdentityResult }) {
  const t = useT();
  if (identity.checked && identity.ok) return null;
  if (!identity.checked && !identity.error) return null; // nothing pinned yet (e.g. mainnet pre-deploy)
  const bad = identity.checked && !identity.ok;
  return (
    <div role="alert" className={`mb-4 rounded-[14px] border px-4 py-3 text-[13px] leading-[1.7] ${bad ? "border-neg/60 bg-[rgba(240,102,90,.1)] text-ink" : "border-stroke bg-glass-2 text-muted"}`}>
      {bad ? (
        <>
          <b className="text-neg">{t("trust.mismatchTitle")}</b>{" "}
          {t("trust.mismatchBody", { names: identity.results.filter((r) => !r.ok).map((r) => r.name).join(", ") })}{" "}
          <Link href="/verify" className="text-brand hover:underline">
            {t("trust.details")}
          </Link>
        </>
      ) : (
        <>
          {t("trust.unverified", { err: identity.error ?? "" })}{" "}
          <Link href="/verify" className="text-brand hover:underline">
            {t("trust.verifyPage")}
          </Link>
        </>
      )}
    </div>
  );
}

// A transaction whose receipt we could not get: recorded, still being checked, never resent.
export function PendingBar({ hash, onClose }: { hash: Hex | null; onClose: () => void }) {
  const t = useT();
  const net = useNetwork();
  if (!hash) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[14px] border border-stroke bg-glass-2 px-4 py-3 text-[13px] leading-[1.7] text-ink-2">
      <span aria-hidden="true" className="inline-block size-3.5 animate-spin rounded-full border-2 border-stroke-2 border-t-brand" />
      <span className="min-w-[220px] flex-1">
        {t("trust.pending")}{" "}
        <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          {t("trust.viewTx")}
        </a>{" "}
        <Link href={`/tx/${hash}`} className="text-brand hover:underline">
          {t("trust.trackTx")}
        </Link>
      </span>
      <button type="button" onClick={onClose} className="mono-label text-[10.5px] tracking-[.1em] text-ink-3 hover:text-ink">
        {t("trust.hide")}
      </button>
    </div>
  );
}

/** The active network is not live yet: read pages say so instead of showing empty tables. */
export function NotLive() {
  const t = useT();
  const net = useNetwork();
  if (net.live) return null;
  return (
    <div className="my-6 rounded-[16px] border border-brand/40 bg-[image:var(--grad-soft)] px-6 py-5 text-center">
      <h3 className="text-[18px] font-bold text-ink">{t("trust.notLiveTitle", { chain: net.label })}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.7] text-muted">{t("trust.notLiveBody")}</p>
    </div>
  );
}
