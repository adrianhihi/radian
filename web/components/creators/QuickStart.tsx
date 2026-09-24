"use client";

// The creators page's builder entry: a name and a ticker are enough to start;
// they become the wizard's draft and the person lands on /create. A draft this
// browser already holds is offered for continuing instead.
import { ArrowRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { INPUT_CLASS } from "@/components/create/Field";
import { NAME_MAX, SYMBOL_MAX, cleanSymbol, emptyDraft, loadDraft, saveDraft, useHydrated } from "@/lib/draft";

export function QuickStart() {
  const t = useT();
  const router = useRouter();
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);
  const existing = useMemo(() => (hydrated ? loadDraft() : null), [hydrated]);
  const resumable = !dismissed && existing && (existing.name || existing.symbol);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const ready = name.trim().length > 0 && symbol.length > 0;

  const start = () => {
    if (!ready) return;
    saveDraft({ ...emptyDraft(), name: name.trim(), symbol });
    router.push("/create");
  };
  const fresh = () => {
    saveDraft(emptyDraft());
    setDismissed(true);
  };

  return (
    <div className="glass-panel rounded-2xl p-5 nav:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[18px] font-bold uppercase text-ink">{t("cr.startTitle")}</h3>
        <span className="mono-label text-[10.5px] tracking-[.12em] text-ink-3">{t("cr.pickSub")}</span>
      </div>
      <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("cr.startSub")}</p>

      {resumable && existing ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-glass-2 px-4 py-3">
          <AssetLogo symbol={existing.symbol || "?"} src={/^https?:\/\//.test(existing.logo) ? existing.logo : null} size={32} radius={16} />
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[14px] text-ink">{existing.name || t("create.previewName")}</b>
            <span className="mono-label text-[10.5px] text-ink-3">${existing.symbol || t("create.previewSym")}</span>
          </span>
          <button type="button" onClick={() => router.push("/create")} className="grad-fill mono-label inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] tracking-[.12em]">
            {t("cr.continueDraft")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button type="button" onClick={fresh} className="mono-label inline-flex items-center gap-1 text-[10.5px] tracking-[.12em] text-ink-3 hover:text-neg">
            <X size={12} strokeWidth={2} aria-hidden="true" /> {t("cr.startFresh")}
          </button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
          className="mt-4 grid gap-3 min-[720px]:grid-cols-[1fr_170px_auto]"
        >
          <input aria-label={t("create.nameLabel")} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={t("cr.namePh")} className={`${INPUT_CLASS} text-[16px]`} />
          <input aria-label={t("create.symbolLabel")} value={symbol} maxLength={SYMBOL_MAX} onChange={(e) => setSymbol(cleanSymbol(e.target.value))} placeholder={t("cr.symbolPh")} className={`${INPUT_CLASS} text-[16px] font-semibold uppercase`} />
          <button type="submit" disabled={!ready} className="grad-fill mono-label inline-flex items-center justify-center gap-2 rounded-[10px] px-5 py-3 text-[12px] font-semibold tracking-[.14em] disabled:opacity-50">
            {ready ? t("cr.build", { sym: symbol }) : t("cr.buildEmpty")} <ArrowRight size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
}
