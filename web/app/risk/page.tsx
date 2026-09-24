"use client";

// Risk disclosure: plain statements about the mechanics, with the network note.
import { useT } from "@/components/LangProvider";
import { LegalPage, SeeAlso } from "@/components/LegalPage";
import { RISK } from "@/lib/content/legal";

export default function RiskPage() {
  const t = useT();
  return (
    <LegalPage doc={RISK} showNetwork>
      <SeeAlso
        links={[
          { href: "/verify", label: t("nav.verify") },
          { href: "/terms", label: t("nav.terms") },
          { href: "/privacy", label: t("nav.privacy") },
        ]}
      />
    </LegalPage>
  );
}
