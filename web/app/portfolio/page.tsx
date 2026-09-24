"use client";

// Portfolio, on baskvia's portfolio skeleton: an overview (address, the value
// of what you hold in the curve's own quote, a composition bar), the numbers
// (held · created · claimable), what you can claim (creator fees in the escrow,
// referral earnings in The Pound's vault), your positions and your launches.
// Every figure is read from chain for the signed-in wallet.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { CondCell, CondGrid, Empty, Footer, OutlineLink, PageHead, Panel, PrimaryButton, SectionHead } from "@/components/ui/primitives";
import { TokenCard } from "@/components/explore/TokenCards";
import { IdentityBanner, NotLive, PendingBar } from "@/components/TrustBanners";
import { useNetwork } from "@/lib/networks";
import { poundVaultAbi } from "@/lib/pound";
import { publicClient, RADIAN, tokenAbi, curveAbi, escrowAbi, arcTestnet, NATIVE_QUOTE, POUND, type LaunchRow, type QuoteAsset } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useLaunches } from "@/lib/useLaunches";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { fmtNum, fmtPrice, shortAddr } from "@/lib/ui/format";
import { assetColors } from "@/lib/ui/tokens";
import { recordTx, useTxLog, type TxKind } from "@/lib/txLog";

type Holding = { row: LaunchRow; bal: bigint; spot: number | null; value: number | null };
type Claim = { kind: "fees" | "referral"; asset: { symbol: string; decimals: number; address: Address }; amount: bigint; accrued?: bigint };

