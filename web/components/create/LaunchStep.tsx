"use client";

// Step 3 · LAUNCH: the summary, the checks, the optional first buy, the
// acknowledgement and the button. Everything the transaction will fix on chain
// is on this screen, so nothing is signed unseen.
import { Check } from "lucide-react";
import { formatUnits } from "viem";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Panel, SectionHead } from "@/components/ui/primitives";
import { amountOk, type LaunchDraft } from "@/lib/draft";
import type { TKey } from "@/lib/i18n";
import type { NetworkConfig } from "@/lib/networks";
import type { QuoteAsset } from "@/lib/radian";
import { fmtNum } from "@/lib/ui/format";
import { Field, INPUT_CLASS } from "./Field";
import { FeeSplitPreview } from "./FeeSplitPreview";

export type LaunchCheck = { key: TKey; ok: boolean };

export function LaunchStep({
  draft,
  quote,
  net,
  checks,
  launchFee,
  protocolShareBps,
  pound,
  ack,
  onAck,
  onFirstBuy,
  onLaunch,
  busy,
  status,
  authenticated,
  launchesClosed,
}: {
  draft: LaunchDraft;
  quote: QuoteAsset;
  net: NetworkConfig;
  checks: LaunchCheck[];
  launchFee: bigint;
  protocolShareBps: number | null;
  pound: boolean;
  ack: boolean;
  onAck: (v: boolean) => void;
  onFirstBuy: (v: string) => void;
  onLaunch: () => void;
  busy: boolean;
  status: string | null;
  authenticated: boolean;
  launchesClosed: boolean;
}) {
  const t = useT();
  const logoUrl = /^https?:\/\//.test(draft.logo) ? draft.logo : null;
  const allOk = checks.every((c) => c.ok);
  const buyErr = !amountOk(draft.firstBuy) ? t("create.firstBuyErr") : undefined;
  const ready = allOk && ack && !busy && !buyErr && !launchesClosed;
  const feeLine = `${formatUnits(launchFee, 18)} ${net.nativeSymbol ?? "USDC"}`;
  const tplLabel = t(draft.template === "wall" ? "create.tplWall" : draft.template === "pof" ? "create.tplPof" : "create.tplStandard");
  const feeModeLabel = draft.template !== "standard" ? `${t("create.fmCreator")} → ${t(draft.template === "wall" ? "create.treasury" : "create.vault")}` : t(draft.feeMode === "buyback" ? "create.fmBuyback" : "create.fmCreator");
  const row = "flex justify-between gap-3 border-b border-stroke py-[7px] text-[13px] last:border-b-0";

  return (
    <Panel className="mb-6">
      <SectionHead title={t("create.checksTitle")} />

      <div className="rounded-[14px] border border-stroke bg-glass-2 p-4">
        <div className="flex items-center gap-3">
          <AssetLogo symbol={draft.symbol || "?"} src={logoUrl} seed={draft.symbol || "draft"} size={44} radius={22} />
          <span className="min-w-0">
            <b className="block truncate text-[18px] leading-tight text-ink">${draft.symbol}</b>
            <span className="block truncate text-[13px] text-ink-2">{draft.name}</span>
          </span>
        </div>
        <div className="mt-3">
          <div className={row}>
            <span className="text-muted">{t("create.summaryMarket")}</span>
            <span className="text-ink">{quote.symbol}{quote.stock ? ` · ${quote.stock.refSymbol}` : ""}</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("create.summaryTemplate")}</span>
            <span className="text-ink">{tplLabel}</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("create.summaryFeeMode")}</span>
            <span className="text-ink">{feeModeLabel}{draft.template === "standard" && draft.feeMode === "creator" && Number(draft.creatorTax) > 0 ? ` · +${draft.creatorTax}% ${t("trade.creatorTax")}` : ""}</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("create.summarySupply")}</span>
            <span className="tnum text-ink">1,000,000,000</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("create.summaryGoal")}</span>
            <span className="tnum text-ink">{fmtNum(quote.gradGoal, 4)} {quote.symbol}</span>
          </div>
          <div className={row}>
            <span className="text-muted">{t("create.summaryFirstBuy")}</span>
            <span className="tnum text-ink">{draft.firstBuy && Number(draft.firstBuy) > 0 ? `${draft.firstBuy} ${quote.symbol}` : "—"}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <FeeSplitPreview template={draft.template} feeMode={draft.feeMode} protocolShareBps={protocolShareBps} pound={pound} creatorTaxPct={draft.template === "standard" && draft.feeMode === "creator" ? Number(draft.creatorTax) || 0 : 0} />
      </div>

      <ul className="mt-5 grid gap-1.5">
        {checks.map((c) => (
          <li key={c.key} className={`flex items-center gap-2 text-[13px] ${c.ok ? "text-ink-2" : "text-ink-3"}`}>
            <span className={`grid size-5 flex-none place-items-center rounded-full border ${c.ok ? "border-pos/60 text-pos" : "border-stroke"}`}>{c.ok && <Check size={11} strokeWidth={2.4} aria-hidden="true" />}</span>
            {t(c.key)}
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <Field id="draft-first-buy" label={t("create.firstBuyLabel")} hint={t("create.firstBuyHint")} error={buyErr}>
          <div className="flex items-center rounded-[10px] border border-stroke-2 bg-[rgba(255,238,220,.04)] px-3.5 focus-within:border-brand">
            <input id="draft-first-buy" type="text" inputMode="decimal" autoComplete="off" placeholder="0.00" value={draft.firstBuy} onChange={(e) => onFirstBuy(e.target.value)} className="tnum min-w-0 flex-1 bg-transparent py-3 text-[16px] text-ink outline-none" aria-invalid={!!buyErr} />
            <span className="mono-label text-[11px] text-ink-3">{quote.symbol}</span>
          </div>
        </Field>
      </div>

      <label className={`mt-4 flex items-start gap-3 rounded-xl border p-4 text-[12.5px] leading-[1.7] text-muted ${ack ? "border-brand/50" : "border-stroke"}`}>
        <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} className="mt-1 size-4 accent-[var(--brand)]" />
        {t("create.ack")}
      </label>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-stroke bg-glass-2 p-5">
        <div className="min-w-0">
          <b className="block text-[clamp(20px,2.4vw,26px)] font-bold uppercase text-ink">{t("create.ready", { sym: draft.symbol || "…" })}</b>
          <span className="mono-label text-[10.5px] tracking-[.12em] text-ink-3">{t("create.launchFeeLine", { fee: feeLine })}</span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button type="button" disabled={authenticated ? !ready : busy || launchesClosed} onClick={onLaunch} className="grad-fill mono-label inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-[14px] font-semibold tracking-[.16em] disabled:opacity-40">
            {busy ? t("create.launching") : authenticated ? t("create.launchBtn", { fee: feeLine }) : t("create.launchSignIn")}
          </button>
          {busy && status ? (
            <span role="status" className="text-right text-[11.5px] text-muted">
              {status}
            </span>
          ) : authenticated && !ack && allOk ? (
            <span className="text-[11.5px] text-ink-3">{t("create.needAck")}</span>
          ) : null}
        </div>
      </div>

      {launchesClosed && <p className="mt-3 text-[12.5px] leading-[1.7] text-muted">{t("create.closed", { chain: net.label })}</p>}
      {!net.live && <p className="mt-3 text-[12.5px] leading-[1.7] text-muted">{t("create.notLive")}</p>}
      {net.key === "testnet" && (
        <p className="mt-3 text-center text-[12px] text-ink-3">
          {t("create.faucetCircle")}{" "}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-brand hover:underline">
            {t("create.faucetLink")}
          </a>
        </p>
      )}
      {net.key === "robinhood-testnet" && (
        <p className="mt-3 text-center text-[12px] text-ink-3">
          {t("create.faucetQn")}{" "}
          <a href="https://faucet.quicknode.com/robinhood/testnet" target="_blank" rel="noreferrer" className="text-brand hover:underline">
            {t("create.faucetQnLink")}
          </a>{" "}
          {t("create.faucetQnNote")}
        </p>
      )}
    </Panel>
  );
}
