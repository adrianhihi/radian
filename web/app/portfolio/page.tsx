"use client";

// Portfolio, laid out as baskvia's /assets: the action rail on the left (wide screens), the
// overview card (address · big value · freshness · composition · "started with" · period
// tabs · chart · PnL strip), then positions (curve stage · list / picture · spotlight · small
// fold), the link to your launches, holdings without a price, balances that could not be
// read, claims, insights, approvals, and — Radian's own — the activity this browser sent and
// your launches. Every figure comes from lib/usePortfolio (the nav reads it too). The "book"
// is the quote asset with the most value; nothing is added across quote assets.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Empty, Footer, OutlineLink, PageHead, Panel, PrimaryButton, SectionHead } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { TokenCard } from "@/components/explore/TokenCards";
import { ActionRail } from "@/components/portfolio/ActionRail";
import { Approvals } from "@/components/portfolio/Approvals";
import { Insights } from "@/components/portfolio/Insights";
import { Overview } from "@/components/portfolio/Overview";
import { Positions } from "@/components/portfolio/Positions";
import { IdentityBanner, NotLive, PendingBar } from "@/components/TrustBanners";
import { useNetwork } from "@/lib/networks";
import { poundVaultAbi } from "@/lib/pound";
import { RADIAN, escrowAbi, arcTestnet, NATIVE_QUOTE, POUND, type LaunchRow } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { totalsByQuote, usePortfolio, type Claim } from "@/lib/usePortfolio";
import { portfolioHistory, type HistoryPeriod } from "@/lib/portfolioHistory";
import { MASK, useHideAmounts } from "@/lib/ui/hideAmounts";
import { useNow } from "@/lib/ui/useNow";
import { fmtNum, shortAddr } from "@/lib/ui/format";
import { assetColors } from "@/lib/ui/tokens";
import { recordTx, useTxLog, type TxKind } from "@/lib/txLog";
import { txErrorText } from "@/lib/txError";

