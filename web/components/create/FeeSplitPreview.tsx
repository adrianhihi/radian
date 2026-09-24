"use client";

// Live "where the fee goes" strip: one segment per party, then the list with two
// denominators — a share of the fee and what that is of every trade — so nobody
// has to multiply by the fee rate themselves. Each party carries a one-line note
// on when it is paid. The creator tax, where set, is on top of the fee.
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
const ROLE_NOTE: Record<SplitRole, TKey> = {
  you: "create.noteYou",
  buyback: "create.noteBuyback",
  treasury: "create.noteTreasury",
  vault: "create.noteVault",
  pound: "create.notePound",
  protocol: "create.noteProtocol",
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
  /** the curve's trade fee, in percent of a trade */
  feePct?: number;
}) {
  const t = useT();
  const rows = feeSplit(template, feeMode, protocolShareBps, pound);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const ofTrade = (pct: number) => `${((pct * feePct) / 100).toFixed(2)}%`;
  const you = rows.find((r) => r.role === "you")?.pct ?? 0;
  const holders = rows.filter((r) => r.role !== "you").reduce((s, r) => s + r.pct, 0);
  return (
    <div className="rounded-xl border border-stroke bg-glass-2 p-3.5">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="mono-label text-[11px] tracking-[.08em] text-ink-3">{t("create.splitTitle")}</span>
        <span className="text-[11px] text-ink-3">{t("create.splitCaption", { fee: feePct })}</span>
      </div>
      <div className="mb-2.5 flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.role} title={`${t(ROLE_LABEL[r.role])} ${fmt(r.pct)}%`} style={{ width: `${r.pct}%`, background: ROLE_COLOR[r.role] }} />
        ))}
      </div>
      {you > 0 && (
        <p className="mb-2.5 text-[13px] text-ink">
          {t("create.splitSummary", { you: fmt(you), trade: ofTrade(you), rest: fmt(holders) })}
          {creatorTaxPct > 0 && ` ${t("create.splitTaxNote", { v: creatorTaxPct })}`}
        </p>
      )}
      <ul className="grid gap-1.5">
        <li className="mono-label flex items-center gap-2 text-[9.5px] tracking-[.1em] text-ink-3" aria-hidden="true">
          <span className="size-2.5 flex-none" />
          <span className="flex-1" />
          <span className="w-[62px] text-right">{t("create.ofFee")}</span>
          <span className="w-[68px] text-right">{t("create.ofTrade")}</span>
        </li>
        {rows.map((r) => (
          <li key={r.role} className="flex items-center gap-2 text-[13px]">
            <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: ROLE_COLOR[r.role] }} />
            <span className="min-w-0 flex-1">
              <span className="text-ink-2">{t(ROLE_LABEL[r.role])}</span>
              <span className="block truncate text-[11px] text-ink-3">{t(ROLE_NOTE[r.role])}</span>
            </span>
            <span className="tnum w-[62px] text-right text-ink">{fmt(r.pct)}%</span>
            <span className="tnum w-[68px] text-right text-ink-2">{ofTrade(r.pct)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[12px] leading-[1.7] text-muted">
        {pound ? t("create.splitPoundNote") : t("create.splitProtocolNote")}
        {you === 0 && creatorTaxPct > 0 && ` ${t("create.splitTaxNote", { v: creatorTaxPct })}`}
      </p>
    </div>
  );
}
