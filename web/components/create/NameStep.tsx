"use client";

// Step 1 · NAME: the token's identity — name, ticker, image, story, links —
// with a live preview card of how it will read on Explore.
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Panel, SectionHead } from "@/components/ui/primitives";
import { DESC_MAX, NAME_MAX, SYMBOL_MAX, cleanSymbol, handleOk, httpOk, type LaunchDraft } from "@/lib/draft";
import { Field, FieldRow, INPUT_CLASS } from "./Field";

type TextKey = "name" | "symbol" | "logo" | "description" | "website" | "twitter";

export function NameStep({
  draft,
  onField,
  onPickImage,
  uploading,
  touched,
}: {
  draft: LaunchDraft;
  onField: (key: TextKey, value: string) => void;
  onPickImage: (file: File | undefined) => void;
  uploading: boolean;
  /** show errors only after the person tried to continue */
  touched: boolean;
}) {
  const t = useT();
  const logoUrl = /^https?:\/\//.test(draft.logo) ? draft.logo : null;
  const nameErr = touched && !draft.name.trim() ? t("create.nameErr") : undefined;
  const symErr = touched && !/^[A-Z0-9]{1,10}$/.test(draft.symbol) ? t("create.symbolErr") : undefined;
  const siteErr = !httpOk(draft.website) ? t("create.websiteErr") : undefined;
  const xErr = !handleOk(draft.twitter) ? t("create.xErr") : undefined;

  return (
    <Panel className="mb-6">
      <SectionHead title={t("create.stepNameTitle")} />

      {/* how it will read on Explore */}
      <div className="mb-5 flex items-center gap-3 rounded-[14px] border border-stroke bg-glass-2 p-4">
        <AssetLogo symbol={draft.symbol || "?"} src={logoUrl} seed={draft.symbol || "draft"} size={48} radius={24} />
        <span className="min-w-0">
          <b className={`block truncate text-[20px] leading-tight ${draft.symbol ? "text-ink" : "text-ink-3"}`}>${draft.symbol || t("create.previewSym")}</b>
          <span className={`block truncate text-[13px] ${draft.name ? "text-ink-2" : "text-ink-3"}`}>{draft.name || t("create.previewName")}</span>
        </span>
      </div>

      <div className="grid gap-5">
        <FieldRow cols="wide">
          <Field id="draft-name" label={t("create.nameLabel")} error={nameErr} aside={`${draft.name.length}/${NAME_MAX}`}>
            <input id="draft-name" type="text" autoComplete="off" maxLength={NAME_MAX} placeholder={t("create.namePh")} value={draft.name} onChange={(e) => onField("name", e.target.value)} className={INPUT_CLASS} aria-invalid={!!nameErr} />
          </Field>
          <Field id="draft-symbol" label={t("create.symbolLabel")} error={symErr} aside={`${draft.symbol.length}/${SYMBOL_MAX}`}>
            <input id="draft-symbol" type="text" autoComplete="off" maxLength={SYMBOL_MAX} placeholder={t("create.symbolPh")} value={draft.symbol} onChange={(e) => onField("symbol", cleanSymbol(e.target.value))} className={`${INPUT_CLASS} font-semibold uppercase`} aria-invalid={!!symErr} />
          </Field>
        </FieldRow>

        <Field id="draft-logo-url" label={t("create.imageLabel")} hint={t("create.imageFormats")}>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`flex items-center gap-3 ${uploading ? "cursor-wait" : "cursor-pointer"}`}>
              <span className="grid size-16 flex-none place-items-center overflow-hidden rounded-[14px] border border-stroke bg-glass-2 text-2xl text-ink-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="size-full object-cover" />
                ) : uploading ? (
                  "…"
                ) : (
                  "+"
                )}
              </span>
              <span className="rounded-[10px] border border-stroke-2 bg-glass-2 px-3.5 py-2 text-[13px] text-ink-2 transition-colors hover:border-brand hover:text-brand">{uploading ? t("create.imageUploading") : logoUrl ? t("create.imageChange") : t("create.imageChoose")}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0])} />
            </label>
            <input id="draft-logo-url" type="url" autoComplete="off" placeholder={t("create.imageUrlPh")} value={draft.logo} onChange={(e) => onField("logo", e.target.value)} className={`${INPUT_CLASS} min-w-0 flex-1 font-mono text-[12px]`} />
          </div>
        </Field>

        <Field id="draft-desc" label={t("create.descLabel")} aside={`${draft.description.length}/${DESC_MAX}`}>
          <textarea id="draft-desc" rows={3} maxLength={DESC_MAX} placeholder={t("create.descPh")} value={draft.description} onChange={(e) => onField("description", e.target.value)} className={INPUT_CLASS} />
        </Field>

        <FieldRow>
          <Field id="draft-site" label={t("create.websiteLabel")} error={siteErr}>
            <input id="draft-site" type="url" autoComplete="off" placeholder={t("create.websitePh")} value={draft.website} onChange={(e) => onField("website", e.target.value)} className={INPUT_CLASS} aria-invalid={!!siteErr} />
          </Field>
          <Field id="draft-x" label={t("create.xLabel")} error={xErr}>
            <input id="draft-x" type="text" autoComplete="off" placeholder={t("create.xPh")} value={draft.twitter} onChange={(e) => onField("twitter", e.target.value)} className={INPUT_CLASS} aria-invalid={!!xErr} />
          </Field>
        </FieldRow>
      </div>
    </Panel>
  );
}
