"use client";

// The $RADIAN flywheel (Arc only): stake $RADIAN, earn the fee stream. The
// Pound replaces it on the other networks. On the design system; copy under
// `fly.*`.
import Link from "next/link";
import { useState } from "react";
import { formatUnits, parseEther, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { CondCell, CondGrid, OutlineButton, Panel, PrimaryButton, SectionHead } from "@/components/ui/primitives";
import { DataTable, TD, TD_MONO, TD_NUM } from "@/components/ui/DataTable";
import { Note, Row, Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import type { NetworkConfig } from "@/lib/networks";
import { arcTestnet } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useFlywheel } from "@/lib/useFlywheel";
import { RADIAN_ADDR, stakingAbi, radianErc20Abi } from "@/lib/radianToken";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import { recordTx } from "@/lib/txLog";
import { fmtNum } from "@/lib/ui/format";

export function FlywheelEarn({ net }: { net: NetworkConfig }) {
  const t = useT();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const fw = useFlywheel(address);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const s = fw.stats;
  const identity = useIdentity();
  const rs = net.radian.rewardSymbol ?? net.nativeSymbol ?? "USDC"; // what stakers are paid in
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);
  usePendingResume(["stake", "claim", "unstake"], () => {
    setPendingHash(null);
    setToast(t("portfolio.resumed"));
    fw.refresh();
  });

  async function withWallet(fn: (c: any, acct: Hex) => Promise<void>) {
    if (!authenticated) return login();
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) {
        setToast(t("create.noWallet"));
        return;
      }
      await fn(wc.client, wc.account);
      fw.refresh();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast(t("trade.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        setToast(err?.shortMessage ?? err?.message ?? t("create.failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  const stake = () =>
    withWallet(async (client, acct) => {
      const amt = parseEther(amount || "0");
      if (amt <= 0n) return;
      setToast(t("trade.approve", { sym: "RADIAN" }));
      const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.token, abi: radianErc20Abi, functionName: "approve", args: [RADIAN_ADDR.staking, amt] });
      await waitReceipt(ah, "approve");
      setToast(t("wall.confirmStake"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "stake", args: [amt] });
      await waitReceipt(h, "stake");
      recordTx(acct, { hash: h, kind: "stake", token: RADIAN_ADDR.token, time: Date.now() });
      setToast(t("wall.staked"));
      setAmount("");
    });

  const claim = () =>
    withWallet(async (client, acct) => {
      setToast(t("wall.claiming"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "getReward" });
      await waitReceipt(h, "claim");
      recordTx(acct, { hash: h, kind: "claim", token: RADIAN_ADDR.token, time: Date.now() });
      setToast(t("portfolio.claimed", { sym: rs }));
    });

  const unstake = () =>
    withWallet(async (client, acct) => {
      if (fw.staked <= 0n) return;
      setToast(t("wall.confirmUnstake"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: RADIAN_ADDR.staking, abi: stakingAbi, functionName: "withdraw", args: [fw.staked] });
      await waitReceipt(h, "unstake");
      recordTx(acct, { hash: h, kind: "unstake", token: RADIAN_ADDR.token, time: Date.now() });
      setToast(t("wall.unstaked"));
    });

  const steps: [string, string][] = [
    [t("fly.step1"), t("fly.step1Body")],
    [t("fly.step2"), t("fly.step2Body", { p: s ? (s.buybackBps / 100).toFixed(0) : "50" })],
    [t("fly.step3"), t("fly.step3Body")],
    [t("fly.step4", { sym: rs }), t("fly.step4Body")],
  ];
  const qd = net.radian.rewardDecimals ?? 18;
  const n = (v?: string, d = 4, dec = qd) => (v == null ? "—" : fmtNum(Number(formatUnits(BigInt(v), dec)), d));

  return (
    <>
      <IdentityBanner identity={identity} />
      <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
      <header className="max-w-[640px]">
        <span className="mono-label inline-flex items-center gap-2 rounded-full border border-stroke-2 bg-glass-2 px-4 py-1.5 text-[10.5px] tracking-[.16em] text-ink-2">{t("fly.eyebrow")}</span>
        <h1 className="mt-5 text-[clamp(30px,4vw,42px)] font-[650] leading-[1.2] tracking-[-.5px] text-ink">{t("fly.title")}</h1>
        <p className="mt-3 text-[15px] leading-[1.7] text-muted">{t("fly.sub", { sym: rs })}</p>
      </header>

      <ol className="mt-6 grid gap-3 min-[620px]:grid-cols-2 nav:grid-cols-4">
        {steps.map(([h, p], i) => (
          <li key={h} className="glass-panel rounded-2xl p-4">
            <span className="mono-label text-[10px] text-ink-3">0{i + 1}</span>
            <h3 className="mt-2 text-[14px] font-semibold text-ink">{h}</h3>
            <p className="mt-1 text-[12px] leading-[1.6] text-muted">{p}</p>
          </li>
        ))}
      </ol>

      <CondGrid className="mt-5">
        <CondCell label={t("fly.apr")} value={<span className="text-pos">{s ? `${s.apr.toFixed(1)}%` : "—"}</span>} />
        <CondCell label={t("fly.staked")} value={s ? `$${fmtNum(s.stakedValueUsdc, 0)}` : "—"} />
        <CondCell label={t("fly.burned")} value={<span className="text-brand-3">{s ? fmtNum(s.buybackBurned, 0) : "—"}</span>} />
        <CondCell label={t("fly.toStakers", { sym: rs })} value={s ? `$${fmtNum(s.distributedToStakers, 3)}` : "—"} />
      </CondGrid>

      <div className="mt-5 grid items-start gap-5 nav:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <SectionHead title={t("fly.position")} />
          <Row label={t("fly.wallet")} value={fmtNum(fw.balanceNum, 0)} />
          <Row label={t("fly.stakedYou")} value={`${fmtNum(fw.stakedNum, 0)} RADIAN`} />
          <Row label={t("wall.claimableLive")} value={`${fmtNum(fw.earnedNum, 8)} ${rs}`} tone="pos" />
          <Row label={t("fly.price")} value={`${s ? s.radianPrice.toExponential(3) : "—"} ${rs}`} />
          <Note className="mt-3">
            {t("fly.noRadian")}{" "}
            <Link href={`/token/${net.radian.token}`} className="text-brand hover:underline">
              {t("fly.buyIt")}
            </Link>
          </Note>
        </Panel>

        <Panel className="nav:sticky nav:top-24">
          <label htmlFor="fly-amount" className="text-[13px] text-muted">
            {t("fly.stakeLabel")}
          </label>
          <input id="fly-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" className={`${INPUT_CLASS} tnum mt-1.5`} />
          {fw.balanceNum > 0 && (
            <Note className="mt-1.5">
              {t("wall.wallet")}{" "}
              <button type="button" className="text-brand hover:underline" onClick={() => setAmount(String(fw.balanceNum))}>
                {fmtNum(fw.balanceNum, 0)}
              </button>
            </Note>
          )}
          <PrimaryButton type="button" className="mt-3" onClick={stake} disabled={busy}>
            {busy ? <Spinner /> : !authenticated ? t("wall.signInStake") : t("wall.stake")}
          </PrimaryButton>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <OutlineButton type="button" onClick={claim} disabled={busy || fw.earned <= 0n}>
              {t("wall.claimSym", { sym: rs })}
            </OutlineButton>
            <OutlineButton type="button" onClick={unstake} disabled={busy || fw.staked <= 0n}>
              {t("fly.unstakeAll")}
            </OutlineButton>
          </div>
          <Note className="mt-2 text-center">{t("fly.realFees", { sym: rs })}</Note>
        </Panel>
      </div>

      <Panel className="mt-5">
        <SectionHead title={t("fly.ledger")} />
        <Note className="-mt-3 mb-3">{t("fly.ledgerBody")}</Note>
        {!s?.ledger?.length ? (
          <Note>{t("pound.noEntries")}</Note>
        ) : (
          <DataTable head={[t("pound.colWhen"), t("pound.colEvent"), `${rs} ${t("fly.in")}`, t("fly.burnedCol"), `${rs} ${t("fly.toStakersCol")}`, "Tx"]} align={["left", "left", "right", "right", "right", "left"]}>
            {s.ledger.map((r) => (
              <tr key={`${r.txHash}-${r.kind}-${r.ts}`}>
                <td className={`${TD} whitespace-nowrap`}>{new Date(r.ts).toLocaleString()}</td>
                <td className={TD}>{r.kind === "flush" ? t("fly.evFlush") : r.kind === "claim" ? t("fly.evClaim") : t("fly.evClaimToken")}</td>
                <td className={TD_NUM}>{r.kind === "flush" ? n(r.usdcIn) : n(r.amount)}</td>
                <td className={`${TD_NUM} text-brand-3`}>{r.kind === "flush" ? n(r.radianBurned, 0, 18) : "—"}</td>
                <td className={`${TD_NUM} text-pos`}>{r.kind === "flush" ? n(r.toStakers) : "—"}</td>
                <td className={TD_MONO}>
                  <a href={`${net.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    {r.txHash.slice(0, 10)}…
                  </a>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <p className="mt-5 text-center text-[12px] text-ink-3">
        {t("pound.contracts")}{" "}
        <a href={`${net.explorer}/address/${net.radian.staking}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          staking
        </a>{" "}
        ·{" "}
        <a href={`${net.explorer}/address/${net.radian.treasury}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          treasury
        </a>{" "}
        ·{" "}
        <a href={`${net.explorer}/address/${net.radian.token}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
          token
        </a>
      </p>
      {toast && (
        <button type="button" onClick={() => setToast(null)} className="fixed bottom-[88px] left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-stroke bg-night px-4 py-3 text-left text-sm text-ink shadow-[var(--shadow)] nav:bottom-6">
          {toast}
        </button>
      )}
    </>
  );
}
