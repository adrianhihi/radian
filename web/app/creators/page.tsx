"use client";

// The creators page, on baskvia's /creators: a big claim, three cards on what
// a launch fixes (supply · market · your share), the quick start into the
// wizard, then the creators already here, the earnings simulator and the FAQ.
import { ArrowRight } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { QuickStart } from "@/components/creators/QuickStart";
import { CreatorsUsing, EarnSimulator, Faq } from "@/components/creators/Sections";
import { useFactoryState } from "@/lib/factory";
import { useNetwork } from "@/lib/networks";
import { useLaunches } from "@/lib/useLaunches";

export default function CreatorsPage() {
  const t = useT();
  const net = useNetwork();
  const { rows } = useLaunches();
  const { state: factory } = useFactoryState();
  const protocol = factory?.hook.protocolFeeShareBps ?? null;
  const p = (protocol ?? 5000) / 100;
  // from the SSR-safe network hook, not the module constant: the server renders the default network
  const pound = !!net.pound;

  return (
    <Shell>
      <div className="screen-in">
        <header className="pt-6 text-center">
          <span className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-4 py-1.5 text-[10.5px] tracking-[.16em] text-ink-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
            {t("cr.eyebrow")}
          </span>
          <h1 className="mt-6 text-[clamp(40px,7.5vw,92px)] font-bold uppercase leading-[.95] tracking-[-2px] text-ink">
            {t("cr.title1")}
            <br />
            {t("cr.title2")} <span className="bg-[image:var(--brand-grad)] bg-clip-text text-transparent">{t("cr.title3")}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[46ch] text-[17px] leading-[1.6] text-ink-2">{t("cr.sub")}</p>
          <p className="mono-label mt-4 text-[10.5px] tracking-[.16em] text-ink-3">
            {t("cr.subLine")} ·{" "}
            <a href="#creators-using" className="inline-flex items-center gap-1 hover:text-brand">
              {t("cr.seeWho")} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
            </a>
          </p>
        </header>

        <section aria-labelledby="cr-what" className="mt-20">
          <h2 id="cr-what" className="text-center text-[clamp(26px,3.6vw,40px)] font-bold uppercase tracking-[-.5px] text-ink">
            {t("cr.what")}
          </h2>
          <p className="mono-label mt-2 text-center text-[10.5px] tracking-[.16em] text-ink-3">{t("cr.whatSub")}</p>

          <div className="mt-8 grid gap-4 nav:grid-cols-3">
            <article className="glass-panel rounded-2xl p-5">
              <div className="rounded-[14px] border border-stroke p-4" aria-hidden="true">
                <div className="grad-fill h-7 rounded-md" />
                <p className="mono-label mt-2 text-[9.5px] tracking-[.12em] text-ink-3">{t("cr.card1Visual")}</p>
              </div>
              <p className="mono-label mt-5 text-[10px] text-ink-3">01</p>
              <h3 className="mt-1 text-[16px] font-semibold text-ink">{t("cr.card1Title")}</h3>
              <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("cr.card1Body")}</p>
            </article>
            <article className="glass-panel rounded-2xl p-5">
              <div className="flex flex-col items-center gap-3 rounded-[14px] border border-stroke p-4" aria-hidden="true">
                <span className="flex -space-x-2.5">
                  {net.quoteAssets.slice(0, 5).map((q) => (
                    <span key={q.key} className="rounded-full bg-night p-[3px] shadow-[inset_0_0_0_2px_var(--stroke-2)]">
                      <AssetLogo symbol={q.symbol} ticker={q.stock?.refSymbol} size={30} radius={15} />
                    </span>
                  ))}
                </span>
                <span className="grad-fill mono-label rounded-full px-5 py-1.5 text-[11px] font-semibold tracking-[.12em]">{t("cr.gradPill")}</span>
              </div>
              <p className="mono-label mt-5 text-[10px] text-ink-3">02</p>
              <h3 className="mt-1 text-[16px] font-semibold text-ink">{t("cr.card2Title")}</h3>
              <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("cr.card2Body")}</p>
            </article>
            <article className="glass-panel rounded-2xl p-5">
              <div className="rounded-[14px] border border-stroke p-4" aria-hidden="true">
                <div className="flex h-7 overflow-hidden rounded-md text-[10px] font-semibold">
                  <span className="grid place-items-center bg-brand text-night" style={{ width: `${100 - p}%` }}>
                    {t("cr.you")}
                  </span>
                  <span className="grid place-items-center bg-brand-2 text-night" style={{ width: `${p}%` }}>
                    {pound ? t("cr.pound") : t("create.roleProtocol")}
                  </span>
                </div>
                <p className="mono-label mt-2 text-[9.5px] tracking-[.12em] text-ink-3">{t("cr.lockedAtLaunch")}</p>
              </div>
              <p className="mono-label mt-5 text-[10px] text-ink-3">03</p>
              <h3 className="mt-1 text-[16px] font-semibold text-ink">{t("cr.card3Title")}</h3>
              <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("cr.card3Body")}</p>
            </article>
          </div>

          <div className="mt-8">
            <QuickStart />
          </div>
        </section>

        <CreatorsUsing rows={rows} chain={net.chainName} />
        <EarnSimulator protocolShareBps={protocol} pound={pound} maxTaxPct={(factory?.maxCreatorTaxBps ?? 1000) / 100} />
        <Faq />
        <Footer />
      </div>
    </Shell>
  );
}
