"use client";

// The token page on baskvia's basket-detail skeleton: head (hero washed in the
// quote asset's colour), one big card (curve · chart + trade · stats · trades ·
// fees & contracts), then the launch template's panels (The Wall / Proof-of-Fee)
// and delegated auto-buy. All state comes from one multicall against the token
// and its curve, polled every 12s; the curve address from the local registry or
// the indexer; 24h facts and the spark from the indexer's launch row.
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatUnits, isAddress, parseAbi, type Address } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Empty, Footer, OutlineLink } from "@/components/ui/primitives";
import { DetailHead } from "@/components/token/DetailHead";
import { ChartTrade, CurveSection, FeesContracts, SinceCard, StatsRow, TradesSection, sparkOf, statsOf } from "@/components/token/DetailBody";
import { HolderWall } from "@/components/token/HolderWall";
import { ZERO_ADDR, type TokenState } from "@/components/token/types";
import type { TradeToken } from "@/components/trade/SwapForm";
import { StockRef } from "@/components/StockRef";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import { WallTreasuryPanel, WallStakePanel, WallLadderPanel } from "@/components/WallPanels";
import { PoFPanel } from "@/components/PoFPanel";
import { AutoBuyPanel } from "@/components/AutoBuyPanel";
import { publicClient, curveAbi, tokenAbi, erc20Abi, quoteByAddress, RADIAN, hasPofRouter, hasExecutor, type LaunchTemplate } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { findCurve } from "@/lib/registry";
import { fetchTokenMeta, fetchTokenTrades, hasIndexer, type Sunset, type TokenTrade } from "@/lib/indexer";
import { useIdentity } from "@/lib/identity";
import { usePendingResume } from "@/lib/pendingTx";
import { pofRouterAbi } from "@/lib/templates";
import { useLaunches } from "@/lib/useLaunches";

