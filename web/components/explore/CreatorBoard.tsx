"use client";

// Creator ranking: rank · avatar · address · "Top $SYM · progress" · launches · graduated.
// Rows open the creator's page.
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import Link from "next/link";
import { shortAddr } from "@/lib/ui/format";
import type { CreatorRow } from "@/lib/explore";

export function CreatorBoard({ rows }: { rows: CreatorRow[] }) {
  const t = useT();
  return (
    <ol className="grid gap-2.5" aria-label={t("explore.creatorsAria")}>
      {rows.map((r, i) => {
        const topP = r.top.graduated ? 100 : Math.round(r.top.progress * 100);
        return (
          <li key={r.addr}>
            <Link href={`/profile/${r.addr}`} className="glass-panel flex items-center gap-3 rounded-xl px-3.5 py-3.5 transition-colors hover:border-stroke-2 nav:gap-4 nav:px-5">
              <span className="tnum w-5 flex-none text-center text-xs text-ink-3">{i + 1}</span>
              <AddressAvatar address={r.addr} size={40} />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[15px] text-ink ${r.top.creatorName ? "" : "tnum"}`}>{r.top.creatorName || shortAddr(r.addr)}</span>
                <span className="mono-label mt-1 block truncate text-[10.5px] tracking-[.08em] text-ink-3">
                  {t("explore.creatorTop", { sym: r.top.symbol })}
                  {" · "}
                  <span className={r.top.graduated ? "text-signal" : "text-brand"}>{topP}%</span>
                </span>
              </span>
              <span className="text-right">
                <span className="tnum block text-[17px] leading-tight text-ink nav:text-[19px]">{r.launches.length}</span>
                <span className="mono-label mt-1 block text-[9.5px] tracking-[.12em] text-ink-3">{t("explore.colLaunches")}</span>
              </span>
              <span className="w-16 text-right">
                <span className="tnum block text-[17px] leading-tight text-ink nav:text-[19px]">{r.graduated}</span>
                <span className="mono-label mt-1 block text-[9.5px] tracking-[.12em] text-ink-3">{t("explore.colGraduated")}</span>
              </span>
              <span aria-hidden="true" className="hidden text-brand nav:inline">
                →
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
