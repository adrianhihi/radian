"use client";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { publicClient, arcTestnet, erc20Abi, explorer, RADIAN, NATIVE_QUOTE, type QuoteAsset } from "@/lib/radian";
import { executorAbi, executorDomain, BUY_AUTH_TYPES, EXECUTOR_FEE_BPS, EXECUTOR_GAS_STIPEND } from "@/lib/executor";
import { fetchAuths, postAuth, hasIndexer, type AuthRecord } from "@/lib/indexer";
import { fmtAmount, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";

// Auto-buy through RadianExecutor. The user deposits quote (and native USDC
// for gas when the quote is an ERC-20), signs an EIP-712 BuyAuth off-chain
// and posts it to the indexer, whose keeper executes the buys on schedule.
// Tokens always land in the user's wallet. Withdraw and cancel are plain
// transactions that need nobody's cooperation.

const INTERVALS = [
  { label: "1h", secs: 3600 },
  { label: "6h", secs: 21600 },
  { label: "24h", secs: 86400 },
  { label: "custom", secs: 0 },
] as const;
const VALID_FOR = [
  { label: "7 days", secs: 7 * 86400 },
  { label: "30 days", secs: 30 * 86400 },
] as const;
const GWEI = 1_000_000_000n;

type Props = {
  token: Address;
  symbol: string;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: `0x${string}`) => void;
  refreshKey: number;
};

type Data = Partial<{ quoteBal: bigint; nativeBal: bigint; nonce: bigint; feeBps: bigint; stipend: bigint; gasPrice: bigint }>;