export default function PortfolioPage() {
  const t = useT();
  const net = useNetwork();
  const router = useRouter();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const { rows } = useLaunches();
  const identity = useIdentity();
  const p = usePortfolio(authenticated ? address : undefined, rows, net);
  const hidden = useHideAmounts();
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);
  const [period, setPeriod] = useState<HistoryPeriod>("7D");
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  usePendingResume(["claim"], () => {
    setPendingHash(null);
    setToast(t("portfolio.resumed"));
    p.refresh();
  });

  const m = (v: number, digits = 4) => (hidden ? MASK : fmtNum(v, digits));
  const created = useMemo(() => (address ? rows.filter((r) => r.deployer.toLowerCase() === address.toLowerCase()) : []), [rows, address]);
  const totals = useMemo(() => totalsByQuote(p.holdings), [p.holdings]);
  const book = totals[0]?.[0] ?? null;
  const bookTotal = totals[0]?.[1] ?? 0;
  const priced = useMemo(() => p.holdings.filter((h) => h.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)), [p.holdings]);
  const bookHoldings = useMemo(() => priced.filter((h) => h.row.quoteSymbol === book), [priced, book]);
  const unpriced = p.holdings.filter((h) => h.value == null);
  const colors = useMemo(() => assetColors(p.holdings.map((h) => h.row.symbol)), [p.holdings]);
  const color = (sym: string) => colors[sym] ?? "var(--brand)";
  const hist = useMemo(() => (p.status === "ready" || p.asOf ? portfolioHistory(bookHoldings, period, now) : undefined), [bookHoldings, period, now, p.status, p.asOf]);
  const h24 = useMemo(() => (bookHoldings.length ? portfolioHistory(bookHoldings, "24H", now) : undefined), [bookHoldings, now]);
  const h30 = useMemo(() => (bookHoldings.length ? portfolioHistory(bookHoldings, "30D", now) : undefined), [bookHoldings, now]);
  const claimable = p.claims.filter((c) => c.amount > 0n);
  const ready = p.status === "ready" || (p.status !== "idle" && p.asOf != null);
  const mins = p.asOf ? Math.floor((now - p.asOf) / 60_000) : null;
  const nothing = p.holdings.length === 0;

  async function claim(c: Claim) {
    if (!address) return;
    if (identity.checked && !identity.ok) {
      setToast(t("quick.identity"));
      return;
    }
    const key = `${c.kind}-${c.asset.address}`;
    setBusy(key);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error(t("create.noWallet"));
      setToast(t("portfolio.confirmClaim", { sym: c.asset.symbol }));
      const hash =
        c.kind === "referral"
          ? await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: POUND!.vault, abi: poundVaultAbi, functionName: "claimReferral", args: [c.asset.address] })
          : c.asset.address === NATIVE_QUOTE
            ? await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: RADIAN.escrow, abi: escrowAbi, functionName: "claim" })
            : await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: RADIAN.escrow, abi: escrowAbi, functionName: "claimToken", args: [c.asset.address] });
      await waitReceipt(hash, "claim");
      recordTx(address, { hash, kind: c.kind === "referral" ? "referralClaim" : "claim", amount: `${fmtNum(Number(formatUnits(c.amount, c.asset.decimals)), 6)} ${c.asset.symbol}`, time: Date.now() });
      setToast(t("portfolio.claimed", { sym: c.asset.symbol }));
      p.refresh();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast(t("trade.pending"));
      } else {
        setToast(txErrorText(t, e, { fallback: t("portfolio.claimFailed") }));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell>
      <div className="screen-in">
        <PageHead eyebrow={t("portfolio.eyebrow")} title={t("portfolio.title")} sub={t("portfolio.sub", { chain: net.chainName })} aside={address ? <OutlineLink href={`/profile/${address}`}>{t("wallet.mine")}</OutlineLink> : undefined} />
        <NotLive />
        {net.live && (
          <>
            <IdentityBanner identity={identity} />
            <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
            {!authenticated || !address ? (
              <Panel>
                <div className="py-8 text-center">
                  <h2 className="text-[clamp(24px,3.4vw,34px)] font-semibold text-ink">{t("portfolio.introTitle")}</h2>
                  <p className="mx-auto mt-3 max-w-[52ch] text-[14.5px] leading-[1.75] text-muted">{t("portfolio.introBody")}</p>
                  <PrimaryButton type="button" onClick={login} className="mx-auto mt-6 max-w-[220px]">
                    {t("wallet.connect")}
                  </PrimaryButton>
                </div>
              </Panel>
            ) : p.status === "error" && p.asOf == null ? (
              <Panel>
                <Empty>
                  {t("portfolio.errorTitle")}
                  <br />
                  <button type="button" onClick={p.refresh} className="mt-2 text-brand hover:underline">
                    {t("portfolio.tryAgain")}
                  </button>
                </Empty>
              </Panel>
            ) : !ready ? (
              <Panel>
                <p role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                  <Spinner size={18} /> {t("portfolio.reading")}
                </p>
              </Panel>
            ) : (
              <div className="grid gap-5">
                {bookHoldings.length > 0 && <ActionRail bookHoldings={bookHoldings} bookTotal={bookTotal} color={color} />}
                <Overview
                  address={address}
                  book={book}
                  bookHoldings={bookHoldings}
                  bookTotal={bookTotal}
                  totals={totals}
                  status={p.status}
                  mins={mins}
                  hidden={hidden}
                  m={m}
                  color={color}
                  hist={hist}
                  period={period}
                  onPeriod={setPeriod}
                  onRefresh={p.refresh}
                  onAsset={(token) => router.push(`/token/${token}`)}
                />
                {nothing ? (
                  <Empty>
                    {t("portfolio.noHoldings")}
                    <br />
                    <Link href="/explore" className="mt-3 inline-block text-brand hover:underline">
                      {t("portfolio.exploreCta")}
                    </Link>
                  </Empty>
                ) : (
                  <>
                    {priced.length > 0 && book && <Positions holdings={priced} allHoldings={p.holdings} book={book} bookTotal={bookTotal} totals={totals} hidden={hidden} m={m} color={color} h24={h24} onToast={setToast} />}
                    <Link href={`/profile/${address}`} className="glass-panel mono-label block rounded-2xl px-5 py-3.5 text-center text-[11px] tracking-[.14em] text-ink-2 transition-colors hover:text-brand">
                      {t("pf.manageLaunches")}
                    </Link>
                    {unpriced.length > 0 && (
                      <Panel>
                        <SectionHead title={t("portfolio.unpricedTitle")} />
                        <ul className="divide-y divide-stroke rounded-xl border border-stroke">
                          {unpriced.map((h) => (
                            <li key={h.row.token} className="flex items-center gap-3 px-3.5 py-3">
                              <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={28} radius={14} />
                              <Link href={`/token/${h.row.token}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink hover:text-brand">
                                ${h.row.symbol}
                              </Link>
                              <span className="tnum text-[12.5px] text-muted">{hidden ? MASK : fmtNum(Number(formatUnits(h.bal, 18)), 0)}</span>
                              <span className="mono-label w-[46%] text-right text-[10.5px] tracking-[.06em] text-ink-3">{h.unpriced === "graduated" ? t("portfolio.unpricedGraduated") : t("portfolio.unpricedCurve")}</span>
                            </li>
                          ))}
                        </ul>
                      </Panel>
                    )}
                  </>
                )}
                {p.unreadable.length > 0 && (
                  <Panel>
                    <SectionHead title={t("portfolio.unreadableTitle")} />
                    <p className="-mt-3 text-[13px] leading-[1.7] text-muted">
                      {t("portfolio.unreadableBody", { n: p.unreadable.length })}{" "}
                      <button type="button" onClick={p.refresh} className="text-brand hover:underline">
                        {t("portfolio.tryAgain")}
                      </button>
                    </p>
                    <p className="mono-label mt-2 text-[11px] tracking-[.06em] text-ink-3">{p.unreadable.map((r) => `$${r.symbol}`).join(" · ")}</p>
                  </Panel>
                )}

                <Panel>
                  <div id="claims" className="scroll-mt-24" />
                  <SectionHead title={t("portfolio.claimsTitle")} aside={POUND ? <Link href="/earn" className="hover:text-brand">{t("portfolio.toPound")}</Link> : undefined} />
                  {p.claims.length === 0 ? (
                    <p className="text-[13px] leading-[1.7] text-muted">{t("portfolio.noClaims")}</p>
                  ) : (
                    <ul className="divide-y divide-stroke rounded-xl border border-stroke">
                      {p.claims.map((c) => {
                        const key = `${c.kind}-${c.asset.address}`;
                        return (
                          <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] text-ink">{c.kind === "fees" ? t("portfolio.creatorFees") : t("portfolio.referralEarnings")}</span>
                              <span className="text-[11.5px] text-ink-3">{c.kind === "fees" ? t("portfolio.creatorFeesSub") : t("portfolio.referralSub", { v: m(Number(formatUnits(c.accrued ?? 0n, c.asset.decimals)), 6) })}</span>
                            </span>
                            <span className="tnum text-[15px] text-ink">
                              {m(Number(formatUnits(c.amount, c.asset.decimals)), 6)} {c.asset.symbol}
                            </span>
                            <button type="button" disabled={busy !== null || c.amount === 0n} onClick={() => claim(c)} className="mono-label inline-flex items-center gap-1.5 rounded-[10px] border border-brand/50 px-3 py-1.5 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2 disabled:border-stroke disabled:text-ink-3 disabled:opacity-60">
                              {busy === key ? <Spinner size={12} /> : t("portfolio.claim")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {claimable.length === 0 && p.claims.length > 0 && <p className="mt-2 text-[12px] text-ink-3">{t("portfolio.noClaims")}</p>}
                </Panel>

                {book && bookHoldings.length > 0 && <Insights bookHoldings={bookHoldings} allHoldings={p.holdings} bookTotal={bookTotal} sym={book} m={m} color={color} h30={h30} />}

                <Approvals address={address} rows={rows} />

                <TxLogPanel address={address} rows={rows} />

                <section>
                  <SectionHead title={t("portfolio.launches")} aside={created.length ? <Link href={`/profile/${address}`} className="hover:text-brand">{t("portfolio.allLaunches")}</Link> : undefined} />
                  {created.length === 0 ? (
                    <Empty>
                      {t("portfolio.noLaunches")}
                      <br />
                      <Link href="/create" className="mt-2 inline-block text-brand hover:underline">
                        {t("profile.become")} →
                      </Link>
                    </Empty>
                  ) : (
                    <div className="grid gap-5 min-[640px]:grid-cols-2">
                      {created.slice(0, 4).map((r) => (
                        <TokenCard key={r.token} row={r} />
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
        <Footer />
      </div>
      {toast && (
        <button type="button" onClick={() => setToast(null)} className="fixed bottom-[88px] left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-stroke bg-night px-4 py-3 text-left text-sm text-ink shadow-[var(--shadow)] nav:bottom-6">
          <span role="status">{toast}</span>
        </button>
      )}
    </Shell>
  );
}

/** Transactions this browser sent for the wallet (lib/txLog); the full history is on /activity. */
function TxLogPanel({ address, rows }: { address: Address; rows: LaunchRow[] }) {
  const t = useT();
  const net = useNetwork();
  const log = useTxLog(address);
  const sym = new Map(rows.map((r) => [r.token.toLowerCase(), r.symbol]));
  const KIND: Record<TxKind, string> = {
    buy: t("tx.buy"), sell: t("tx.sell"), launch: t("tx.launch"), claim: t("tx.claim"), stake: t("tx.stake"), unstake: t("tx.unstake"),
    deposit: t("tx.deposit"), withdraw: t("tx.withdraw"), cancel: t("tx.cancel"), wallClaim: t("tx.wallClaim"), pofClaim: t("tx.pofClaim"), referralClaim: t("tx.referralClaim"),
  };
  return (
    <Panel>
      <SectionHead title={t("tx.title")} aside={<Link href="/activity" className="hover:text-brand">{t("portfolio.allActivity")}</Link>} />
      <p className="-mt-3 mb-3 text-[12.5px] leading-[1.7] text-muted">{t("tx.scope")}</p>
      {log.length === 0 ? (
        <Empty>{t("tx.none")}</Empty>
      ) : (
        <ul className="divide-y divide-stroke rounded-xl border border-stroke">
          {log.slice(0, 10).map((r) => {
            const code = r.token ? sym.get(r.token.toLowerCase()) : undefined;
            return (
              <li key={r.hash} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="w-32 flex-none font-semibold text-ink">{KIND[r.kind] ?? r.kind}</span>
                <span className="min-w-0 flex-1 text-ink-2">
                  {r.token ? (
                    <Link href={`/token/${r.token}`} className="hover:text-brand">
                      {code ? `$${code}` : shortAddr(r.token)}
                    </Link>
                  ) : (
                    "—"
                  )}
                  {r.amount && <span className="tnum ml-2 text-ink-3">{r.amount}</span>}
                </span>
                <span className="tnum text-[11.5px] text-ink-3">{new Date(r.time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                <a href={`${net.explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer" className="text-[12px] text-brand hover:underline">
                  {t("trust.viewTx")}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
