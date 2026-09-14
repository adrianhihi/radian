"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseEther, type Address } from "viem";
import { publicClient, arcTestnet, erc20Abi, tokenAbi, explorer, type QuoteAsset } from "@/lib/radian";
import { wallTreasuryAbi, wallStakingAbi, fmtAmount, fmtPrice, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";

// "The Wall" template: a per-launch treasury that piles up the quote asset
// (never sold), streams a slice of each fee claim to stakers and keeps a
// standing bid under book value on the curve. Everything shown here is read
// from the treasury / staking contract; a dash means the read failed.

type Common = {
  token: Address;
  symbol: string;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: `0x${string}`) => void;
  refreshKey: number; // bumped by the page after a resumed transaction
};

type TreasuryData = Partial<{
  reserve: bigint; claimable: bigint; circulating: bigint; bookValue: bigint; spot: bigint; floorPrice: bigint;
  budgetRemaining: bigint; quoteToRestoreFloor: bigint; totalClaimed: bigint; totalStreamed: bigint; totalSpent: bigint;
  totalBurned: bigint; totalBounty: bigint; lastDefendAt: bigint;
  config: readonly [number, number, number, number, number, bigint];
}>;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

export function WallTreasuryPanel({ treasury, staking, token, symbol, quote, identity, onToast, onPending, refreshKey }: Common & { treasury: Address; staking: Address }) {
  const { authenticated, login, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<TreasuryData>({});
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const names = [
      "reserve", "claimable", "circulating", "bookValue", "spot", "floorPrice", "budgetRemaining", "quoteToRestoreFloor",
      "totalClaimed", "totalStreamed", "totalSpent", "totalBurned", "totalBounty", "lastDefendAt", "config",
    ] as const;
    try {
      const mc = await publicClient.multicall({
        allowFailure: true,
        contracts: names.map((functionName) => ({ address: treasury, abi: wallTreasuryAbi, functionName })),
      });
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
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  async function claimFees() {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast("Disabled: a platform contract's live code does not match its pinned hash.");
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast("No wallet available. Sign in again.");
      onToast("Confirm the fee claim…");
      const h = await wc.client.writeContract({
        account: wc.account, chain: arcTestnet, address: treasury, abi: wallTreasuryAbi, functionName: "claimFees",
      });
      await waitReceipt(h, "claim", { token, what: "wall-fees" });
      onToast("Fees claimed into the treasury ✓");
      await load();
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else onToast(e?.shortMessage ?? e?.message ?? "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  const q = (v?: bigint, digits = 4) => `${fmtAmount(v, quote.decimals, digits)} ${quote.symbol}`;
  const belowFloor = d.spot !== undefined && d.floorPrice !== undefined && d.spot < d.floorPrice;
  const cfg = d.config;
  const lastDefend = d.lastDefendAt === undefined ? "—" : d.lastDefendAt === 0n ? "never" : now > 0 ? `${fmtDuration(now - Number(d.lastDefendAt))} ago` : "—";

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="prog-row" style={{ marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Treasury — The Wall</span>
        <a href={explorer.address(treasury)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--radian-2)" }}>
          {treasury.slice(0, 8)}…{treasury.slice(-6)}
        </a>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        A standing bid funded by fees, not a guarantee. The pile is {quote.symbol}
        {quote.stock?.standIn ? " (a testnet stand-in)" : ""} and is never sold; it buys and burns {symbol} on the curve when spot trades under book value.
      </p>

      <div className="kv"><span>Pile (reserve)</span><span className="v">{q(d.reserve)}</span></div>
      <div className="kv"><span>Claimable fees</span><span className="v">{q(d.claimable)}</span></div>
      <div className="kv"><span>Book value</span><span className="v">{fmtPrice(d.bookValue, quote.decimals)} {quote.symbol}</span></div>
      <div className="kv"><span>Spot</span><span className="v" style={{ color: belowFloor ? "var(--down)" : undefined }}>{fmtPrice(d.spot, quote.decimals)} {quote.symbol}</span></div>
      <div className="kv"><span>Wall (floor bid)</span><span className="v">{fmtPrice(d.floorPrice, quote.decimals)} {quote.symbol}</span></div>
      <div className="kv"><span>Status</span><span className="v">{d.spot === undefined || d.floorPrice === undefined ? "—" : belowFloor ? "Spot under the wall — defendable" : "Spot above the wall"}</span></div>
      {belowFloor && <div className="kv"><span>Quote to restore the wall</span><span className="v">{q(d.quoteToRestoreFloor)}</span></div>}
      <div className="kv"><span>Budget left today</span><span className="v">{q(d.budgetRemaining)}</span></div>
      <div className="kv"><span>Last defend</span><span className="v">{lastDefend}</span></div>

      <div style={{ borderTop: "1px solid var(--border-soft)", margin: "10px 0" }} />
      <div className="kv"><span>Claimed · streamed</span><span className="v">{q(d.totalClaimed)} · {q(d.totalStreamed)}</span></div>
      <div className="kv"><span>Spent defending · bounties</span><span className="v">{q(d.totalSpent)} · {q(d.totalBounty)}</span></div>
      <div className="kv"><span>{symbol} burned</span><span className="v">{fmtAmount(d.totalBurned, 18, 0)}</span></div>
      <div className="kv"><span>Circulating (excl. curve, treasury, vault)</span><span className="v">{fmtAmount(d.circulating, 18, 0)}</span></div>
      <div className="kv" style={{ fontSize: 12.5 }}>
        <span>Config</span>
        <span className="v" style={{ fontWeight: 500, textAlign: "right" }}>
          {cfg
            ? `margin ${pct(cfg[0])} · budget ${pct(cfg[1])}/day · stream ${pct(cfg[2])} · slippage ≤ ${pct(cfg[3])} · every ≥ ${fmtDuration(cfg[4])} · bounty ${fmtAmount(cfg[5], quote.decimals)} ${quote.symbol}`
            : "—"}
        </span>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-ghost" onClick={claimFees} disabled={busy || (identity.checked && !identity.ok)}>
          {busy ? <span className="spinner" /> : !authenticated ? "Sign in to claim fees" : "Claim fees"}
        </button>
        <span className="hint" style={{ margin: 0 }}>
          Anyone may call this. It pulls accrued fees into the treasury and streams {cfg ? pct(cfg[2]) : "the configured share"} to stakers.{" "}
          <a href={explorer.address(staking)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>staking ↗</a>
        </span>
      </div>
    </div>
  );
}

type StakeData = Partial<{ staked: bigint; earned: bigint; totalStaked: bigint; rewardRate: bigint; periodFinish: bigint; totalDistributed: bigint }>;

export function WallStakePanel({ staking, token, symbol, quote, identity, onToast, onPending, refreshKey, myTokens }: Common & { staking: Address; myTokens: bigint }) {
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const [d, setD] = useState<StakeData>({});
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const who = account ?? ("0x0000000000000000000000000000000000000000" as Address);
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
      setD({
        staked: account ? g(0) : undefined, earned: account ? g(1) : undefined,
        totalStaked: g(2), rewardRate: g(3), periodFinish: g(4), totalDistributed: g(5),
      });
    } catch {}
  }, [staking, account]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000); // earned accrues per second
    return () => clearInterval(t);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  async function withWallet(fn: (client: any, acct: Address) => Promise<void>) {
    if (!authenticated) return login();
    if (identity.checked && !identity.ok) return onToast("Disabled: a platform contract's live code does not match its pinned hash.");
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) return onToast("No wallet available. Sign in again.");
      await fn(wc.client, wc.account);
      await load();
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        onToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else onToast(e?.shortMessage ?? e?.message ?? "Failed.");
    } finally {
      setBusy(false);
    }
  }

  const stake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return onToast("Enter an amount to stake.");
      const allowance = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [acct, staking] })) as bigint;
      if (allowance < amt) {
        onToast(`Approve ${symbol}…`);
        const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: token, abi: tokenAbi, functionName: "approve", args: [staking, amt] });
        await waitReceipt(ah, "approve");
        // The wallet may have edited the amount: re-read before relying on it.
        const after = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [acct, staking] })) as bigint;
        if (after < amt) throw new Error("Your wallet approved a smaller amount, so nothing was staked. Approve the full amount to continue.");
      }
      onToast("Confirm stake…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "stake", args: [amt] });
      await waitReceipt(h, "stake", { token });
      onToast("Staked ✓");
      setAmount("");
    });

  const unstake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return onToast("Enter an amount to unstake.");
      if (d.staked !== undefined && amt > d.staked) return onToast("More than you have staked.");
      onToast("Confirm unstake…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "withdraw", args: [amt] });
      await waitReceipt(h, "unstake", { token });
      onToast("Unstaked ✓");
      setAmount("");
    });

  const claim = () =>
    withWallet(async (client, acct) => {
      onToast("Claiming rewards…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: staking, abi: wallStakingAbi, functionName: "getReward" });
      await waitReceipt(h, "claim", { token, what: "wall-rewards" });
      onToast(`Claimed ${quote.symbol} ✓`);
    });

  const streaming = d.periodFinish !== undefined && now > 0 && Number(d.periodFinish) > now;
  const perDay = streaming && d.rewardRate !== undefined ? d.rewardRate * 86400n : undefined;
  const streamEnd = d.periodFinish === undefined ? "—"
    : d.periodFinish === 0n ? "no stream yet — the first fee claim starts one"
    : streaming ? `${fmtDuration(Number(d.periodFinish) - now)} left`
    : "ended — the next fee claim restarts a 7-day stream";

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="prog-row" style={{ marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Stake {symbol}</span>
        <span>rewards in {quote.symbol}</span>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Each treasury fee claim streams its staker share here over 7 days. Rewards are fees actually collected, paid in {quote.symbol}; the rate changes with every claim.
      </p>
      <div className="kv"><span>Your stake</span><span className="v">{fmtAmount(d.staked, 18, 0)} {symbol}</span></div>
      <div className="kv"><span>Claimable (live)</span><span className="v" style={{ color: "var(--up)" }}>{fmtAmount(d.earned, quote.decimals, 6)} {quote.symbol}</span></div>
      <div className="kv"><span>Total staked</span><span className="v">{fmtAmount(d.totalStaked, 18, 0)} {symbol}</span></div>
      <div className="kv"><span>Current stream</span><span className="v">{streamEnd}</span></div>
      <div className="kv"><span>Rate (on-chain, now)</span><span className="v">{perDay === undefined ? (streaming ? "—" : "0 while no stream is active") : `${fmtAmount(perDay, quote.decimals, 6)} ${quote.symbol}/day`}</span></div>
      <div className="kv"><span>Distributed, lifetime</span><span className="v">{fmtAmount(d.totalDistributed, quote.decimals, 4)} {quote.symbol}</span></div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Amount ({symbol})</label>
        <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        <p className="hint">
          Wallet:{" "}
          <span style={{ cursor: "pointer", color: "var(--radian-2)" }} onClick={() => account && setAmount(formatUnits(myTokens, 18))}>
            {account ? fmtAmount(myTokens, 18, 0) : "—"}
          </span>
          {d.staked !== undefined && d.staked > 0n && (
            <>
              {" · "}Staked:{" "}
              <span style={{ cursor: "pointer", color: "var(--radian-2)" }} onClick={() => setAmount(formatUnits(d.staked!, 18))}>
                {fmtAmount(d.staked, 18, 0)}
              </span>
            </>
          )}
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={stake} disabled={busy || (identity.checked && !identity.ok)}>
          {busy ? <span className="spinner" /> : !authenticated ? "Sign in to stake" : "Stake"}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={unstake} disabled={busy || !authenticated || (identity.checked && !identity.ok) || !d.staked}>
          Unstake
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={claim} disabled={busy || !authenticated || (identity.checked && !identity.ok) || !d.earned}>
          Claim {quote.symbol}
        </button>
      </div>
    </div>
  );
}
