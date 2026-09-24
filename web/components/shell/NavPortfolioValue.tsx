"use client";

// The portfolio's headline value inside the Portfolio nav item: a nav item that
// carries data, not just a link. Shown only once the read is complete, masked when
// amounts are hidden, and never a guess: the same store the portfolio page reads.
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { useNetwork } from "@/lib/networks";
import { totalsByQuote, usePortfolio } from "@/lib/usePortfolio";
import { MASK, useHideAmounts } from "@/lib/ui/hideAmounts";
import { fmtNum } from "@/lib/ui/format";

export function NavPortfolioValue() {
  const { address, authenticated } = useRadianWallet();
  const net = useNetwork();
  const { rows } = useLaunches();
  const p = usePortfolio(authenticated ? address : undefined, rows, net);
  const hidden = useHideAmounts();
  if (!authenticated || p.status !== "ready") return null;
  const head = totalsByQuote(p.holdings)[0];
  if (!head) return null;
  return <span className="tnum mono-label text-[11px] opacity-70">{hidden ? MASK : `${fmtNum(head[1], 2)} ${head[0]}`}</span>;
}
