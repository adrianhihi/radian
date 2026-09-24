"use client";

// Live "where the fee goes" strip: one segment per party, the list underneath,
// and what The Pound does with its half where it runs.
import { useT } from "@/components/LangProvider";
import type { FeeMode, TemplateId } from "@/lib/draft";
import { ROLE_COLOR, feeSplit, type SplitRole } from "@/lib/feeSplit";
import type { TKey } from "@/lib/i18n";

const ROLE_LABEL: Record<SplitRole, TKey> = {
  you: "create.roleYou",
  buyback: "create.roleBuyback",
  treasury: "create.roleTreasury",
  vault: "create.roleVault",
  pound: "create.rolePound",
  protocol: "create.roleProtocol",
};

export function FeeSplitPreview({
  template,
  feeMode,
  protocolShareBps,
  pound,
  creatorTaxPct = 0,
  feePct = 1,
}: {
  template: TemplateId;
  feeMode: FeeMode;
  protocolShareBps: number | null | undefined;
  pound: boolean;
  creatorTaxPct?: number;
  feePct?: number;
}) {
  const t = useT();
  const rows = feeSplit(template, feeMode, protocolShareBps, pound);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  return (
    <div className="rounded-xl border border-stroke bg-glass-2 p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="mono-label text-[11px] tracking-[.08em] text-ink-3">{t("create.splitTitle")}</span>
        <span className="text-[11px] text-ink-3">{t("create.splitCaption", { fee: feePct })}</span>
      </div>
      <div className="mb-2.5 flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.role} style={{ width: `${r.pct}%`, background: ROLE_COLOR[r.role] }} />
        ))}
      </div>
      <ul className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.role} className="flex items-center gap-2 text-[13px]">
            <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: ROLE_COLOR[r.role] }} />
            <span className="flex-1 text-ink-2">{t(ROLE_LABEL[r.role])}</span>
            <span className="tnum text-ink">{fmt(r.pct)}%</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] leading-[1.7] text-muted">
        {pound ? t("create.splitPoundNote") : t("create.splitProtocolNote")}
        {creatorTaxPct > 0 && ` ${t("create.splitTaxNote", { v: creatorTaxPct })}`}
      </p>
    </div>
  );
}