export function AutoBuyPanel({ token, symbol, quote, identity, onToast, onPending, refreshKey }: Props) {
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const executor = RADIAN.executor;
  const quoteAddr: Address = quote.native ? NATIVE_QUOTE : quote.address;
  const [d, setD] = useState<Data>({});
  const [auths, setAuths] = useState<AuthRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  // deposit / withdraw forms
  const [depAsset, setDepAsset] = useState<"quote" | "gas">("quote");
  const [depAmount, setDepAmount] = useState("");
  const [wdAsset, setWdAsset] = useState<"quote" | "gas">("quote");
  const [wdAmount, setWdAmount] = useState("");
  // schedule form
  const [perBuy, setPerBuy] = useState("");
  const [intervalSecs, setIntervalSecs] = useState<number>(3600);
  const [customSecs, setCustomSecs] = useState("");
  const [count, setCount] = useState("10");
  const [validSecs, setValidSecs] = useState<number>(7 * 86400);

  const load = useCallback(async () => {
    if (!account) {
      setD({});
      setAuths(null);
      return;
    }
    try {
      const mc = await publicClient.multicall({
        allowFailure: true,
        contracts: [
          { address: executor, abi: executorAbi, functionName: "balanceOf", args: [account, quoteAddr] },
          { address: executor, abi: executorAbi, functionName: "balanceOf", args: [account, NATIVE_QUOTE] },
          { address: executor, abi: executorAbi, functionName: "nonces", args: [account] },
          { address: executor, abi: executorAbi, functionName: "FEE_BPS" },
          { address: executor, abi: executorAbi, functionName: "GAS_STIPEND" },
        ],
      });
      const g = (i: number) => (mc[i].status === "success" ? (mc[i].result as bigint) : undefined);
      const gasPrice = await publicClient.getGasPrice().catch(() => undefined);
      setD({ quoteBal: g(0), nativeBal: g(1), nonce: g(2), feeBps: g(3), stipend: g(4), gasPrice });
    } catch {}
    if (hasIndexer()) {
      try {
        setAuths(await fetchAuths(account));
      } catch {
        setAuths((a) => a ?? []);
      }
    }
  }, [account, executor, quoteAddr]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  const blocked = identity.checked && !identity.ok;
  const feeBps = d.feeBps ?? EXECUTOR_FEE_BPS;
  const stipend = d.stipend ?? EXECUTOR_GAS_STIPEND;
  // Cap on what the keeper may charge per buy for gas: 3× the current gas price, at least 1 gwei.
  const maxGasPrice = d.gasPrice !== undefined ? (d.gasPrice * 3n > GWEI ? d.gasPrice * 3n : GWEI) : undefined;
  const stipendCap = maxGasPrice !== undefined ? stipend * maxGasPrice : undefined; // native, per buy

  const effInterval = intervalSecs === 0 ? Math.round(Number(customSecs) || 0) : intervalSecs;
  const nCount = Math.max(0, Math.floor(Number(count) || 0));
  let perBuyWei = 0n;
  try {
    perBuyWei = perBuy ? parseUnits(perBuy, quote.decimals) : 0n;
  } catch {}
  const quoteNeeded = (perBuyWei * (10000n + feeBps) * BigInt(nCount)) / 10000n;
  const gasNeeded = stipendCap !== undefined ? stipendCap * BigInt(nCount) : undefined;
  const nativeNeeded = quote.native ? (gasNeeded !== undefined ? quoteNeeded + gasNeeded : undefined) : gasNeeded;
  const shortQuote = !quote.native && d.quoteBal !== undefined && quoteNeeded > d.quoteBal;
  const shortNative = d.nativeBal !== undefined && nativeNeeded !== undefined && nativeNeeded > d.nativeBal;

  async function withWallet(fn: (client: any, acct: Address) => Promise<void>) {
    if (!authenticated) return login();
    if (blocked) return onToast("Disabled: a platform contract's live code does not match its pinned hash.");
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

  const assetOf = (which: "quote" | "gas") => (which === "gas" || quote.native ? NATIVE_QUOTE : quote.address);
  const decimalsOf = (which: "quote" | "gas") => (which === "gas" ? 18 : quote.decimals);
  const symbolOf = (which: "quote" | "gas") => (which === "gas" ? "USDC" : quote.symbol);

  const deposit = () =>
    withWallet(async (client, acct) => {
      const dec = decimalsOf(depAsset);
      const amt = parseUnits(depAmount || "0", dec);
      if (amt <= 0n) return onToast("Enter an amount to deposit.");
      const asset = assetOf(depAsset);
      if (asset === NATIVE_QUOTE) {
        onToast("Confirm the deposit…");
        const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "deposit", value: amt });
        await waitReceipt(h, "deposit", { token });
      } else {
        const allowance = (await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [acct, executor] })) as bigint;
        if (allowance < amt) {
          onToast(`Approve ${quote.symbol}…`);
          const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: asset, abi: erc20Abi, functionName: "approve", args: [executor, amt] });
          await waitReceipt(ah, "approve");
          // The wallet may have edited the amount: re-read before spending on it.
          const after = (await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [acct, executor] })) as bigint;
          if (after < amt) throw new Error("Your wallet approved a smaller amount, so nothing was deposited. Approve the full amount to continue.");
        }
        onToast("Confirm the deposit…");
        const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "depositToken", args: [asset, amt] });
        await waitReceipt(h, "deposit", { token });
      }
      onToast("Deposited ✓");
      setDepAmount("");
    });

  const withdraw = () =>
    withWallet(async (client, acct) => {
      const amt = parseUnits(wdAmount || "0", decimalsOf(wdAsset));
      if (amt <= 0n) return onToast("Enter an amount to withdraw.");
      onToast("Confirm the withdrawal…");
      const h = await client.writeContract({
        account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "withdraw", args: [assetOf(wdAsset), amt, acct],
      });
      await waitReceipt(h, "withdraw", { token });
      onToast("Withdrawn to your wallet ✓");
      setWdAmount("");
    });

  const cancelAll = () =>
    withWallet(async (client, acct) => {
      onToast("Confirm — this voids every schedule you have signed…");
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "cancelAuth" });
      await waitReceipt(h, "cancel", { token });
      onToast("All schedules cancelled ✓");
    });

  const schedule = () =>
    withWallet(async (client, acct) => {
      if (!hasIndexer()) return onToast("Scheduling needs the indexer (it runs the keeper), which is not configured on this network.");
      if (perBuyWei <= 0n) return onToast("Enter an amount per buy.");
      if (effInterval < 60) return onToast("Interval must be at least 60 seconds.");
      if (nCount < 1 || nCount > 4_000_000_000) return onToast("Enter how many buys to run.");
      if (maxGasPrice === undefined) return onToast("Could not read the network gas price; try again.");
      const nonce = (await publicClient.readContract({ address: executor, abi: executorAbi, functionName: "nonces", args: [acct] })) as bigint;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + validSecs);
      const message = {
        user: acct, token, perBuyMax: perBuyWei, maxGasPrice, totalCount: nCount, minInterval: effInterval, deadline, nonce,
      };
      onToast("Sign the schedule in your wallet (no gas)…");
      const signature = (await client.signTypedData({
        account: acct, domain: executorDomain(), types: BUY_AUTH_TYPES, primaryType: "BuyAuth", message,
      })) as `0x${string}`;
      await postAuth(
        {
          user: acct, token,
          perBuyMax: perBuyWei.toString(), maxGasPrice: maxGasPrice.toString(), totalCount: String(nCount),
          minInterval: String(effInterval), deadline: deadline.toString(), nonce: nonce.toString(),
        },
        signature,
      );
      onToast("Scheduled ✓ — the keeper runs it from here.");
      setPerBuy("");
    });

  const ago = (ts: number) => (ts > 0 && now > 0 ? `${fmtDuration(Math.max(0, now - ts))} ago` : "never");
  const active = (auths ?? []).filter((a) => a.status === "active");
  const gasSym = "USDC";

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="prog-row" style={{ marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--fg)" }}>Auto-buy</span>
        <a href={explorer.address(executor)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--radian-2)" }}>executor ↗</a>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        Schedule buys of {symbol} that a keeper executes for you. You deposit into the executor, sign one message, and every buy lands in your wallet.
        Fee: {(Number(feeBps) / 100).toFixed(2)}% of {quote.symbol} spent, plus a gas stipend per buy ({stipend.toString()} gas × the gas price, capped by your signature), paid in {gasSym} from your deposit.
        Withdraw or cancel any time — neither needs the keeper.
      </p>

      {!authenticated ? (
        <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center" }} onClick={login}>Sign in to use auto-buy</button>
      ) : (
        <>
          <div className="kv"><span>Deposited {quote.symbol}</span><span className="v">{fmtAmount(d.quoteBal, quote.decimals)} {quote.symbol}</span></div>
          {!quote.native && <div className="kv"><span>Deposited {gasSym} (gas)</span><span className="v">{fmtAmount(d.nativeBal, 18, 6)} {gasSym}</span></div>}

          {/* deposit */}
          <div className="field" style={{ marginTop: 12 }}>
            <label>Deposit</label>
            <div style={{ display: "grid", gridTemplateColumns: quote.native ? "1fr auto" : "1fr 1fr auto", gap: 8 }}>
              {!quote.native && (
                <select className="select" value={depAsset} onChange={(e) => setDepAsset(e.target.value as "quote" | "gas")}>
                  <option value="quote">{quote.symbol}</option>
                  <option value="gas">{gasSym} (gas)</option>
                </select>
              )}
              <input className="input" type="number" min="0" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder={`0 ${symbolOf(quote.native ? "quote" : depAsset)}`} />
              <button className="btn btn-ghost" onClick={deposit} disabled={busy || blocked}>{busy ? <span className="spinner" /> : "Deposit"}</button>
            </div>
            {!quote.native && depAsset === "quote" && <p className="hint">ERC-20 quote: the wallet shows an approval first, then the deposit.</p>}
          </div>

          {/* schedule */}
          <div className="field">
            <label>Schedule</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label style={{ fontSize: 12 }}>Per buy ({quote.symbol})</label>
                <input className="input" type="number" min="0" value={perBuy} onChange={(e) => setPerBuy(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Number of buys</label>
                <input className="input" type="number" min="1" step="1" value={count} onChange={(e) => setCount(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Every</label>
                <div className="seg">
                  {INTERVALS.map((iv) => (
                    <button key={iv.label} type="button" className={intervalSecs === iv.secs ? "on-buy" : ""} onClick={() => setIntervalSecs(iv.secs)}>{iv.label}</button>
                  ))}
                </div>
                {intervalSecs === 0 && (
                  <input className="input" style={{ marginTop: 6 }} type="number" min="60" step="1" value={customSecs} onChange={(e) => setCustomSecs(e.target.value)} placeholder="seconds (≥ 60)" />
                )}
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Valid for</label>
                <div className="seg">
                  {VALID_FOR.map((v) => (
                    <button key={v.label} type="button" className={validSecs === v.secs ? "on-buy" : ""} onClick={() => setValidSecs(v.secs)}>{v.label}</button>
                  ))}
                </div>
              </div>
            </div>
            {perBuyWei > 0n && nCount > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="kv" style={{ fontSize: 12.5 }}>
                  <span>Needed for {nCount} buy{nCount === 1 ? "" : "s"} (incl. fee)</span>
                  <span className="v" style={{ fontWeight: 500, color: shortQuote ? "var(--down)" : undefined }}>{fmtAmount(quoteNeeded, quote.decimals)} {quote.symbol}</span>
                </div>
                <div className="kv" style={{ fontSize: 12.5 }}>
                  <span>Gas stipend cap{quote.native ? " (on top, same deposit)" : ""}</span>
                  <span className="v" style={{ fontWeight: 500, color: shortNative ? "var(--down)" : undefined }}>{gasNeeded === undefined ? "—" : `${fmtAmount(gasNeeded, 18, 6)} ${gasSym}`}</span>
                </div>
                <div className="kv" style={{ fontSize: 12.5 }}>
                  <span>Max gas price signed</span>
                  <span className="v" style={{ fontWeight: 500 }}>{maxGasPrice === undefined ? "—" : `${Number(formatUnits(maxGasPrice, 9)).toLocaleString(undefined, { maximumFractionDigits: 3 })} gwei`}</span>
                </div>
                {(shortQuote || shortNative) && (
                  <p className="hint" style={{ color: "var(--down)" }}>Your deposit does not cover the whole schedule; buys stop when it runs out. Deposit more or shorten the schedule.</p>
                )}
              </div>
            )}
            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 10 }} onClick={schedule} disabled={busy || blocked || perBuyWei <= 0n || nCount < 1}>
              {busy ? <span className="spinner" /> : "Sign & schedule"}
            </button>
            <p className="hint" style={{ textAlign: "center" }}>Signing is free (EIP-712, no transaction). The keeper never touches funds outside this schedule&apos;s caps.</p>
          </div>

          {/* active schedules */}
          <div className="field">
            <label>Active schedules</label>
            {auths === null ? (
              <p className="hint">{hasIndexer() ? "Loading…" : "No indexer on this network — schedules cannot be listed."}</p>
            ) : active.length === 0 ? (
              <p className="hint">None. {auths.length > 0 ? `${auths.length} past schedule${auths.length === 1 ? "" : "s"}.` : ""}</p>
            ) : (
              active.map((a) => {
                const mine = a.auth.token.toLowerCase() === token.toLowerCase();
                return (
                  <div key={a.authId} className="kv" style={{ alignItems: "flex-start", gap: 12 }}>
                    <span>
                      {mine ? symbol : <span className="mono">{a.auth.token.slice(0, 6)}…{a.auth.token.slice(-4)}</span>}
                      <span className="hint" style={{ display: "block", marginTop: 2 }}>
                        every {fmtDuration(Number(a.auth.minInterval))} · up to {mine ? `${fmtAmount(BigInt(a.auth.perBuyMax), quote.decimals)} ${quote.symbol}` : `${a.auth.perBuyMax} raw`} · last run {ago(a.lastAt)}
                      </span>
                    </span>
                    <span className="v" style={{ whiteSpace: "nowrap" }}>{a.count} / {a.auth.totalCount}</span>
                  </div>
                );
              })
            )}
            <button className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={cancelAll} disabled={busy || blocked}>
              Cancel all
            </button>
            <p className="hint" style={{ textAlign: "center" }}>One transaction voids every schedule you have signed (bumps your nonce).</p>
          </div>

          {/* withdraw */}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Withdraw to your wallet</label>
            <div style={{ display: "grid", gridTemplateColumns: quote.native ? "1fr auto" : "1fr 1fr auto", gap: 8 }}>
              {!quote.native && (
                <select className="select" value={wdAsset} onChange={(e) => setWdAsset(e.target.value as "quote" | "gas")}>
                  <option value="quote">{quote.symbol}</option>
                  <option value="gas">{gasSym} (gas)</option>
                </select>
              )}
              <input className="input" type="number" min="0" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder={`0 ${symbolOf(quote.native ? "quote" : wdAsset)}`} />
              <button className="btn btn-ghost" onClick={withdraw} disabled={busy || blocked}>{busy ? <span className="spinner" /> : "Withdraw"}</button>
            </div>
            <p className="hint" style={{ cursor: "pointer" }} onClick={() => {
              const bal = wdAsset === "gas" || quote.native ? d.nativeBal : d.quoteBal;
              if (bal !== undefined) setWdAmount(formatUnits(bal, decimalsOf(quote.native ? "quote" : wdAsset)));
            }}>
              Available: {fmtAmount(wdAsset === "gas" || quote.native ? d.nativeBal : d.quoteBal, decimalsOf(quote.native ? "quote" : wdAsset), 6)} {symbolOf(quote.native ? "quote" : wdAsset)} — max
            </p>
          </div>
        </>
      )}
    </div>
  );
}
