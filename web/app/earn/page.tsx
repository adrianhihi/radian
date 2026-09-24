"use client";

// /earn: The Pound (referrals and the Pack) where it runs; the $RADIAN
// flywheel on the chains that still run that; a note elsewhere.
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Empty, Footer } from "@/components/ui/primitives";
import { NotLive } from "@/components/TrustBanners";
import { PoundEarn } from "@/components/earn/PoundEarn";
import { FlywheelEarn } from "@/components/earn/FlywheelEarn";
import { useNetwork } from "@/lib/networks";

const ZERO = "0x0000000000000000000000000000000000000000";

export default function EarnPage() {
  const t = useT();
  const net = useNetwork();
  return (
    <Shell>
      <div className="screen-in">
        <NotLive />
        {net.live && net.pound && <PoundEarn net={net} />}
        {net.live && !net.pound && net.radian.token === ZERO && <Empty>{t("pound.noFlywheel", { chain: net.label })}</Empty>}
        {net.live && !net.pound && net.radian.token !== ZERO && <FlywheelEarn net={net} />}
        <Footer />
      </div>
    </Shell>
  );
}