export default function PortfolioPage() {
  const t = useT();
  const net = useNetwork();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const { rows, loading } = useLaunches();
  const identity = useIdentity();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);
  const [copied, setCopied] = useState(false);
  const gasSym = net.nativeSymbol ?? "USDC";

  const load = useCallback(async () => {
    if (!address || !net.live) return;
    // balances of every launch token, then the curve reserves of what is held (for a spot value)
    const bals = rows.length
      ? await publicClient.multicall({ allowFailure: true, contracts: rows.map((r) => ({ address: r.token, abi: tokenAbi, functionName: "balanceOf" as const, args: [address] as const })) }).catch(() => [])
      : [];
    const held = rows.map((row, i) => ({ row, bal: bals[i]?.status === "success" ? (bals[i].result as bigint) : 0n })).filter((h) => h.bal > 0n);
    const reserves = held.length
      ? await publicClient.multicall({ allowFailure: true, contracts: held.map((h) => ({ address: h.row.curve, abi: curveAbi, functionName: "getReserves" as const })) }).catch(() => [])
      : [];
    setHoldings(
      held.map((h, i) => {
        const r = reserves[i]?.status === "success" ? (reserves[i].result as [bigint, bigint]) : null;
        const spot = r && r[1] > 0n ? Number(formatUnits(r[0], h.row.quoteDecimals)) / Number(formatUnits(r[1], 18)) : null;
        return { ...h, spot, value: spot != null ? spot * Number(formatUnits(h.bal, 18)) : null };
      }),
    );
    // creator fees waiting in the escrow (the gas coin, then each ERC-20 quote)
    const erc20 = net.quoteAssets.filter((q) => !q.native);
    const next: Claim[] = [];
    try {
      const contracts = [
        { address: RADIAN.escrow, abi: escrowAbi, functionName: "balanceOf", args: [address] },
        ...erc20.map((q) => ({ address: RADIAN.escrow, abi: escrowAbi, functionName: "balanceOfToken", args: [address, q.address] })),
      ] as unknown as Parameters<typeof publicClient.multicall>[0]["contracts"];
      const res = await publicClient.multicall({ allowFailure: true, contracts });
      const nat = res[0]?.status === "success" ? (res[0].result as bigint) : 0n;
      if (nat > 0n) next.push({ kind: "fees", asset: { symbol: gasSym, decimals: 18, address: NATIVE_QUOTE }, amount: nat });
      erc20.forEach((q, i) => {
        const v = res[i + 1]?.status === "success" ? (res[i + 1].result as bigint) : 0n;
        if (v > 0n) next.push({ kind: "fees", asset: { symbol: q.symbol, decimals: q.decimals, address: q.address }, amount: v });
      });
    } catch {}
    // referral earnings in The Pound's vault
    const pound = POUND;
    if (pound) {
      const assets = [{ symbol: gasSym, decimals: 18, address: NATIVE_QUOTE }, ...erc20.map((q) => ({ symbol: q.symbol, decimals: q.decimals, address: q.address }))];
      try {
        const res = await publicClient.multicall({
          allowFailure: true,
          contracts: assets.map((a) => ({ address: pound.vault, abi: poundVaultAbi, functionName: "referralOf" as const, args: [a.address, address] as const })),
        });
        assets.forEach((a, i) => {
          const v = res[i]?.status === "success" ? (res[i].result as readonly [bigint, bigint]) : ([0n, 0n] as const);
          if (v[0] > 0n || v[1] > 0n) next.push({ kind: "referral", asset: a, amount: v[0], accrued: v[1] });
        });
      } catch {}
    }
    setClaims(next);
    setRead(true);
  }, [address, rows, net.live, net.quoteAssets, gasSym]);

  useEffect(() => {
    load();
  }, [load]);

  usePendingResume(["claim"], () => {
    setPendingHash(null);
    setToast(t("portfolio.resumed"));
    load();
  });

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
      recordTx(address, { hash, kind: c.kind === "referral" ? "referralClaim" : "claim", time: Date.now() });
      setToast(t("portfolio.claimed", { sym: c.asset.symbol }));
      await load();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast(t("trade.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        setToast(err?.shortMessage ?? err?.message ?? t("portfolio.claimFailed"));
      }
    } finally {
      setBusy(null);
    }
  }

  const created = useMemo(() => (address ? rows.filter((r) => r.deployer.toLowerCase() === address.toLowerCase()) : []), [rows, address]);
  // value by quote asset; the headline is the quote with the most value
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of holdings) if (h.value != null) m.set(h.row.quoteSymbol, (m.get(h.row.quoteSymbol) ?? 0) + h.value);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [holdings]);
  const headline = totals[0];
  const lead = headline ? holdings.filter((h) => h.row.quoteSymbol === headline[0] && h.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) : [];
  const colors = assetColors(holdings.map((h) => h.row.symbol));
  const claimable = claims.filter((c) => c.amount > 0n);

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
            ) : (
              <div className="grid gap-5">
                <Panel>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button type="button" onClick={copy} className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke bg-glass-2 py-1 pl-1 pr-3 text-[11px] text-ink-2 hover:border-brand hover:text-brand">
                      <AddressAvatar address={address} size={22} />
                      {copied ? t("profile.copied") : shortAddr(address)}
                    </button>
                    <span className="mono-label text-[10px] tracking-[.12em] text-ink-3">{read ? t("portfolio.fresh", { chain: net.chainName }) : loading ? t("portfolio.reading") : t("portfolio.reading")}</span>
                  </div>
                  <div className="mt-4 text-xs text-muted">{t("portfolio.valueLabel")}</div>
                  <div className="tnum text-[clamp(34px,5vw,54px)] font-light leading-none tracking-[-1.5px] text-ink">
                    {headline ? `${fmtNum(headline[1], 4)} ${headline[0]}` : read ? "—" : "…"}
                  </div>
                  {totals.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {totals.slice(1).map(([sym, v]) => (
                        <span key={sym} className="tnum mono-label rounded-full border border-stroke px-2.5 py-0.5 text-[10.5px] text-ink-2">
                          + {fmtNum(v, 4)} {sym}
                        </span>
                      ))}
                    </div>
                  )}
                  {lead.length > 0 && headline && (
                    <>
                      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-glass-2" aria-hidden="true">
                        {lead.map((h) => (
                          <span key={h.row.token} style={{ width: `${((h.value ?? 0) / headline[1]) * 100}%`, background: colors[h.row.symbol] }} />
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
                  <CondCell label={t("portfolio.held")} value={holdings.length} />
                  <CondCell label={t("portfolio.created")} value={created.length} />
                  <CondCell label={t("portfolio.feesClaimable")} value={claimable.filter((c) => c.kind === "fees").length ? claimable.filter((c) => c.kind === "fees").map((c) => `${fmtNum(Number(formatUnits(c.amount, c.asset.decimals)), 4)} ${c.asset.symbol}`).join(" · ") : "0"} small />
                  <CondCell label={t("portfolio.refClaimable")} value={POUND ? (claimable.filter((c) => c.kind === "referral").length ? claimable.filter((c) => c.kind === "referral").map((c) => `${fmtNum(Number(formatUnits(c.amount, c.asset.decimals)), 4)} ${c.asset.symbol}`).join(" · ") : "0") : "—"} small />
                </CondGrid>

                <Panel>
                  <SectionHead title={t("portfolio.claimsTitle")} aside={POUND ? <Link href="/earn" className="hover:text-brand">{t("portfolio.toPound")}</Link> : undefined} />
                  {claims.length === 0 ? (
                    <p className="text-[13px] leading-[1.7] text-muted">{read ? t("portfolio.noClaims") : t("portfolio.reading")}</p>
                  ) : (
                    <ul className="divide-y divide-stroke rounded-xl border border-stroke">
                      {claims.map((c) => {
                        const key = `${c.kind}-${c.asset.address}`;
                        return (
                          <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-[13.5px] text-ink">{c.kind === "fees" ? t("portfolio.creatorFees") : t("portfolio.referralEarnings")}</span>
                              <span className="text-[11.5px] text-ink-3">{c.kind === "fees" ? t("portfolio.creatorFeesSub") : t("portfolio.referralSub", { v: fmtNum(Number(formatUnits(c.accrued ?? 0n, c.asset.decimals)), 6) })}</span>
                            </span>
                            <span className="tnum text-[15px] text-ink">
                              {fmtNum(Number(formatUnits(c.amount, c.asset.decimals)), 6)} {c.asset.symbol}
                            </span>
                            <button type="button" disabled={busy !== null || c.amount === 0n} onClick={() => claim(c)} className="mono-label rounded-[10px] border border-brand/50 px-3 py-1.5 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2 disabled:border-stroke disabled:text-ink-3 disabled:opacity-60">
                              {busy === key ? "…" : t("portfolio.claim")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>

                <Panel>
                  <SectionHead title={t("portfolio.positions")} aside={String(holdings.length)} />
                  {holdings.length === 0 ? (
                    <Empty>
                      {read ? t("portfolio.noHoldings") : t("portfolio.reading")}
                      <br />
                      <Link href="/explore" className="mt-2 inline-block text-brand hover:underline">
                        {t("nf.cta")}
                      </Link>
                    </Empty>
                  ) : (
                    <ul className="divide-y divide-stroke">
                      {holdings
                        .slice()
                        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                        .map((h) => (
                          <li key={h.row.token} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3">
                            <AssetLogo symbol={h.row.symbol} src={/^https?:\/\//.test(h.row.logo) ? h.row.logo : null} seed={h.row.token} size={34} radius={17} />
                            <span className="min-w-0">
                              <Link href={`/token/${h.row.token}`} className="block truncate text-[14px] font-semibold text-ink hover:text-brand">
                                {h.row.name} <span className="mono-label text-[11px] font-normal text-ink-3">${h.row.symbol}</span>
                              </Link>
                              <span className="tnum block text-[11.5px] text-ink-3">
                                {fmtNum(Number(formatUnits(h.bal, 18)), 0)} {h.row.symbol}
                                {h.spot != null && ` · ${fmtPrice(h.spot)} ${h.row.quoteSymbol}`}
                                {h.row.graduated && ` · ${t("tcard.graduated")}`}
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="tnum block text-[15px] text-ink">{h.value != null ? `${fmtNum(h.value, 4)} ${h.row.quoteSymbol}` : "—"}</span>
                              {!h.row.graduated && (
                                <Link href={`/swap?token=${h.row.token}`} className="mono-label text-[10px] tracking-[.1em] text-ink-3 hover:text-brand">
                                  {t("portfolio.trade")}
                                </Link>
                              )}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </Panel>

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
          {toast}
        </button>
      )}
    </Shell>
  );
}

/** Transactions this browser sent for the wallet (lib/txLog). A full history needs the indexer's event scan. */
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
      <SectionHead title={t("tx.title")} aside={String(log.length)} />
      <p className="-mt-3 mb-3 text-[12.5px] leading-[1.7] text-muted">{t("tx.scope")}</p>
      {log.length === 0 ? (
        <Empty>{t("tx.none")}</Empty>
      ) : (
        <ul className="divide-y divide-stroke rounded-xl border border-stroke">
          {log.slice(0, 30).map((r) => {
            const code = r.token ? sym.get(r.token.toLowerCase()) : undefined;
            return (
              <li key={r.hash} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="w-28 flex-none font-semibold text-ink">{KIND[r.kind] ?? r.kind}</span>
                <span className="min-w-0 flex-1 text-ink-2">
                  {r.token ? (
                    <Link href={`/token/${r.token}`} className="hover:text-brand">
                      {code ? `$${code}` : shortAddr(r.token)}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="tnum text-[11.5px] text-ink-3">{new Date(r.time).toLocaleString()}</span>
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
