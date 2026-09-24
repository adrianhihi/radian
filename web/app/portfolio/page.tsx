"use client";

// Portfolio, on baskvia's portfolio skeleton: the overview (address chip with copy and
// the hide-amounts eye, a freshness pill, the value of what you hold in the curve's own
// quote, a composition bar), the numbers, what you can claim, balances that could not be
// read, holdings without a price, positions grouped by quote asset, approvals, the
// activity this browser sent, and your launches. Every figure comes from lib/usePortfolio,
// which the nav reads too; nothing is ever shown as zero because it could not be read.
import { Download, Eye, EyeOff, RefreshCw, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { Info } from "@/components/ui/Info";
import { CondCell, CondGrid, Empty, Footer, OutlineLink, PageHead, Panel, PrimaryButton, SectionHead } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { TokenCard } from "@/components/explore/TokenCards";
import { Approvals } from "@/components/portfolio/Approvals";
import { IdentityBanner, NotLive, PendingBar } from "@/components/TrustBanners";
import { useNetwork } from "@/lib/networks";
import { poundVaultAbi } from "@/lib/pound";
import { RADIAN, escrowAbi, arcTestnet, NATIVE_QUOTE, POUND, type LaunchRow } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { totalsByQuote, usePortfolio, type Claim, type Holding } from "@/lib/usePortfolio";
import { MASK, setHideAmounts, useHideAmounts } from "@/lib/ui/hideAmounts";
import { useNow } from "@/lib/ui/useNow";
import { fmtNum, fmtPrice, shortAddr } from "@/lib/ui/format";
import { assetColors } from "@/lib/ui/tokens";
import { recordTx, useTxLog, type TxKind } from "@/lib/txLog";
import { txErrorText } from "@/lib/txError";
import { shareMixImage } from "@/lib/shareImage";

export default function PortfolioPage() {
  const t = useT();
  const net = useNetwork();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const { rows } = useLaunches();
  const identity = useIdentity();
  const p = usePortfolio(authenticated ? address : undefined, rows, net);
  const hidden = useHideAmounts();
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);
  const [copied, setCopied] = useState(false);
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

  // money goes through m(): masked as one fixed-length string when amounts are hidden
  const m = (v: number, digits = 4) => (hidden ? MASK : fmtNum(v, digits));

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

  const created = useMemo(() => (address ? rows.filter((r) => r.deployer.toLowerCase() === address.toLowerCase()) : []), [rows, address]);
  const totals = useMemo(() => totalsByQuote(p.holdings), [p.holdings]);
  const headline = totals[0];
  const priced = p.holdings.filter((h) => h.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const unpriced = p.holdings.filter((h) => h.value == null);
  const lead = headline ? priced.filter((h) => h.row.quoteSymbol === headline[0]) : [];
  const colors = assetColors(p.holdings.map((h) => h.row.symbol));
  const claimable = p.claims.filter((c) => c.amount > 0n);
  const ready = p.status === "ready" || (p.status !== "idle" && p.asOf != null);
  const mins = p.asOf ? Math.floor((now - p.asOf) / 60_000) : null;
  // positions grouped by quote asset, in the order of the totals
  const groups = totals.map(([sym, total]) => ({ sym, total, items: priced.filter((h) => h.row.quoteSymbol === sym) }));

  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  const share = async () => {
    if (!headline) return;
    const r = await shareMixImage(
      lead.map((h) => ({ symbol: h.row.symbol, share: (h.value ?? 0) / headline[1], color: colors[h.row.symbol] })),
      t("portfolio.shareTitle"),
    );
    setToast(r === "shared" ? t("portfolio.shared") : r === "saved" ? t("portfolio.saved") : t("portfolio.shareFailed"));
  };
  const csv = () => {
    if (!p.asOf) return;
    const lines = ["symbol,token,quote,balance,price,value,share_pct,status"];
    for (const h of p.holdings) {
      const share = headline && h.value != null && h.row.quoteSymbol === headline[0] ? ((h.value / headline[1]) * 100).toFixed(2) : "";
      lines.push([h.row.symbol, h.row.token, h.row.quoteSymbol, formatUnits(h.bal, 18), h.spot ?? "", h.value ?? "", share, h.row.graduated ? "graduated" : "curve"].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `radian-holdings-${new Date(p.asOf).toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

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
                <Panel>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="mono-label inline-flex items-center gap-1 rounded-full border border-stroke bg-glass-2 py-0.5 pl-0.5 pr-1.5 text-[11px] text-ink-2">
                      <AddressAvatar address={address} size={20} />
                      <button type="button" onClick={copy} className="tnum px-1 hover:text-brand">
                        {copied ? t("profile.copied") : shortAddr(address)}
                      </button>
                      <button type="button" onClick={() => setHideAmounts(!hidden)} aria-pressed={hidden} aria-label={hidden ? t("portfolio.show") : t("portfolio.hide")} title={hidden ? t("portfolio.show") : t("portfolio.hide")} className="grid size-5 place-items-center rounded-full hover:text-brand">
                        {hidden ? <EyeOff size={12} strokeWidth={1.8} aria-hidden="true" /> : <Eye size={12} strokeWidth={1.8} aria-hidden="true" />}
                      </button>
                    </span>
                    <button type="button" onClick={p.refresh} aria-label={t("portfolio.refreshAria")} className="mono-label inline-flex items-center gap-1.5 rounded-full border border-stroke px-2.5 py-1 text-[10px] tracking-[.12em] text-ink-3 hover:border-brand hover:text-brand">
                      <RefreshCw size={11} strokeWidth={1.8} aria-hidden="true" className={p.status === "loading" ? "animate-spin" : ""} />
                      {p.status === "loading" ? t("portfolio.reading") : mins == null || mins < 1 ? t("portfolio.readJustNow") : t("portfolio.readAgo", { n: mins })}
                    </button>
                  </div>
                  {p.status === "error" && (
                    <p role="status" className="mt-3 text-[12.5px] text-neg">
                      {t("portfolio.errorTitle")}{" "}
                      <button type="button" onClick={p.refresh} className="underline">
                        {t("portfolio.tryAgain")}
                      </button>
                    </p>
                  )}
                  <div className="mt-4 text-xs text-muted">
                    {t("portfolio.valueLabel")} <Info text={t("portfolio.infoValue")} />
                  </div>
                  <div className="tnum text-[clamp(34px,5vw,54px)] font-light leading-none tracking-[-1.5px] text-ink">
                    {headline ? (
                      <>
                        {m(headline[1])} <span className="text-[0.4em] text-ink-3">{headline[0]}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                  {totals.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {totals.slice(1).map(([sym, v]) => (
                        <span key={sym} className="tnum mono-label rounded-full border border-stroke px-2.5 py-0.5 text-[10.5px] text-ink-2">
                          + {m(v)} {sym}
                        </span>
                      ))}
                    </div>
                  )}
                  {lead.length > 0 && headline && (
                    <>
                      <div className="mt-4 flex h-2 max-w-[640px] gap-[3px]" aria-hidden="true">
                        {lead.map((h) => (
                          <span key={h.row.token} title={`$${h.row.symbol} ${(((h.value ?? 0) / headline[1]) * 100).toFixed(1)}%`} className="rounded-full" style={{ width: `${((h.value ?? 0) / headline[1]) * 100}%`, minWidth: 3, background: colors[h.row.symbol] }} />
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
                        {lead.map((h) => (
                          <span key={h.row.token} className="inline-flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full" style={{ background: colors[h.row.symbol] }} />${h.row.symbol} {(((h.value ?? 0) / headline[1]) * 100).toFixed(1)}%
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </Panel>

                <CondGrid className="mt-0">
                  <CondCell label={t("portfolio.held")} value={p.holdings.length} />
                  <CondCell label={t("portfolio.created")} value={created.length} />
                  <CondCell label={t("portfolio.feesClaimable")} value={claimable.filter((c) => c.kind === "fees").length ? claimable.filter((c) => c.kind === "fees").map((c) => `${m(Number(formatUnits(c.amount, c.asset.decimals)))} ${c.asset.symbol}`).join(" · ") : "0"} small />
                  <CondCell label={t("portfolio.refClaimable")} value={POUND ? (claimable.filter((c) => c.kind === "referral").length ? claimable.filter((c) => c.kind === "referral").map((c) => `${m(Number(formatUnits(c.amount, c.asset.decimals)))} ${c.asset.symbol}`).join(" · ") : "0") : "—"} small />
                </CondGrid>

                {p.unreadable.length > 0 && (
                  <Panel>
                    <SectionHead title={t("portfolio.unreadableTitle")} />
                    <p className="-mt-3 text-[13px] leading-[1.7] text-muted">
                      {t("portfolio.unreadableBody", { n: p.unreadable.length })}{" "}
                      <button type="button" onClick={p.refresh} className="text-brand hover:underline">
                        {t("portfolio.tryAgain")}
                      </button>
                    </p>
                    <p className="mono-label mt-2 text-[11px] text-ink-3">{p.unreadable.map((r) => `$${r.symbol}`).join(" · ")}</p>
                  </Panel>
                )}

                <Panel>
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
                </Panel>

                <Panel>
                  <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-semibold text-ink">
                      {t("portfolio.positions")} <span className="tnum font-normal text-ink-3">{headline ? `${m(headline[1], 2)} ${headline[0]}` : ""}</span> <Info text={t("portfolio.infoPositions")} />
                    </h2>
                    <span className="flex items-center gap-2">
                      <button type="button" onClick={share} disabled={!headline} aria-label={t("portfolio.share")} title={t("portfolio.share")} className="grid size-9 place-items-center rounded-full border border-stroke text-ink-2 hover:border-brand hover:text-brand disabled:opacity-40">
                        <Share2 size={14} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                      <button type="button" onClick={csv} disabled={!p.holdings.length} aria-label={t("portfolio.csv")} title={t("portfolio.csv")} className="grid size-9 place-items-center rounded-full border border-stroke text-ink-2 hover:border-brand hover:text-brand disabled:opacity-40">
                        <Download size={14} strokeWidth={1.8} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  {p.holdings.length === 0 ? (
                    <Empty>
                      {t("portfolio.noHoldings")}
                      <br />
                      <Link href="/explore" className="mt-2 inline-block text-brand hover:underline">
                        {t("portfolio.exploreCta")}
                      </Link>
                    </Empty>
                  ) : (
                    <div className="grid gap-5">
                      {groups.map((g) => (
                        <section key={g.sym} aria-label={g.sym}>
                          <div className="mono-label flex items-center justify-between text-[10.5px] tracking-[.14em] text-ink-3">
                            <span>{g.sym}</span>
                            <span className="tnum">
                              {m(g.total, 2)} {g.sym} · <b className="text-ink-2">{headline ? ((g.total / totals.reduce((s, x) => s + x[1], 0)) * 100).toFixed(0) : 0}%</b>
                            </span>
                          </div>
                          <div className="mt-1.5 h-px bg-stroke">
                            <div className="h-px bg-ink-3" style={{ width: `${headline ? (g.total / totals.reduce((s, x) => s + x[1], 0)) * 100 : 0}%` }} />
                          </div>
                          <ul className="mt-2 divide-y divide-stroke rounded-xl border border-stroke">
                            {g.items.map((h) => (
                              <PositionRow key={h.row.token} h={h} total={g.total} color={colors[h.row.symbol]} m={m} />
                            ))}
                          </ul>
                        </section>
                      ))}
                      {unpriced.length > 0 && (
                        <section aria-label={t("portfolio.unpricedTitle")}>
                          <div className="mono-label text-[10.5px] tracking-[.14em] text-ink-3">{t("portfolio.unpricedTitle")}</div>
                          <ul className="mt-2 divide-y divide-stroke rounded-xl border border-stroke">
                            {unpriced.map((h) => (
                              <li key={h.row.token} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                                <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={28} radius={14} />
                                <Link href={`/token/${h.row.token}`} className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink hover:text-brand">
                                  ${h.row.symbol}
                                </Link>
                                <span className="tnum text-[12.5px] text-muted">{hidden ? MASK : `${fmtNum(Number(formatUnits(h.bal, 18)), 0)} ${h.row.symbol}`}</span>
                                <span className="mono-label w-full text-right text-[10px] tracking-[.06em] text-ink-3 min-[720px]:w-auto">{h.unpriced === "graduated" ? t("portfolio.unpricedGraduated") : t("portfolio.unpricedCurve")}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  )}
                </Panel>

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

function PositionRow({ h, total, color, m }: { h: Holding; total: number; color: string; m: (v: number, d?: number) => string }) {
  const t = useT();
  const hidden = useHideAmounts();
  const share = total > 0 ? (h.value ?? 0) / total : 0;
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <span aria-hidden="true" className="size-2 flex-none rounded-full" style={{ background: color }} />
      <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={28} radius={14} />
      <span className="min-w-0 flex-1">
        <Link href={`/token/${h.row.token}`} className="block truncate text-[14px] font-semibold text-ink hover:text-brand">
          ${h.row.symbol} <span className="mono-label text-[11px] font-normal text-ink-3">{h.row.name}</span>
        </Link>
        <span className="tnum block text-[11px] text-ink-3 nav:hidden">{hidden ? MASK : `${fmtNum(Number(formatUnits(h.bal, 18)), 0)} ${h.row.symbol}`}</span>
      </span>
      <span className="tnum hidden w-36 text-right text-[12px] text-ink-3 nav:block">
        {hidden ? MASK : `${fmtNum(Number(formatUnits(h.bal, 18)), 0)} ${h.row.symbol}`}
        {h.spot != null && <span className="block text-[11px]">{t("portfolio.atPrice", { p: fmtPrice(h.spot), sym: h.row.quoteSymbol })}</span>}
      </span>
      <span className="tnum w-28 text-right text-[14px] text-ink">
        {m(h.value ?? 0)} {h.row.quoteSymbol}
      </span>
      <span className="tnum w-12 text-right text-[12.5px] text-muted">{`${(share * 100).toFixed(share > 0 && share < 0.1 ? 1 : 0)}%`}</span>
      {!h.row.graduated ? (
        <Link href={`/swap?token=${h.row.token}`} className="mono-label w-14 text-right text-[10px] tracking-[.1em] text-ink-3 hover:text-brand">
          {t("portfolio.trade")}
        </Link>
      ) : (
        <span className="w-14" />
      )}
    </li>
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
