"use client";

// Step 2 · MARKET & FEES: the paired market (a dollar or a stock), the launch
// template (Standard / The Wall / Proof-of-Fee) with its settings, the fee
// mode for a Standard launch, and the live "where the fee goes" preview.
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Panel, SectionHead } from "@/components/ui/primitives";
import { recipientOk, taxOk, type FeeMode, type LaunchDraft, type TemplateId } from "@/lib/draft";
import type { NetworkConfig } from "@/lib/networks";
import type { QuoteAsset } from "@/lib/radian";
import { StockRef } from "@/components/StockRef";
import { POF_BOUNDS, WALL_BOUNDS, type PoFConfigInput, type WallConfigInput } from "@/lib/templates";
import { fmtNum } from "@/lib/ui/format";
import { ChoiceCard, Field, INPUT_CLASS } from "./Field";
import { FeeSplitPreview } from "./FeeSplitPreview";

export function MarketStep({
  draft,
  quote,
  net,
  templatesLive,
  protocolShareBps,
  maxTaxPct,
  pound,
  onQuote,
  onTemplate,
  onFeeMode,
  onField,
  onWall,
  onPof,
  templateError,
}: {
  draft: LaunchDraft;
  quote: QuoteAsset;
  net: NetworkConfig;
  templatesLive: boolean;
  protocolShareBps: number | null;
  maxTaxPct: number;
  pound: boolean;
  onQuote: (q: QuoteAsset) => void;
  onTemplate: (id: TemplateId) => void;
  onFeeMode: (m: FeeMode) => void;
  onField: (key: "creatorTax" | "feeRecipient", value: string) => void;
  onWall: (patch: Partial<WallConfigInput>) => void;
  onPof: (patch: Partial<PoFConfigInput>) => void;
  /** the template settings' validation message (from buildWallConfig / buildPoFConfig) */
  templateError: string | null;
}) {
  const t = useT();
  const standard = draft.template === "standard";
  const taxErr = !taxOk(draft.creatorTax, maxTaxPct) ? t("create.taxErr", { max: maxTaxPct }) : undefined;
  const recErr = !recipientOk(draft.feeRecipient) ? t("create.recipientErr") : undefined;
  const numCls = `${INPUT_CLASS} tnum`;

  return (
    <>
      <Panel className="mb-6">
        <SectionHead title={t("create.marketTitle")} />
        <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{t("create.marketSub")}</p>
        <div className="grid gap-2.5 min-[620px]:grid-cols-2">
          {net.quoteAssets.map((qa) => (
            <ChoiceCard key={qa.key} on={quote.key === qa.key} onClick={() => onQuote(qa)}>
              <span className="flex items-center gap-2.5">
                <AssetLogo symbol={qa.symbol} ticker={qa.stock?.refSymbol} size={26} radius={13} />
                <b className="text-[15px] text-ink">{qa.symbol}</b>
                {qa.stock && <span className="mono-label rounded-md border border-signal/50 px-1.5 py-px text-[9.5px] tracking-[.1em] text-signal">{t("create.stockTag")}{qa.stock.standIn ? ` · ${t("create.stockTest")}` : ""}</span>}
              </span>
              <span className="text-[12.5px] leading-[1.5] text-muted">{qa.blurb}</span>
              <span className="mono-label text-[10px] tracking-[.08em] text-ink-3">{t("create.goal", { v: fmtNum(qa.gradGoal, 4), sym: qa.symbol })}</span>
            </ChoiceCard>
          ))}
        </div>
        {quote.stock && (
          <div className="mt-4">
            <StockRef asset={quote} />
          </div>
        )}
      </Panel>

      <Panel className="mb-6">
        <SectionHead title={t("create.templateTitle")} />
        <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{t("create.templateSub")}</p>
        <div className="grid gap-2.5">
          {(["standard", "wall", "pof"] as TemplateId[]).map((id) => {
            const needsStock = id === "wall" && !quote.stock;
            const off = id !== "standard" && (!templatesLive || needsStock);
            return (
              <ChoiceCard key={id} on={draft.template === id} off={off} onClick={() => onTemplate(id)} note={off ? (!templatesLive ? t("create.tplNotHere") : t("create.tplNeedsStock")) : undefined}>
                <b className="text-[15px] text-ink">{t(id === "standard" ? "create.tplStandard" : id === "wall" ? "create.tplWall" : "create.tplPof")}</b>
                <span className="text-[12.5px] leading-[1.5] text-muted">{t(id === "standard" ? "create.tplStandardDesc" : id === "wall" ? "create.tplWallDesc" : "create.tplPofDesc")}</span>
              </ChoiceCard>
            );
          })}
        </div>

        {draft.template === "wall" && (
          <div className="mt-5 rounded-[14px] border border-stroke p-4">
            <p className="mb-4 text-[12.5px] leading-[1.7] text-muted">{t("create.wallNote", { sym: quote.symbol, standIn: quote.stock?.standIn ? t("create.wallStandIn") : "" })}</p>
            <div className="grid gap-4 min-[620px]:grid-cols-2">
              <Field id="wall-margin" label={t("create.wallMargin")} aside={`≤ ${WALL_BOUNDS.marginBpsMax / 100}`} hint={t("create.wallMarginHint")}>
                <input id="wall-margin" type="number" min="0" max={WALL_BOUNDS.marginBpsMax / 100} step="0.5" value={draft.wall.marginPct} onChange={(e) => onWall({ marginPct: e.target.value })} className={numCls} />
              </Field>
              <Field id="wall-budget" label={t("create.wallBudget")} aside={`≤ ${WALL_BOUNDS.epochBudgetBpsMax / 100}`} hint={t("create.wallBudgetHint")}>
                <input id="wall-budget" type="number" min="0" max={WALL_BOUNDS.epochBudgetBpsMax / 100} step="1" value={draft.wall.budgetPct} onChange={(e) => onWall({ budgetPct: e.target.value })} className={numCls} />
              </Field>
              <Field id="wall-stream" label={t("create.wallStream")} aside={`≤ ${WALL_BOUNDS.streamBpsMax / 100}`} hint={t("create.wallStreamHint", { sym: quote.symbol })}>
                <input id="wall-stream" type="number" min="0" max={WALL_BOUNDS.streamBpsMax / 100} step="1" value={draft.wall.streamPct} onChange={(e) => onWall({ streamPct: e.target.value })} className={numCls} />
              </Field>
              <Field id="wall-slip" label={t("create.wallSlippage")} aside={`≤ ${WALL_BOUNDS.maxSlippageBpsMax / 100}`} hint={t("create.wallSlippageHint")}>
                <input id="wall-slip" type="number" min="0" max={WALL_BOUNDS.maxSlippageBpsMax / 100} step="0.5" value={draft.wall.slippagePct} onChange={(e) => onWall({ slippagePct: e.target.value })} className={numCls} />
              </Field>
              <Field id="wall-interval" label={t("create.wallInterval")} aside={`≥ ${WALL_BOUNDS.minIntervalMin / 60}`} hint={t("create.wallIntervalHint")}>
                <input id="wall-interval" type="number" min={WALL_BOUNDS.minIntervalMin / 60} step="1" value={draft.wall.minIntervalMin} onChange={(e) => onWall({ minIntervalMin: e.target.value })} className={numCls} />
              </Field>
              <Field id="wall-bounty" label={t("create.wallBounty", { sym: quote.symbol })} hint={t("create.wallBountyHint")}>
                <input id="wall-bounty" type="number" min="0" step="0.001" value={draft.wall.keeperBounty} onChange={(e) => onWall({ keeperBounty: e.target.value })} className={numCls} />
              </Field>
            </div>
          </div>
        )}

        {draft.template === "pof" && (
          <div className="mt-5 rounded-[14px] border border-stroke p-4">
            <p className="mb-4 text-[12.5px] leading-[1.7] text-muted">{t("create.pofNote")}</p>
            <div className="grid gap-4 min-[620px]:grid-cols-2">
              <Field id="pof-round" label={t("create.pofRound")} aside="1–1440" hint={t("create.pofRoundHint")}>
                <input id="pof-round" type="number" min={POF_BOUNDS.roundSecondsMin / 60} max={POF_BOUNDS.roundSecondsMax / 60} step="1" value={draft.pof.roundMin} onChange={(e) => onPof({ roundMin: e.target.value })} className={numCls} />
              </Field>
              <Field id="pof-target" label={t("create.pofTarget", { sym: quote.symbol })} hint={t("create.pofTargetHint")}>
                <input id="pof-target" type="number" min="0" step="0.1" value={draft.pof.targetWork} onChange={(e) => onPof({ targetWork: e.target.value })} className={numCls} />
              </Field>
              <Field id="pof-cap" label={t("create.pofCap")} aside={`≤ ${POF_BOUNDS.maxBuybackReserveBpsMax / 100}`} hint={t("create.pofCapHint")}>
                <input id="pof-cap" type="number" min="0" max={POF_BOUNDS.maxBuybackReserveBpsMax / 100} step="0.5" value={draft.pof.buybackCapPct} onChange={(e) => onPof({ buybackCapPct: e.target.value })} className={numCls} />
              </Field>
              <Field id="pof-interval" label={t("create.pofInterval")} aside={`≥ ${POF_BOUNDS.minIntervalMin / 60}`} hint={t("create.pofIntervalHint")}>
                <input id="pof-interval" type="number" min={POF_BOUNDS.minIntervalMin / 60} step="1" value={draft.pof.minIntervalMin} onChange={(e) => onPof({ minIntervalMin: e.target.value })} className={numCls} />
              </Field>
            </div>
          </div>
        )}
        {templateError && (
          <p role="alert" className="mt-3 text-[12.5px] leading-[1.6] text-neg">
            {templateError}
          </p>
        )}
      </Panel>

      <Panel className="mb-6">
        <SectionHead title={t("create.feeModeTitle")} />
        {standard ? (
          <>
            <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{t("create.feeModeSub")}</p>
            <div className="grid gap-2.5 min-[620px]:grid-cols-2">
              {(["buyback", "creator"] as FeeMode[]).map((m) => (
                <ChoiceCard key={m} on={draft.feeMode === m} onClick={() => onFeeMode(m)}>
                  <b className="text-[15px] text-ink">{t(m === "buyback" ? "create.fmBuyback" : "create.fmCreator")}</b>
                  <span className="text-[12.5px] leading-[1.5] text-muted">{t(m === "buyback" ? "create.fmBuybackDesc" : "create.fmCreatorDesc")}</span>
                </ChoiceCard>
              ))}
            </div>
            {draft.feeMode === "creator" && (
              <div className="mt-4 grid gap-4 min-[620px]:grid-cols-[1fr_1.4fr]">
                <Field id="draft-tax" label={t("create.taxLabel")} hint={t("create.taxHint", { max: maxTaxPct })} error={taxErr}>
                  <input id="draft-tax" type="number" min="0" max={maxTaxPct} step="0.5" value={draft.creatorTax} onChange={(e) => onField("creatorTax", e.target.value)} className={numCls} aria-invalid={!!taxErr} />
                </Field>
                <Field id="draft-recipient" label={t("create.recipientLabel")} error={recErr}>
                  <input id="draft-recipient" type="text" autoComplete="off" spellCheck={false} placeholder={t("create.recipientPh")} value={draft.feeRecipient} onChange={(e) => onField("feeRecipient", e.target.value.trim())} className={`${INPUT_CLASS} font-mono text-[12.5px]`} aria-invalid={!!recErr} />
                </Field>
              </div>
            )}
          </>
        ) : (
          <p className="-mt-3 text-[13px] leading-[1.7] text-muted">{t("create.feeModeTpl", { what: t(draft.template === "wall" ? "create.treasury" : "create.vault") })}</p>
        )}
        <div className="mt-5">
          <FeeSplitPreview template={draft.template} feeMode={draft.feeMode} protocolShareBps={protocolShareBps} pound={pound} creatorTaxPct={standard && draft.feeMode === "creator" ? Number(draft.creatorTax) || 0 : 0} />
        </div>
      </Panel>
    </>
  );
}
