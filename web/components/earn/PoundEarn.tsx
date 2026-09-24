"use client";

// The Pound on the networks that run it, on baskvia's /earn skeleton: the claim
// and your link, what you can claim, the two ways to earn, the Pack's numbers,
// the Pack itself, the ledger and the top referrers. Every number is read from
// the vault / burner or decoded from their events by the indexer.
import { ArrowRight, Check, ChevronDown, Coins, Link2, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { CondCell, CondGrid, Panel, SectionHead } from "@/components/ui/primitives";
import { Info } from "@/components/ui/Info";
import { Spinner } from "@/components/ui/rows";
import { DataTable, TD, TD_MONO, TD_NUM } from "@/components/ui/DataTable";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import type { NetworkConfig } from "@/lib/networks";
import { publicClient, arcTestnet, QUOTE_ASSETS, NATIVE_QUOTE } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { poundVaultAbi, fetchPound, fetchReferral, type PoundView, type ReferralView } from "@/lib/pound";
import { referralLink } from "@/lib/referral";
import { fmtNum, shortAddr } from "@/lib/ui/format";
import { recordTx } from "@/lib/txLog";

const ZERO = "0x0000000000000000000000000000000000000000";
const fmt = (v: string | bigint | undefined, dec: number, max = 4) => (v === undefined ? "—" : fmtNum(Number(formatUnits(typeof v === "string" ? BigInt(v) : v, dec)), max));
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

// `net` comes from the page's SSR-safe network hook: a child hook would start on the
// default network for its first render (no `pound` there) and crash before syncing.
export function PoundEarn({ net }: { net: NetworkConfig }) {
  const t = useT();
  const pound = net.pound!;
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const identity = useIdentity();
  const [view, setView] = useState<PoundView | null>(null);
  const [mine, setMine] = useState<ReferralView | null>(null);
  const [live, setLive] = useState<Record<string, { claimable: bigint; accrued: bigint }>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState<"buyer" | "creator" | null>(null);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);

  const gasSym = net.nativeSymbol ?? "USDC";
  const assetMeta = (asset: string) => {
    const a = asset.toLowerCase();
    if (a === ZERO) return { symbol: gasSym, decimals: 18 };
    const q = QUOTE_ASSETS.find((x) => x.address.toLowerCase() === a);
    return q ? { symbol: q.symbol, decimals: q.decimals } : { symbol: "TOKEN", decimals: 18 };
  };

  const refresh = useCallback(async () => {
    try {
      setView(await fetchPound());
    } catch {}
    if (address) {
      try {
        setMine(await fetchReferral(address));
      } catch {}
      const assets: Address[] = [NATIVE_QUOTE, ...QUOTE_ASSETS.filter((q) => !q.native).map((q) => q.address)];
      try {
        const r = await publicClient.multicall({ allowFailure: true, contracts: assets.map((a) => ({ address: pound.vault, abi: poundVaultAbi, functionName: "referralOf" as const, args: [a, address] })) });
        const next: Record<string, { claimable: bigint; accrued: bigint }> = {};
        assets.forEach((a, i) => {
          const v = r[i].status === "success" ? (r[i].result as readonly [bigint, bigint]) : ([0n, 0n] as const);
          next[a.toLowerCase()] = { claimable: v[0], accrued: v[1] };
        });
        setLive(next);
      } catch {}
    }
  }, [address, pound.vault]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 20000);
    return () => clearInterval(iv);
  }, [refresh]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(iv);
  }, []);
  usePendingResume(["claim"], () => {
    setPendingHash(null);
    setToast(t("portfolio.resumed"));
    refresh();
  });

  async function claim(asset: Address) {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return setToast(t("quick.identity"));
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error(t("create.noWallet"));
      setToast(t("portfolio.confirmClaim", { sym: assetMeta(asset).symbol }));
      const hash = await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: pound.vault, abi: poundVaultAbi, functionName: "claimReferral", args: [asset] });
      await waitReceipt(hash, "claim");
      recordTx(wc.account, { hash, kind: "referralClaim", time: Date.now() });
      setToast(t("portfolio.claimed", { sym: assetMeta(asset).symbol }));
      await refresh();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast(t("trade.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        setToast(err?.shortMessage ?? err?.message ?? t("portfolio.claimFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const link = address ? referralLink(address) : null;
  const getLink = () => {
    if (!address) return login();
    navigator.clipboard?.writeText(link ?? "").then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => setToast(link ?? ""),
    );
  };

  const burnShare = view ? view.vault.burnShareBps : 7000;
  const refBps = view ? view.vault.referralBps : 555;
  const spentRows = (view?.assets ?? []).filter((a) => BigInt(a.burnSpent) > 0n);
  const poolRows = (view?.assets ?? []).filter((a) => BigInt(a.burnPool) > 0n);
  const nextBurnIn = view ? Math.max(0, view.burner.lastBurnAt + view.burner.minInterval - now) : 0;
  const myRows = Object.entries(live).filter(([, v]) => v.accrued > 0n || v.claimable > 0n);
  const referred = mine ? mine.assets.reduce((n, a) => n + a.trades, 0) : 0;
  const ago = (unix: number) => {
    if (!unix) return t("pound.never");
    const s = Math.max(0, now - unix);
    return s < 3600 ? t("pound.minAgo", { n: Math.floor(s / 60) }) : s < 86400 ? t("pound.hAgo", { n: Math.floor(s / 3600) }) : t("pound.dAgo", { n: Math.floor(s / 86400) });
  };
  const ways = [
    { key: "buyer" as const, title: t("pound.buyerTitle"), sub: t("pound.buyerSub", { p: pct(refBps) }), how: t("pound.buyerHow", { p: pct(refBps) }), Icon: Link2 },
    { key: "creator" as const, title: t("pound.creatorTitle"), sub: t("pound.creatorSub", { p: pct(refBps) }), how: t("pound.creatorHow", { p: pct(refBps) }), Icon: Coins },
  ];

  return (
    <>
      <IdentityBanner identity={identity} />
      <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />

      <header className="pt-4 text-center">
        <span className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-4 py-1.5 text-[10.5px] tracking-[.16em] text-ink-2">
          <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />
          {t("pound.eyebrow")}
        </span>
        <h1 className="mt-6 text-[clamp(38px,7vw,84px)] font-bold uppercase leading-[.95] tracking-[-2px] text-ink">
          {t("pound.title1")}
          <br />
          <span className="bg-[image:var(--brand-grad)] bg-clip-text text-transparent">{t("pound.title2")}</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[56ch] text-[16px] leading-[1.65] text-ink-2">{t("pound.sub", { chain: net.label, ref: pct(refBps), burn: pct(burnShare) })}</p>
        <button type="button" onClick={getLink} className="grad-fill mono-label mt-7 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[12px] font-semibold tracking-[.14em]">
          {copied ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Link2 size={14} strokeWidth={2} aria-hidden="true" />}
          {copied ? t("pound.copied") : authenticated ? t("pound.getLink") : t("pound.signInLink")}
        </button>
        {link ? (
          <p className="mx-auto mt-3 max-w-[560px] break-all rounded-[10px] border border-stroke bg-glass-2 px-3 py-2 font-mono text-[12px] text-ink-2">{link}</p>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-3">{t("pound.needWallet")}</p>
        )}
        <p className="mt-2 text-[11.5px] text-ink-3">{t("pound.linkNote")}</p>
        <p className="mono-label mt-5 text-[10.5px] tracking-[.14em] text-ink-3">
          {t("pound.createLine")}{" "}
          <Link href="/create" className="text-brand hover:underline">
            {t("pound.createLink")}
          </Link>
        </p>
      </header>

      <Panel className="mx-auto mt-10 max-w-[760px]">
        <div className="mono-label text-[10.5px] tracking-[.16em] text-brand">{t("pound.claimable")}</div>
        {!authenticated ? (
          <p className="mt-3 text-[13.5px] leading-[1.7] text-muted">{t("pound.claimSignIn")}</p>
        ) : myRows.length === 0 ? (
          <>
            <div className="tnum mt-2 text-[48px] font-light leading-none text-ink">0</div>
            <p className="mt-3 text-[13.5px] leading-[1.7] text-muted">{t("pound.nothing")}</p>
          </>
        ) : (
          <ul className="mt-3 divide-y divide-stroke rounded-xl border border-stroke">
            {myRows.map(([asset, v]) => {
              const m = assetMeta(asset);
              return (
                <li key={asset} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="tnum block text-[18px] text-ink">
                      {fmt(v.claimable, m.decimals, 6)} {m.symbol}
                    </span>
                    <span className="text-[11.5px] text-ink-3">{t("pound.accruedAllTime", { v: fmt(v.accrued, m.decimals, 6), sym: m.symbol })}</span>
                  </span>
                  <button type="button" disabled={busy || v.claimable === 0n} onClick={() => claim(asset as Address)} className="mono-label rounded-[10px] border border-brand/50 px-3 py-1.5 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2 disabled:border-stroke disabled:text-ink-3 disabled:opacity-60">
                    {busy ? <Spinner size={12} /> : t("portfolio.claim")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {referred > 0 && <p className="mt-3 text-[12px] leading-[1.7] text-ink-3">{t("pound.referredNote", { n: referred })}</p>}
      </Panel>

      <section aria-labelledby="pound-ways" className="mx-auto mt-10 max-w-[760px]">
        <h2 id="pound-ways" className="text-center text-[clamp(24px,3.4vw,34px)] font-bold uppercase tracking-[-.5px] text-ink">
          {t("pound.twoWays")}
        </h2>
        <div className="mt-6 grid gap-4 min-[720px]:grid-cols-2">
          {ways.map((w) => (
            <article key={w.key} className="glass-panel rounded-2xl p-5">
              <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                <w.Icon size={16} strokeWidth={1.8} aria-hidden="true" className="text-brand" />
                {w.title}
              </div>
              <div className="tnum mt-3 text-[40px] font-bold text-ink">{pct(refBps)}</div>
              <p className="text-[13px] text-muted">{w.sub}</p>
              <button type="button" aria-expanded={open === w.key} onClick={() => setOpen(open === w.key ? null : w.key)} className="mono-label mt-4 inline-flex items-center gap-1 text-[10.5px] tracking-[.14em] text-ink-3 hover:text-ink">
                {t("pound.how")} <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" className={`transition-transform ${open === w.key ? "rotate-180" : ""}`} />
              </button>
              {open === w.key && <p className="mt-2 text-[13px] leading-[1.7] text-ink-2">{w.how}</p>}
            </article>
          ))}
        </div>
      </section>

      <div className="mx-auto mt-10 grid max-w-[980px] gap-4 min-[720px]:grid-cols-3">
        {(
          [
            [Coins, "pound.feat1Title", "pound.feat1Body"],
            [Wallet, "pound.feat2Title", "pound.feat2Body"],
            [ShieldCheck, "pound.feat3Title", "pound.feat3Body"],
          ] as const
        ).map(([Icon, title, body]) => (
          <article key={title} className="glass-panel rounded-2xl p-5">
            <Icon size={18} strokeWidth={1.8} aria-hidden="true" className="text-brand" />
            <h3 className="mt-3 text-[15px] font-semibold text-ink">{t(title)}</h3>
            <p className="mt-1.5 text-[13px] leading-[1.7] text-muted">{t(body)}</p>
          </article>
        ))}
      </div>

      <CondGrid className="mt-10">
        <CondCell label={<>{t("pound.coinsInPack")} <Info text={t("pound.infoPack")} /></>} value={view ? String(view.packs.filter((p) => p.active).length) : "—"} />
        <CondCell label={<>{t("pound.spentOnBurns")} <Info text={t("pound.infoSpent")} /></>} value={spentRows.length ? spentRows.map((a) => `${fmt(a.burnSpent, a.decimals, 2)} ${a.symbol}`).join(" · ") : view ? "0" : "—"} small />
        <CondCell label={<>{t("pound.burnPool")} <Info text={t("pound.infoPool")} /></>} value={poolRows.length ? poolRows.map((a) => `${fmt(a.burnPool, a.decimals, a.decimals >= 18 ? 5 : 2)} ${a.symbol}`).join(" · ") : view ? "0" : "—"} small />
        <CondCell
          label={<>{t("pound.earnedByReferrers")} <Info text={t("pound.infoReferrers")} /></>}
          value={
            view
              ? view.assets
                  .filter((a) => BigInt(a.totalReferrals) + BigInt(a.totalPending) > 0n)
                  .map((a) => `${fmt(BigInt(a.totalReferrals) + BigInt(a.totalPending), a.decimals, 2)} ${a.symbol}`)
                  .join(" · ") || "0"
              : "—"
          }
          small
        />
      </CondGrid>

      <Panel className="mt-5">
        <SectionHead title={t("pound.packTitle")} aside={view && view.burner.lastBurnAt > 0 ? t("pound.lastBurn", { when: ago(view.burner.lastBurnAt) }) : t("pound.noBurnYet")} />
        <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">
          {t("pound.packBody", { slip: view ? pct(view.burner.maxSlippageBps) : "—" })} {view && view.burner.nextPack != null && nextBurnIn > 0 ? t("pound.nextIn", { h: Math.ceil(nextBurnIn / 3600) }) : ""}
        </p>
        {!view ? (
          <p className="text-[13px] text-muted">{t("pound.readingBurner")}</p>
        ) : view.packs.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-stroke-2 px-4 py-5 text-center text-[13px] text-ink-3">{t("pound.packEmpty")}</p>
        ) : (
          <DataTable head={["#", t("pound.colCoin"), t("pound.colPerBurn"), t("pound.colBurned"), t("pound.colStatus")]} align={["left", "left", "right", "right", "left"]}>
            {view.packs.map((p) => {
              const am = assetMeta(p.asset);
              const next = view.burner.nextPack === p.index;
              return (
                <tr key={p.index}>
                  <td className={TD}>{p.index}</td>
                  <td className={TD}>
                    <a href={`${net.explorer}/address/${p.token}`} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">
                      {p.symbol ?? shortAddr(p.token)}
                    </a>
                    <span className="ml-2 text-[11px] text-ink-3">{t("pound.poolFee", { v: (p.poolFee / 10000).toFixed(2) })}</span>
                  </td>
                  <td className={TD_NUM}>
                    {fmt(p.floor, am.decimals, 4)} – {fmt(p.maxPerBurn, am.decimals, 4)} {am.symbol}
                  </td>
                  <td className={`${TD_NUM} text-brand-3`}>{fmt(p.burned, 18, 0)}</td>
                  <td className={TD}>{!p.active ? t("pound.paused") : next ? t("pound.nextInRotation") : t("pound.active")}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      <Panel className="mt-5">
        <SectionHead title={t("pound.ledgerTitle")} />
        <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{t("pound.ledgerBody")}</p>
        {!view?.ledger?.length ? (
          <p className="text-[13px] text-muted">{t("pound.noEntries")}</p>
        ) : (
          <DataTable head={[t("pound.colWhen"), t("pound.colEvent"), t("pound.colAmounts"), "Tx"]}>
            {view.ledger.slice(0, 40).map((r) => {
              const m = assetMeta(r.asset ?? ZERO);
              const pack = r.token ? view.packs.find((p) => p.token.toLowerCase() === r.token!.toLowerCase()) : undefined;
              const what =
                r.kind === "settle"
                  ? t("pound.evSettled")
                  : r.kind === "burn"
                    ? t("pound.evBurned", { sym: pack?.symbol ?? shortAddr(r.token) })
                    : r.kind === "referralClaim"
                      ? t("pound.evClaimed")
                      : r.kind === "packAdded"
                        ? t("pound.evPackAdded", { sym: pack?.symbol ?? shortAddr(r.token) })
                        : r.kind === "packSet"
                          ? t("pound.evPackSet", { n: r.index ?? 0 })
                          : r.kind;
              const amounts =
                r.kind === "settle"
                  ? `${fmt(r.intake, m.decimals)} ${m.symbol} → ${fmt(r.toReferrals, m.decimals)} ${t("pound.amtReferrals")} · ${fmt(r.toBurn, m.decimals)} ${t("pound.amtBurnPool")} · ${fmt(r.toTreasury, m.decimals)} ${t("pound.amtTreasury")}`
                  : r.kind === "burn"
                    ? `${fmt(r.quoteIn, m.decimals)} ${m.symbol} → ${fmt(r.tokensOut, 18, 0)} ${pack?.symbol ?? "tokens"} → 0x…dEaD · ${t("pound.amtBounty")} ${fmt(r.bounty, m.decimals, 6)}`
                    : r.kind === "referralClaim"
                      ? `${fmt(r.amount, m.decimals, 6)} ${m.symbol} → ${shortAddr(r.referrer)}`
                      : r.kind === "packAdded" || r.kind === "packSet"
                        ? `${t("pound.amtFloor")} ${fmt(r.floor, m.decimals)} · ${t("pound.amtCap")} ${fmt(r.maxPerBurn, m.decimals)} ${m.symbol}${r.kind === "packSet" ? (r.active ? ` · ${t("pound.active")}` : ` · ${t("pound.paused")}`) : ""}`
                        : "";
              return (
                <tr key={`${r.txHash}-${r.logIndex}`}>
                  <td className={`${TD} whitespace-nowrap`}>{new Date(r.ts).toLocaleString()}</td>
                  <td className={`${TD} whitespace-nowrap ${r.kind === "burn" ? "text-brand-3" : r.kind === "referralClaim" ? "text-pos" : ""}`}>{what}</td>
                  <td className={TD}>{amounts}</td>
                  <td className={TD_MONO}>
                    <a href={`${net.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {r.txHash.slice(0, 10)}…
                    </a>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>

      {view && view.referrers.length > 0 && (
        <Panel className="mt-5">
          <SectionHead title={t("pound.topReferrers")} />
          <DataTable head={[t("pound.colReferrer"), t("pound.colEarned"), t("pound.colTrades")]} align={["left", "right", "right"]}>
            {view.referrers.slice(0, 10).map((r) => {
              const m = assetMeta(r.asset);
              return (
                <tr key={`${r.asset}-${r.referrer}`}>
                  <td className={TD}>
                    <Link href={`/profile/${r.referrer}`} className="font-mono text-[12px] text-ink hover:text-brand">
                      {shortAddr(r.referrer)}
                    </Link>
                    {address && r.referrer.toLowerCase() === address.toLowerCase() && <span className="mono-label ml-2 text-[9.5px] text-brand">{t("pound.you")}</span>}
                  </td>
                  <td className={`${TD_NUM} text-pos`}>
                    {fmt(r.accrued, m.decimals, 6)} {m.symbol}
                  </td>
                  <td className={TD_NUM}>{r.trades}</td>
                </tr>
              );
            })}
          </DataTable>
        </Panel>
      )}

      <p className="mt-6 text-center text-[12px] text-ink-3">
        {t("pound.contracts")}{" "}
        <a href={`${net.explorer}/address/${pound.vault}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          {t("detail.cVault")}
        </a>{" "}
        ·{" "}
        <a href={`${net.explorer}/address/${pound.burner}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          {t("detail.cBurner")}
        </a>{" "}
        ·{" "}
        <a href={`${net.explorer}/address/${net.contracts.router}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          {t("detail.cRouter")}
        </a>{" "}
        ·{" "}
        <Link href="/factory" className="inline-flex items-center gap-1 text-brand hover:underline">
          {t("pound.howSet")} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
        </Link>
      </p>

      {toast && (
        <button type="button" onClick={() => setToast(null)} className="fixed bottom-[88px] left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-stroke bg-night px-4 py-3 text-left text-sm text-ink shadow-[var(--shadow)] nav:bottom-6">
          {toast}
        </button>
      )}
    </>
  );
}