// the fee policy snapshotted at launch: who gets the protocol share, and how much of the fee it is
const curvePolicyAbi = parseAbi(["function protocolFeeRecipient() view returns (address)", "function protocolFeeShareBps() view returns (uint16)"]);

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const token = address as Address;
  const t = useT();
  const { address: account } = useRadianWallet();
  const [st, setSt] = useState<TokenState | null>(null);
  const [myTokens, setMyTokens] = useState<bigint>(0n);
  const [toast, setToast] = useState<string | null>(null);
  // A toast says its piece and goes; the timer is cleared when a new one replaces it.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const [notFound, setNotFound] = useState(false);
  const [sunset, setSunset] = useState<Sunset | null>(null);
  const [creator, setCreator] = useState<Address | null>(null);
  const [trades, setTrades] = useState<TokenTrade[]>([]);
  const [tradesLoaded, setTradesLoaded] = useState(false);
  // Launch template (The Wall / Proof-of-Fee) from the indexer, with an on-chain
  // fallback for PoF. Immutable per launch, so it is resolved once.
  const [template, setTemplate] = useState<LaunchTemplate | null>(null);
  const templateRef = useRef<LaunchTemplate | null>(null);
  const pofCheckedRef = useRef(false);
  // Bumped after a resumed (previously lost) transaction so the template /
  // auto-buy panels re-read their state.
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedRef = useRef(false);
  const identity = useIdentity();
  const [pendingHash, setPendingHash] = useState<Address | null>(null);
  const { rows } = useLaunches();
  const row = useMemo(() => rows.find((r) => r.token.toLowerCase() === token.toLowerCase()), [rows, token]);

  const load = useCallback(async () => {
    // Curve address comes from the local registry (getLogs is unreliable on
    // Arc). If this token wasn't launched in this browser, fall back to the
    // indexer so any token visible on Explore also opens here.
    if (!isAddress(token, { strict: false })) {
      setNotFound(true);
      return;
    }
    const reg = findCurve(token);
    let curve = (reg?.curve ?? null) as Address | null;
    if (reg?.deployer) setCreator(reg.deployer as Address);
    if (hasIndexer()) {
      // The indexer also knows the creator and whether this launch was retired for a successor.
      const meta = await fetchTokenMeta(token);
      if (!curve) curve = meta?.curve ?? null;
      if (meta) {
        setSunset(meta.sunset ?? null);
        if (meta.deployer && meta.deployer !== ZERO_ADDR) setCreator(meta.deployer);
        if (meta.template && !templateRef.current) {
          templateRef.current = meta.template;
          setTemplate(meta.template);
        }
      }
    }
    if (!curve) {
      // Only declare "not found" if we have never loaded this token; a transient
      // indexer failure must not hide a token that was already on screen.
      if (!loadedRef.current) setNotFound(true);
      return;
    }
    // Until the indexer reports templates, Proof-of-Fee launches are still
    // recognisable on-chain: the PoF router keeps a registry. (The Wall has no
    // registry, so it relies on the indexer.)
    if (!templateRef.current && !pofCheckedRef.current && hasPofRouter) {
      pofCheckedRef.current = true;
      try {
        const [vault] = (await publicClient.readContract({
          address: RADIAN.pofRouter, abi: pofRouterAbi, functionName: "launches", args: [token],
        })) as readonly [Address, Address, Address];
        if (vault && vault !== ZERO_ADDR) {
          const tpl: LaunchTemplate = { kind: "pof", vault, pofRouter: RADIAN.pofRouter };
          templateRef.current = tpl;
          setTemplate(tpl);
        }
      } catch {
        pofCheckedRef.current = false; // RPC hiccup: try again on the next poll
      }
    }
    // one Multicall3 batch instead of 16 separate RPC reads (poll-friendly)
    const mc = await publicClient.multicall({
      allowFailure: true,
      contracts: [
        { address: token, abi: tokenAbi, functionName: "name" },
        { address: token, abi: tokenAbi, functionName: "symbol" },
        { address: token, abi: tokenAbi, functionName: "logo" },
        { address: token, abi: tokenAbi, functionName: "description" },
        { address: curve, abi: curveAbi, functionName: "getReserves" },
        { address: curve, abi: curveAbi, functionName: "trackedQuote" },
        { address: curve, abi: curveAbi, functionName: "graduationThreshold" },
        { address: curve, abi: curveAbi, functionName: "graduated" },
        { address: curve, abi: curveAbi, functionName: "sellableTokens" },
        { address: curve, abi: curveAbi, functionName: "pairToken" },
        { address: curve, abi: curveAbi, functionName: "feeBps" },
        { address: curve, abi: curveAbi, functionName: "creatorTaxBps" },
        { address: curve, abi: curveAbi, functionName: "snipeTaxSeconds" },
        { address: token, abi: tokenAbi, functionName: "socials" },
        { address: curve, abi: curvePolicyAbi, functionName: "protocolFeeRecipient" },
        { address: curve, abi: curvePolicyAbi, functionName: "protocolFeeShareBps" },
      ],
    });
    const name = mc[0].result as string | undefined;
    const symbol = mc[1].result as string | undefined;
    if (!name || !symbol) {
      if (!loadedRef.current) setNotFound(true);
      return;
    }
    const tracked = (mc[5].result as bigint | undefined) ?? 0n;
    const gthr = (mc[6].result as bigint | undefined) ?? 0n;
    const pair = (mc[9].result as Address | undefined) ?? ZERO_ADDR;
    const r = (mc[4].result as [bigint, bigint] | undefined) ?? [0n, 0n];
    let qa = quoteByAddress(pair as string);
    if (!qa) {
      // An owner-approved pair token we have no config for: read its metadata
      // from chain rather than guessing (a wrong "native" guess would send
      // msg.value to an ERC-20 curve and revert).
      const [sym, dec] = await Promise.all([
        publicClient.readContract({ address: pair, abi: erc20Abi, functionName: "symbol" }).catch(() => "PAIR"),
        publicClient.readContract({ address: pair, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
      ]);
      const decimals = Number(dec);
      qa = { key: pair.toLowerCase(), symbol: String(sym), address: pair, decimals, native: false, blurb: "Approved pair asset", gradGoal: Number(formatUnits(gthr, decimals)) };
    }
    const socials = mc[13].result as readonly string[] | undefined; // [twitter, telegram, discord, website, farcaster]
    setSt({
      name,
      symbol,
      logo: (mc[2].result as string) ?? "",
      description: (mc[3].result as string) ?? "",
      curve,
      quoteReserve: r[0],
      tokenReserve: r[1],
      trackedQuote: tracked,
      graduationThreshold: gthr,
      graduated: (mc[7].result as boolean | undefined) ?? false,
      sellable: (mc[8].result as bigint | undefined) ?? 0n,
      quoteDecimals: qa.decimals,
      quoteSymbol: qa.symbol,
      pairToken: pair,
      native: qa.native,
      quoteAsset: qa,
      feeBps: (mc[10].result as bigint | undefined) ?? 100n,
      creatorTaxBps: (mc[11].result as bigint | undefined) ?? 0n,
      snipeTaxSeconds: (mc[12].result as bigint | undefined) ?? 0n,
      protocolRecipient: (mc[14].result as Address | undefined) ?? ZERO_ADDR,
      protocolShareBps: BigInt((mc[15].result as number | bigint | undefined) ?? 0),
      website: socials?.[3] || undefined,
      twitter: socials?.[0] || undefined,
    });
    loadedRef.current = true;
    setNotFound(false);
  }, [token]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 12000);
    return () => clearInterval(iv);
  }, [load]);

  // The trade log (indexer only): the chart when the launch row has no spark, and the list.
  useEffect(() => {
    if (!hasIndexer() || !isAddress(token, { strict: false })) return;
    let alive = true;
    const pull = () =>
      fetchTokenTrades(token)
        .then((tr) => {
          if (!alive) return;
          setTrades(tr);
          setTradesLoaded(true);
        })
        .catch(() => alive && setTradesLoaded(true));
    pull();
    const iv = setInterval(pull, 10000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [token]);

  useEffect(() => {
    if (!account || !isAddress(token, { strict: false })) return;
    publicClient
      .readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] })
      .then((b) => setMyTokens(b as bigint))
      .catch(() => {});
  }, [account, token, st]);

  // Trades (and template / auto-buy actions) whose receipt this tab lost are
  // resolved from chain, never resent.
  usePendingResume(["buy", "sell", "stake", "unstake", "claim", "deposit", "withdraw", "cancel"], (p) => {
    if ((p.meta?.token ?? "").toLowerCase() !== token.toLowerCase()) return;
    setPendingHash(null);
    setToast(t("detail.resumed", { kind: p.kind }));
    load();
    setRefreshKey((k) => k + 1);
  });

  const afterTrade = () => {
    load();
    setRefreshKey((k) => k + 1);
  };

  const tk: TradeToken | null = st
    ? { token, curve: st.curve, pairToken: st.pairToken, native: st.native, template, name: st.name, symbol: st.symbol, quoteSymbol: st.quoteSymbol, quoteDecimals: st.quoteDecimals, graduated: st.graduated }
    : null;
  const spark = useMemo(() => sparkOf(row, trades), [row, trades]);
  const stats = useMemo(() => statsOf(row, trades), [row, trades]);

  return (
    <Shell crumbSuffix={st?.name}>
      <IdentityBanner identity={identity} />
      <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />

      {!st || !tk ? (
        <div className="screen-in">
          {notFound ? (
            <Empty>
              <div className="text-lg font-semibold text-ink">{t("detail.notFound")}</div>
              <p className="mt-2">{isAddress(token, { strict: false }) ? t("detail.notFoundBody") : t("detail.badAddr")}</p>
              <OutlineLink href="/explore" className="mt-4">
                {t("detail.browse")}
              </OutlineLink>
            </Empty>
          ) : (
            <Empty>{t("detail.loading")}</Empty>
          )}
        </div>
      ) : (
        <div className="screen-in">
          <DetailHead token={token} st={st} creator={creator} row={row} template={template} sunset={sunset} onToast={setToast} />

          {sunset && (
            <div role="note" className="mt-4 rounded-[12px] border border-signal/40 bg-[rgba(106,208,224,.08)] px-4 py-3 text-sm text-ink-2">
              <b className="text-ink">{t("detail.sunset")}</b> {sunset.reason}{" "}
              <Link href={`/token/${sunset.successor}`} className="font-semibold text-brand hover:underline">
                {t("detail.sunsetGo")}
              </Link>
            </div>
          )}

          <div className="glass-panel mt-6 overflow-hidden rounded-2xl p-0">
            <SinceCard st={st} spark={spark} />
            <CurveSection st={st} token={token} />
            <ChartTrade st={st} spark={spark} tk={tk} onTraded={afterTrade} onPending={(h) => setPendingHash(h)} loaded={tradesLoaded || !hasIndexer()} />
            <StatsRow st={st} stats={stats} />
            {st.quoteAsset.stock && (
              <div className="border-b border-stroke p-5">
                <StockRef asset={st.quoteAsset} />
              </div>
            )}
            {hasIndexer() && <TradesSection trades={trades} loaded={tradesLoaded} quoteSymbol={st.quoteSymbol} />}
            {hasIndexer() && <HolderWall token={token} symbol={st.symbol} myTokens={myTokens} />}
            <FeesContracts token={token} st={st} template={template} />
          </div>

          {(template || (!st.graduated && hasExecutor && !sunset)) && (
            <div className="mt-6 grid gap-4">
              {template?.kind === "wall" && (
                <>
                  <WallTreasuryPanel
                    treasury={template.treasury} staking={template.staking} token={token} symbol={st.symbol} quote={st.quoteAsset}
                    identity={identity} onToast={setToast} onPending={setPendingHash} refreshKey={refreshKey}
                  />
                  <WallStakePanel
                    staking={template.staking} token={token} symbol={st.symbol} quote={st.quoteAsset} myTokens={myTokens}
                    identity={identity} onToast={setToast} onPending={setPendingHash} refreshKey={refreshKey}
                  />
                  {template.ladder && st.graduated && <WallLadderPanel ladder={template.ladder} symbol={st.symbol} quote={st.quoteAsset} refreshKey={refreshKey} />}
                </>
              )}
              {template?.kind === "pof" && (
                <PoFPanel
                  vault={template.vault} pofRouter={template.pofRouter} token={token} symbol={st.symbol} quote={st.quoteAsset}
                  identity={identity} onToast={setToast} onPending={setPendingHash} refreshKey={refreshKey}
                />
              )}
              {!st.graduated && hasExecutor && !sunset && (
                <AutoBuyPanel
                  token={token} curve={st.curve} symbol={st.symbol} quote={st.quoteAsset}
                  identity={identity} onToast={setToast} onPending={setPendingHash} refreshKey={refreshKey}
                />
              )}
            </div>
          )}

          <Footer />
        </div>
      )}

      {toast && (
        <button
          type="button"
          onClick={() => setToast(null)}
          className="fixed bottom-[88px] left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-stroke bg-night px-4 py-3 text-left text-sm text-ink shadow-[var(--shadow)] nav:bottom-6"
        >
          {toast}
        </button>
      )}
    </Shell>
  );
}
