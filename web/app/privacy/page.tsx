"use client";

// Privacy: what stays in the browser, what the app reads and from whom, who sees what.
import { useT } from "@/components/LangProvider";
import { LegalPage, SeeAlso } from "@/components/LegalPage";
import { PRIVACY } from "@/lib/content/legal";

export default function PrivacyPage() {
  const t = useT();
  return (
    <LegalPage doc={PRIVACY}>
      <SeeAlso
        links={[
          { href: "/terms", label: t("nav.terms") },
          { href: "/risk", label: t("nav.risk") },
          { href: "/verify", label: t("nav.verify") },
        ]}
      />
    </LegalPage>
  );
}
