"use client";

import Link from "next/link";
import { useT } from "@/components/LangProvider";

export default function NotFound() {
  const t = useT();
  return (
    <div className="grid min-h-screen place-items-center p-6 font-sans">
      <div className="max-w-[440px] text-center">
        <div className="text-[64px] font-[650] leading-none tracking-[-2px] text-brand">404</div>
        <h1 className="mb-2 mt-[18px] text-xl font-semibold text-ink">{t("nf.title")}</h1>
        <p className="mb-6 text-sm leading-[1.8] text-muted">{t("nf.body")}</p>
        <Link href="/" className="grad-fill inline-block rounded-[10px] px-[22px] py-3 text-sm font-[550]">
          {t("nf.cta")}
        </Link>
      </div>
    </div>
  );
}
