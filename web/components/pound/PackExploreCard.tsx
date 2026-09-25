"use client";

// The Pack on Explore: the band under the showcase (where baskvia features what the ground is
// made of), with the same tiles in miniature, coins · rotation, who is next and the last burn,
// linking to /earn. Drawn only where The Pound runs and the Pack has coins; a failed read says
// so instead of pretending the Pack is empty. `net` comes from the page's SSR-safe network hook.
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/LangProvider";
import type { NetworkConfig } from "@/lib/networks";
import { fetchPound, type PoundView } from "@/lib/pound";
import { shortAddr } from "@/lib/ui/format";
import { PackTiles, agoText, fmtDuration, nextAllowedText, type PackRow } from "./PackBasket";

export function PackExploreCard({ net }: { net: NetworkConfig }) {
  const t = useT();
  const [view, setView] = useState<PoundView | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let on = true;
    setNow(Math.floor(Date.now() / 1000));
    fetchPound().then(
      (v) => {
        if (!on) return;
        if (v) setView(v);
        else setFailed(true);
      },
      () => on && setFailed(true),
    );
    return () => {
      on = false;
    };
  }, []);
  if (!view && !failed) return null;
  if (view && view.packs.length === 0) return null;
  const packs = (view?.packs ?? []) as PackRow[];
  const next = view && view.burner.nextPack != null ? packs.find((p) => p.index === view.burner.nextPack) : undefined;
  return (
    <section aria-label={t("pound.exploreAria")} className="glass-panel relative overflow-hidden rounded-lg">
      <div className="grad-fill h-[3px]" aria-hidden="true" />
      <div className="flex flex-col gap-4 p-4 nav:flex-row nav:items-center nav:gap-6 nav:px-6">
        {view && (
          <div className="w-full flex-none nav:w-[320px]">
            <PackTiles packs={packs} nextPack={view.burner.nextPack} explorer={net.explorer} mini />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="mono-label text-[10.5px] tracking-[.16em] text-brand">{t("pound.exploreEyebrow")}</div>
          {view ? (
            <>
              <p className="mt-1 text-[15px] font-semibold text-ink">{t("pound.exploreLine", { n: packs.filter((p) => p.active).length, interval: fmtDuration(view.burner.minInterval, t) })}</p>
              <p className="mono-label mt-1 text-[10.5px] leading-[1.7] tracking-[.1em] text-ink-3">
                {next && `${t("pound.exploreNext", { sym: next.symbol ?? shortAddr(next.token), when: nextAllowedText(view, now, t) })} · `}
                {t("pound.exploreLast", { ago: agoText(view.burner.lastBurnAt, now, t) })}
              </p>
            </>
          ) : (
            <p role="status" className="mt-1 text-[13px] text-ink-2">
              {t("pound.readFailedShort")}
            </p>
          )}
        </div>
        <Link href="/earn" className="mono-label inline-flex flex-none items-center gap-1.5 self-start rounded-full border border-brand/60 px-4 py-2 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2 nav:self-auto">
          {t("pound.exploreCta")} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
