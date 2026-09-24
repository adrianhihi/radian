"use client";

// The swap console, on baskvia's /swap: a big title + one line, the full trade
// form on the left (with a token picker), the picked token's summary on the
// right. `?token=0x…` opens the console on that token (the token page's "Open
// in Swap" and any deep link); picking another token updates the URL in place.
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Address } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Empty, Footer, HeroLink, Panel } from "@/components/ui/primitives";
import { SwapForm, type TradeToken } from "@/components/trade/SwapForm";
import { TokenAside } from "@/components/swap/TokenAside";
import { filterSortLaunches } from "@/lib/explore";
import { useNetwork } from "@/lib/networks";
import { quoteByAddress, type LaunchRow } from "@/lib/radian";
import { useLaunches } from "@/lib/useLaunches";

const ZERO = "0x0000000000000000000000000000000000000000";

const toTradeToken = (r: LaunchRow): TradeToken => ({
  token: r.token,
  curve: r.curve,
  pairToken: r.pairToken,
  native: quoteByAddress(r.pairToken)?.native ?? r.pairToken === ZERO,
  template: r.template,
  name: r.name,
  symbol: r.symbol,
  quoteSymbol: r.quoteSymbol,
  quoteDecimals: r.quoteDecimals,
  graduated: r.graduated,
});

export default function SwapPage() {
  return (
    <Suspense fallback={null}>
      <SwapConsole />
    </Suspense>
  );
}

function SwapConsole() {
  const t = useT();
  const net = useNetwork();
  const router = useRouter();
  const params = useSearchParams();
  const { rows, loading, error, refresh } = useLaunches();
  const [picked, setPicked] = useState<string | null>(null);

  // the picker lists what is still on a curve, in Explore's Top order; a deep
  // link to a graduated token still resolves, and the form says the curve is closed
  const candidates = useMemo(() => filterSortLaunches(rows, {}).filter((r) => !r.graduated), [rows]);
  const wanted = (picked ?? params.get("token") ?? "").toLowerCase();
  const row = rows.find((r) => r.token.toLowerCase() === wanted) ?? candidates[0];
  const tk = row ? toTradeToken(row) : null;
  const onToken = (token: Address) => {
    setPicked(token);
    router.replace(`/swap?token=${token}`, { scroll: false });
  };

  return (
    <Shell>
      <div className="screen-in">
        <h1 className="mt-4 text-[clamp(38px,5vw,56px)] font-bold uppercase leading-none tracking-[-1px] text-ink">{t("swap.title")}</h1>
        <p className="mt-3 max-w-[640px] text-[14px] leading-[1.7] text-muted">{t("swap.sub")}</p>

        {!row ? (
          <div className="mt-7">
            {loading ? (
              <Empty>{t("swap.loading")}</Empty>
            ) : error ? (
              <Empty>{t("explore.error", { msg: error })}</Empty>
            ) : (
              <Empty>
                <p>{t("swap.emptyLive", { chain: net.chainName })}</p>
                <HeroLink href="/create" className="mt-4">
                  {t("explore.emptyCta")}
                </HeroLink>
              </Empty>
            )}
          </div>
        ) : (
          <div className="mt-7 grid items-start gap-5 nav:grid-cols-[minmax(0,1fr)_340px]">
            <Panel>
              <SwapForm tk={tk} candidates={candidates.map(toTradeToken)} onToken={onToken} onTraded={refresh} />
            </Panel>
            <TokenAside row={row} />
          </div>
        )}

        <Footer />
      </div>
    </Shell>
  );
}
