"use client";

// The MORE index: everything the dropdown holds, as a page. On phones the
// dropdown is not usable, so the tab bar's fifth item lands here.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Shell } from "@/components/shell/Shell";
import { Footer, PageHead } from "@/components/ui/primitives";
import { NAV_MORE } from "@/lib/routes";
import { useT, useTDynamic } from "@/components/LangProvider";

export default function MorePage() {
  const t = useT();
  const td = useTDynamic();
  const items = [...NAV_MORE, { name: "terms", href: "/terms" }, { name: "risk", href: "/risk" }, { name: "privacy", href: "/privacy" }];
  return (
    <Shell>
      <div className="screen-in">
        <PageHead eyebrow="MORE" title={t("more.title")} sub={t("more.sub")} />
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((n) => (
            <Link key={n.name} href={n.href} className="glass-panel group flex items-start justify-between gap-3 rounded-panel p-5 transition-colors hover:border-brand">
              <span>
                <span className="block text-base font-semibold text-ink">{td(`nav.${n.name}`)}</span>
                <span className="mt-1 block text-[13px] leading-[1.6] text-muted">{td(`more.${n.name}Desc`)}</span>
              </span>
              <ArrowUpRight size={16} strokeWidth={1.8} className="mt-1 flex-none text-ink-3 transition-colors group-hover:text-brand" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <Footer />
      </div>
    </Shell>
  );
}
