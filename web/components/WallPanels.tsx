"use client";

// "The Wall" template on the design system: a per-launch treasury that piles
// up the quote asset (never sold), streams a slice of each fee claim to
// stakers and keeps a standing bid under book value on the curve; after
// graduation, a bid ladder in the V4 pool. Everything shown is read from the
// launch's own contracts; a dash means the read failed, never zero.
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseEther, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { OutlineButton, Panel, PrimaryButton } from "@/components/ui/primitives";
import { DataTable, TD, TD_MONO, TD_NUM } from "@/components/ui/DataTable";
import { Divider, Note, PanelHead, Row, Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import { publicClient, arcTestnet, erc20Abi, tokenAbi, explorer, type QuoteAsset } from "@/lib/radian";
import { wallTreasuryAbi, wallStakingAbi, wallLadderAbi, tickToQuotePer1e18, fmtAmount, fmtPrice, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";
import { recordTx } from "@/lib/txLog";

type Common = {
  token: Address;
  symbol: string;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: Hex) => void;
  refreshKey: number; // bumped by the page after a resumed transaction
};

type TreasuryData = Partial<{
  reserve: bigint; claimable: bigint; circulating: bigint; bookValue: bigint; spot: bigint; floorPrice: bigint;
  budgetRemaining: bigint; quoteToRestoreFloor: bigint; totalClaimed: bigint; totalStreamed: bigint; totalSpent: bigint;
  totalBurned: bigint; totalBounty: bigint; lastDefendAt: bigint;
  config: readonly [number, number, number, number, number, bigint];
}>;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function WallTreasuryPanel({ treasury, staking, token, symbol, quote, identity, onToast, onPending, refreshKey }: Common & { treasury: Address; staking: Address }) {
  const t = useT();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<TreasuryData>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const names = ["reserve", "claimable", "circulating", "bookValue", "spot", "floorPrice", "budgetRemaining", "quoteToRestoreFloor", "totalClaimed", "totalStreamed", "totalSpent", "totalBurned", "totalBounty", "lastDefendAt", "config"] as const;
    try {
      const mc = await publicClient.multicall({ allowFailure: true, contracts: names.map((functionName) => ({ address: treasury, abi: wallTreasuryAbi, functionName })) });
      const next: TreasuryData = {};
      names.forEach((n, i) => {
        const r = mc[i];
        if (r.status !== "success") return;
        if (n === "config") next.config = r.result as TreasuryData["config"];
        else (next as Record<string, bigint>)[n] = BigInt(r.result as bigint | number);
      });
      setD(next);
    } catch {}
  }, [treasury]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 12000);
    return () => clearInterval(iv);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(iv);
  }, []);

  async function claimFees() {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast(t("quick.identity"));
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast(t("create.noWallet"));
      onToast(t("wall.confirmClaim"));
      const h = await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: treasury, abi: wallTreasuryAbi, functionName: "claimFees" });
      await waitReceipt(h, "claim", { token, what: "wall-fees" });
      if (address) recordTx(address, { hash: h, kind: "wallClaim", token, time: Date.now() });
      onToast(t("wall.claimed"));
      await load();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast(t("trade.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        onToast(err?.shortMessage ?? err?.message ?? t("portfolio.claimFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const q = (v?: bigint, digits = 4) => `${fmtAmount(v, quote.decimals, digits)} ${quote.symbol}`;
  const belowFloor = d.spot !== undefined && d.floorPrice !== undefined && d.spot < d.floorPrice;
  const cfg = d.config;
  const lastDefend = d.lastDefendAt === undefined ? "—" : d.lastDefendAt === 0n ? t("wall.never") : now > 0 ? t("wall.ago", { v: fmtDuration(now - Number(d.lastDefendAt)) }) : "—";

  return (
    <Panel>
      <PanelHead title={t("wall.treasuryTitle")} address={treasury} explorer={explorer.address} />
      <Note className="mb-3">{t("wall.treasuryBody", { sym: quote.symbol, standIn: quote.stock?.standIn ? t("create.wallStandIn") : "", tok: symbol })}</Note>

      <Row label={t("wall.pile")} value={q(d.reserve)} />
      <Row label={t("wall.claimableFees")} value={q(d.claimable)} />
      <Row label={t("wall.bookValue")} value={`${fmtPrice(d.bookValue, quote.decimals)} ${quote.symbol}`} />
      <Row label={t("wall.spot")} value={`${fmtPrice(d.spot, quote.decimals)} ${quote.symbol}`} tone={belowFloor ? "neg" : undefined} />
      <Row label={t("wall.floor")} value={`${fmtPrice(d.floorPrice, quote.decimals)} ${quote.symbol}`} />
      <Row label={t("wall.status")} value={d.spot === undefined || d.floorPrice === undefined ? "—" : belowFloor ? t("wall.under") : t("wall.above")} />
      {belowFloor && <Row label={t("wall.toRestore")} value={q(d.quoteToRestoreFloor)} />}
      <Row label={t("wall.budgetLeft")} value={q(d.budgetRemaining)} />
      <Row label={t("wall.lastDefend")} value={lastDefend} />
      <Divider />
      <Row label={t("wall.claimedStreamed")} value={`${q(d.totalClaimed)} · ${q(d.totalStreamed)}`} />
      <Row label={t("wall.spentBounties")} value={`${q(d.totalSpent)} · ${q(d.totalBounty)}`} />
      <Row label={t("wall.burned", { sym: symbol })} value={fmtAmount(d.totalBurned, 18, 0)} />
      <Row label={t("wall.circulating")} value={fmtAmount(d.circulating, 18, 0)} />
      <Row label={t("wall.config")} small tone="muted" value={cfg ? `${t("wall.cfgMargin")} ${pct(cfg[0])} · ${t("wall.cfgBudget")} ${pct(cfg[1])} · ${t("wall.cfgStream")} ${pct(cfg[2])} · ${t("wall.cfgSlip")} ≤ ${pct(cfg[3])} · ${t("wall.cfgEvery")} ≥ ${fmtDuration(cfg[4])} · ${t("wall.cfgBounty")} ${fmtAmount(cfg[5], quote.decimals)} ${quote.symbol}` : "—"} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <OutlineButton type="button" onClick={claimFees} disabled={busy || (identity.checked && !identity.ok)}>
          {busy ? <Spinner /> : !authenticated ? t("wall.signInClaim") : t("wall.claimFees")}
        </OutlineButton>
        <Note className="min-w-0 flex-1">
          {t("wall.anyoneNote", { share: cfg ? pct(cfg[2]) : t("wall.configuredShare") })}{" "}
          <a href={explorer.address(staking)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
            {t("wall.stakingLink")}
          </a>
        </Note>
      </div>
    </Panel>
  );
}

type StakeData = Partial<{ staked: bigint; earned: bigint; totalStaked: bigint; rewardRate: bigint; periodFinish: bigint; totalDistributed: bigint }>;

export function WallStakePanel({ staking, token, symbol, quote, identity, onToast, onPending, refreshKey, myTokens }: Common & { staking: Address; myTokens: bigint }) {
  const t = useT();
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<StakeData>({});
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const who = account ?? ZERO;
    try {
      const mc = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: staking, abi: wallStakingAbi, functionName: "stakedOf", args: [who] },
          { address: staking, abi: wallStakingAbi, functionName: "earned", args: [who] },
          { address: staking, abi: wallStakingAbi, functionName: "totalStaked" },
          { address: staking, abi: wallStakingAbi, functionName: "rewardRate" },
          { address: staking, abi: wallStakingAbi, functionName: "periodFinish" },
          { address: staking, abi: wallStakingAbi, functionName: "totalDistributed" },
        ],
      });
      const g = (i: number) => (mc[i].status === "success" ? (mc[i].result as bigint) : undefined);
      setD({ staked: account ? g(0) : undefined, earned: account ? g(1) : undefined, totalStaked: g(2), rewardRate: g(3), periodFinish: g(4), totalDistributed: g(5) });
    } catch {}
  }, [staking, account]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 6000); // earned accrues per second
    return () => clearInterval(iv);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(iv);
  }, []);

  async function withWallet(fn: (client: any, acct: Address) => Promise<void>) {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast(t("quick.identity"));
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast(t("create.noWallet"));
      await fn(wc.client, wc.account);
      await load();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast(t("trade.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        onToast(err?.shortMessage ?? err?.message ?? t("create.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const stake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return onToast(t("wall.enterStake"));
      const allowance = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [acct, staking] })) as bigint;
      if (allowance < amt) {
        onToast(t("trade.approve", { sym: symbol }));
        const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: token, abi: tokenAbi, functionName: "approve", args: [staking, amt] });
        await waitReceipt(ah, "approve");
        const after = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [acct, staking] })) as bigint;
        if (after < amt) throw new Error(t("wall.approveShort"));
      }
      onToast(t("wall.confirmStake"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "stake", args: [amt] });
      await waitReceipt(h, "stake", { token });
      recordTx(acct, { hash: h, kind: "stake", token, time: Date.now() });
      onToast(t("wall.staked"));
      setAmount("");
    });

  const unstake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return onToast(t("wall.enterUnstake"));
      if (d.staked !== undefined && amt > d.staked) return onToast(t("wall.moreThanStaked"));
      onToast(t("wall.confirmUnstake"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "withdraw", args: [amt] });
      await waitReceipt(h, "unstake", { token });
      recordTx(acct, { hash: h, kind: "unstake", token, time: Date.now() });
      onToast(t("wall.unstaked"));
      setAmount("");
    });

  const claim = () =>
    withWallet(async (client, acct) => {
      onToast(t("wall.claiming"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "getReward" });
      await waitReceipt(h, "claim", { token, what: "wall-rewards" });
      recordTx(acct, { hash: h, kind: "claim", token, time: Date.now() });
      onToast(t("portfolio.claimed", { sym: quote.symbol }));
    });

  const streaming = d.periodFinish !== undefined && now > 0 && Number(d.periodFinish) > now;
  const perDay = streaming && d.rewardRate !== undefined ? d.rewardRate * 86400n : undefined;
  const streamEnd = d.periodFinish === undefined ? "—" : d.periodFinish === 0n ? t("wall.noStream") : streaming ? t("wall.streamLeft", { v: fmtDuration(Number(d.periodFinish) - now) }) : t("wall.streamEnded");
  const off = busy || (identity.checked && !identity.ok);

  return (
    <Panel>
      <PanelHead title={t("wall.stakeTitle", { sym: symbol })} aside={<span className="mono-label text-[10.5px] tracking-[.08em] text-ink-3">{t("wall.rewardsIn", { sym: quote.symbol })}</span>} />
      <Note className="mb-3">{t("wall.stakeBody", { sym: quote.symbol })}</Note>
      <Row label={t("wall.yourStake")} value={`${fmtAmount(d.staked, 18, 0)} ${symbol}`} />
      <Row label={t("wall.claimableLive")} value={`${fmtAmount(d.earned, quote.decimals, 6)} ${quote.symbol}`} tone="pos" />
      <Row label={t("wall.totalStaked")} value={`${fmtAmount(d.totalStaked, 18, 0)} ${symbol}`} />
      <Row label={t("wall.currentStream")} value={streamEnd} />
      <Row label={t("wall.rate")} value={perDay === undefined ? (streaming ? "—" : t("wall.rateZero")) : `${fmtAmount(perDay, quote.decimals, 6)} ${quote.symbol}/${t("wall.day")}`} />
      <Row label={t("wall.distributed")} value={`${fmtAmount(d.totalDistributed, quote.decimals, 4)} ${quote.symbol}`} />

      <div className="mt-4">
        <label htmlFor={`wall-stake-${staking.slice(2, 8)}`} className="text-[13px] text-muted">
          {t("wall.amount", { sym: symbol })}
        </label>
        <input id={`wall-stake-${staking.slice(2, 8)}`} type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={`${INPUT_CLASS} tnum mt-1.5`} />
        <Note className="mt-1.5">
          {t("wall.wallet")}{" "}
          <button type="button" className="text-brand hover:underline" onClick={() => account && setAmount(formatUnits(myTokens, 18))}>
            {account ? fmtAmount(myTokens, 18, 0) : "—"}
          </button>
          {d.staked !== undefined && d.staked > 0n && (
            <>
              {" · "}
              {t("wall.stakedLabel")}{" "}
              <button type="button" className="text-brand hover:underline" onClick={() => setAmount(formatUnits(d.staked!, 18))}>
                {fmtAmount(d.staked, 18, 0)}
              </button>
            </>
          )}
        </Note>
      </div>
      <div className="mt-3 grid gap-2 min-[520px]:grid-cols-3">
        <PrimaryButton type="button" onClick={stake} disabled={off} className="py-2.5 text-[13px]">
          {busy ? <Spinner /> : !authenticated ? t("wall.signInStake") : t("wall.stake")}
        </PrimaryButton>
        <OutlineButton type="button" onClick={unstake} disabled={off || !authenticated || !d.staked}>
          {t("wall.unstake")}
        </OutlineButton>
        <OutlineButton type="button" onClick={claim} disabled={off || !authenticated || !d.earned}>
          {t("wall.claimSym", { sym: quote.symbol })}
        </OutlineButton>
      </div>
    </Panel>
  );
}

// ---- post-graduation: the bid ladder in the V4 pool ----

const LADDER_LABELS = ["-5%", "-10%", "-15%", "-20%", "-30%", "-40%", "-50%"];

export function WallLadderPanel({ ladder, symbol, quote, refreshKey }: { ladder: Address; symbol: string; quote: QuoteAsset; refreshKey: number }) {
  const t = useT();
  const [d, setD] = useState<{
    quoteHeld: bigint; pending: bigint; anchored: boolean; anchorPrice: bigint; generation: number; totalIn: bigint;
    totalConverted: bigint; totalBurned: bigint; keeperPaid: bigint; lastPokeAt: number; gap: bigint; q0: boolean; tick: number; live: boolean;
    rungs: { tokenId: bigint; lo: number; hi: number; quoteIn: bigint }[];
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const base = { address: ladder, abi: wallLadderAbi } as const;
        const r = await publicClient.multicall({
          allowFailure: true,
          contracts: [
            { ...base, functionName: "quoteHeld" }, { ...base, functionName: "pending" }, { ...base, functionName: "anchored" },
            { ...base, functionName: "anchorPrice" }, { ...base, functionName: "generation" }, { ...base, functionName: "totalIn" },
            { ...base, functionName: "totalConverted" }, { ...base, functionName: "totalBurned" }, { ...base, functionName: "keeperPaid" },
            { ...base, functionName: "lastPokeAt" }, { ...base, functionName: "ledgerGap" }, { ...base, functionName: "quoteIsCurrency0" },
            { ...base, functionName: "currentTick" },
            ...Array.from({ length: 7 }, (_, i) => ({ ...base, functionName: "rungs" as const, args: [BigInt(i)] as const })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any, // mixed call shapes: results are read positionally below
        });
        if (!alive) return;
        const g = <T,>(i: number) => r[i].result as T | undefined;
        const ct = g<readonly [number, boolean]>(12);
        setD({
          quoteHeld: g<bigint>(0) ?? 0n, pending: g<bigint>(1) ?? 0n, anchored: g<boolean>(2) ?? false, anchorPrice: g<bigint>(3) ?? 0n,
          generation: Number(g<number>(4) ?? 0), totalIn: g<bigint>(5) ?? 0n, totalConverted: g<bigint>(6) ?? 0n, totalBurned: g<bigint>(7) ?? 0n,
          keeperPaid: g<bigint>(8) ?? 0n, lastPokeAt: Number(g<bigint>(9) ?? 0n), gap: g<bigint>(10) ?? 0n, q0: g<boolean>(11) ?? true,
          tick: ct ? Number(ct[0]) : 0, live: ct ? ct[1] : false,
          rungs: Array.from({ length: 7 }, (_, i) => {
            const x = g<readonly [bigint, number, number, bigint]>(13 + i);
            return { tokenId: x?.[0] ?? 0n, lo: Number(x?.[1] ?? 0), hi: Number(x?.[2] ?? 0), quoteIn: x?.[3] ?? 0n };
          }),
        });
        setErr(null);
      } catch (e: unknown) {
        const er = e as { shortMessage?: string; message?: string };
        if (alive) setErr(er?.shortMessage ?? er?.message ?? "read failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [ladder, refreshKey]);

  const qd = quote.decimals;
  const fq = (v: bigint, digits = 4) => Number(formatUnits(v, qd)).toLocaleString(undefined, { maximumFractionDigits: digits });
  const fp = (v: bigint) => (v === 0n ? "—" : (Number(formatUnits(v, qd)) / 1e18).toExponential(3));
  const bandPrice = (lo: number, hi: number, q0: boolean) => {
    const a = tickToQuotePer1e18(lo, q0) / 10 ** qd / 1e18;
    const b = tickToQuotePer1e18(hi, q0) / 10 ** qd / 1e18;
    return `${Math.min(a, b).toExponential(2)} – ${Math.max(a, b).toExponential(2)}`;
  };
  return (
    <Panel>
      <PanelHead title={t("wall.ladderTitle")} address={ladder} explorer={explorer.address} />
      <Note className="mb-3">{t("wall.ladderBody", { sym: quote.symbol })}</Note>
      {err && <Note tone="neg">{err}</Note>}
      {!d ? (
        <Note>{t("wall.loading")}</Note>
      ) : (
        <>
          <Row label={t("wall.inLadder", { sym: quote.symbol })} value={t("wall.inLadderValue", { held: fq(d.quoteHeld), pending: fq(d.pending) })} />
          <Row label={t("wall.anchor")} value={d.anchored ? `${fp(d.anchorPrice)} ${quote.symbol}` : t("wall.notAnchored")} />
          <Row label={t("wall.generation")} value={`#${d.generation} · ${d.lastPokeAt ? new Date(d.lastPokeAt * 1000).toLocaleString() : "—"}`} />
          <Row label={t("wall.spentBurned", { sym: symbol })} value={`${fq(d.totalConverted)} ${quote.symbol} / ${Number(formatUnits(d.totalBurned, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
          <Row label={t("wall.keeperGap")} value={`${fq(d.keeperPaid)} · ${d.gap.toString()}`} />
          <DataTable className="mt-3" head={[t("wall.rung"), t("wall.band", { q: quote.symbol, sym: symbol }), t("wall.posted")]}>
            {d.rungs.map((r, i) => (
              <tr key={i}>
                <td className={TD}>{LADDER_LABELS[i]}</td>
                <td className={TD_MONO}>{r.tokenId === 0n ? "—" : bandPrice(r.lo, r.hi, d.q0)}</td>
                <td className={TD_NUM}>{r.tokenId === 0n ? t("wall.empty") : `${fq(r.quoteIn)} ${quote.symbol}`}</td>
              </tr>
            ))}
          </DataTable>
        </>
      )}
    </Panel>
  );
}
