"use client";

// Auto-buy through RadianExecutor, on the design system. The user deposits
// quote (and the gas coin for gas when the quote is an ERC-20), signs an
// EIP-712 BuyAuth off-chain and posts it to the indexer, whose keeper executes
// the buys on schedule. Tokens always land in the user's wallet. Withdraw and
// cancel are plain transactions that need nobody's cooperation.
import { useCallback, useEffect, useState } from "react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { OutlineButton, Panel, PrimaryButton } from "@/components/ui/primitives";
import { ChipGroup, Note, PanelHead, Row, SignInButton, Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import { publicClient, arcTestnet, erc20Abi, curveAbi, explorer, RADIAN, NATIVE_QUOTE, type QuoteAsset, activeNetwork } from "@/lib/radian";
import { executorAbi, executorDomain, BUY_AUTH_TYPES, EXECUTOR_FEE_BPS, EXECUTOR_GAS_STIPEND, EXECUTOR_V2 } from "@/lib/executor";
import { fetchAuths, postAuth, hasIndexer, type AuthRecord } from "@/lib/indexer";
import { fmtAmount, fmtDuration } from "@/lib/templates";
import { useRadianWallet } from "@/lib/useRadianWallet";
import type { IdentityResult } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";
import { recordTx } from "@/lib/txLog";

const INTERVALS = [
  { label: "1h", secs: 3600 },
  { label: "6h", secs: 21600 },
  { label: "24h", secs: 86400 },
] as const;
const CUSTOM = 0;
const GWEI = 1_000_000_000n;
// executor v2: the signed price floor, as "stop if the price is above N× today's"
const PRICE_CAPS = [
  { label: "1.5×", mult: 150 },
  { label: "2×", mult: 200 },
  { label: "3×", mult: 300 },
] as const;
const NO_CAP = 0;

type Props = {
  token: Address;
  curve: Address;
  symbol: string;
  quote: QuoteAsset;
  identity: IdentityResult;
  onToast: (m: string) => void;
  onPending: (h: Hex) => void;
  refreshKey: number;
};

type Data = Partial<{ quoteBal: bigint; nativeBal: bigint; nonce: bigint; feeBps: bigint; stipend: bigint; gasPrice: bigint; reserves: readonly [bigint, bigint] }>;
type Which = "quote" | "gas";

export function AutoBuyPanel({ token, curve, symbol, quote, identity, onToast, onPending, refreshKey }: Props) {
  const t = useT();
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const executor = RADIAN.executor;
  const quoteAddr: Address = quote.native ? NATIVE_QUOTE : quote.address;
  const gasSym = activeNetwork.nativeSymbol ?? "USDC";
  const [d, setD] = useState<Data>({});
  const [auths, setAuths] = useState<AuthRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);

  // deposit / withdraw forms
  const [depAsset, setDepAsset] = useState<Which>("quote");
  const [depAmount, setDepAmount] = useState("");
  const [wdAsset, setWdAsset] = useState<Which>("quote");
  const [wdAmount, setWdAmount] = useState("");
  // schedule form
  const [perBuy, setPerBuy] = useState("");
  const [intervalSecs, setIntervalSecs] = useState<number>(3600);
  const [customSecs, setCustomSecs] = useState("");
  const [count, setCount] = useState("10");
  const [validSecs, setValidSecs] = useState<number>(7 * 86400);
  const [capMult, setCapMult] = useState<number>(200);

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
          { address: curve, abi: curveAbi, functionName: "getReserves" },
        ],
      });
      const g = (i: number) => (mc[i].status === "success" ? (mc[i].result as bigint) : undefined);
      const gasPrice = await publicClient.getGasPrice().catch(() => undefined);
      const reserves = mc[5].status === "success" ? (mc[5].result as readonly [bigint, bigint]) : undefined;
      setD({ quoteBal: g(0), nativeBal: g(1), nonce: g(2), feeBps: g(3), stipend: g(4), gasPrice, reserves });
    } catch {}
    if (hasIndexer()) {
      try {
        setAuths(await fetchAuths(account));
      } catch {
        setAuths((a) => a ?? []);
      }
    }
  }, [account, executor, quoteAddr, curve]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load, refreshKey]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(iv);
  }, []);

  const blocked = identity.checked && !identity.ok;
  const feeBps = d.feeBps ?? EXECUTOR_FEE_BPS;
  const stipend = d.stipend ?? EXECUTOR_GAS_STIPEND;
  // Cap on what the keeper may charge per buy for gas: 3× the current gas price, at least 1 gwei.
  const maxGasPrice = d.gasPrice !== undefined ? (d.gasPrice * 3n > GWEI ? d.gasPrice * 3n : GWEI) : undefined;
  const stipendCap = maxGasPrice !== undefined ? stipend * maxGasPrice : undefined; // native, per buy
  // v2 price floor: tokens per quote unit (1e18-scaled) the keeper must still get, = today's spot / cap.
  const priceFloor = (): bigint => {
    if (!EXECUTOR_V2 || capMult === 0 || !d.reserves) return 0n;
    const [q, tk] = d.reserves;
    if (q === 0n) return 0n;
    return (((tk * 10n ** 18n) / q) * 100n) / BigInt(capMult);
  };

  const effInterval = intervalSecs === CUSTOM ? Math.round(Number(customSecs) || 0) : intervalSecs;
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
    if (blocked) return onToast(t("quick.identity"));
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

  const assetOf = (which: Which) => (which === "gas" || quote.native ? NATIVE_QUOTE : quote.address);
  const decimalsOf = (which: Which) => (which === "gas" ? 18 : quote.decimals);
  const symbolOf = (which: Which) => (which === "gas" ? gasSym : quote.symbol);
  const wdWhich: Which = quote.native ? "quote" : wdAsset;
  const wdBal = wdWhich === "gas" || quote.native ? d.nativeBal : d.quoteBal;

  const deposit = () =>
    withWallet(async (client, acct) => {
      const dec = decimalsOf(depAsset);
      const amt = parseUnits(depAmount || "0", dec);
      if (amt <= 0n) return onToast(t("auto.enterDeposit"));
      const asset = assetOf(depAsset);
      if (asset === NATIVE_QUOTE) {
        onToast(t("auto.confirmDeposit"));
        const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "deposit", value: amt });
        await waitReceipt(h, "deposit", { token });
        recordTx(acct, { hash: h, kind: "deposit", token, time: Date.now() });
      } else {
        const allowance = (await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [acct, executor] })) as bigint;
        if (allowance < amt) {
          onToast(t("trade.approve", { sym: quote.symbol }));
          const ah = await client.writeContract({ account: acct, chain: arcTestnet, address: asset, abi: erc20Abi, functionName: "approve", args: [executor, amt] });
          await waitReceipt(ah, "approve");
          const after = (await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "allowance", args: [acct, executor] })) as bigint;
          if (after < amt) throw new Error(t("auto.approveShort"));
        }
        onToast(t("auto.confirmDeposit"));
        const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "depositToken", args: [asset, amt] });
        await waitReceipt(h, "deposit", { token });
        recordTx(acct, { hash: h, kind: "deposit", token, time: Date.now() });
      }
      onToast(t("auto.depositDone"));
      setDepAmount("");
    });

  const withdraw = () =>
    withWallet(async (client, acct) => {
      const amt = parseUnits(wdAmount || "0", decimalsOf(wdWhich));
      if (amt <= 0n) return onToast(t("auto.enterWithdraw"));
      onToast(t("auto.confirmWithdraw"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "withdraw", args: [assetOf(wdWhich), amt, acct] });
      await waitReceipt(h, "withdraw", { token });
      recordTx(acct, { hash: h, kind: "withdraw", token, time: Date.now() });
      onToast(t("auto.withdrawn"));
      setWdAmount("");
    });

  const cancelAll = () =>
    withWallet(async (client, acct) => {
      onToast(t("auto.confirmCancel"));
      const h = await client.writeContract({ account: acct, chain: arcTestnet, address: executor, abi: executorAbi, functionName: "cancelAuth" });
      await waitReceipt(h, "cancel", { token });
      recordTx(acct, { hash: h, kind: "cancel", token, time: Date.now() });
      onToast(t("auto.cancelled"));
    });

  const schedule = () =>
    withWallet(async (client, acct) => {
      if (!hasIndexer()) return onToast(t("auto.needsIndexer"));
      if (perBuyWei <= 0n) return onToast(t("auto.enterPerBuy"));
      if (effInterval < 60) return onToast(t("auto.intervalMin"));
      if (nCount < 1 || nCount > 4_000_000_000) return onToast(t("auto.enterCount"));
      if (maxGasPrice === undefined) return onToast(t("auto.noGasPrice"));
      const nonce = (await publicClient.readContract({ address: executor, abi: executorAbi, functionName: "nonces", args: [acct] })) as bigint;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + validSecs);
      const floor = priceFloor();
      if (EXECUTOR_V2 && capMult !== 0 && floor === 0n) return onToast(t("auto.noPrice"));
      const message = EXECUTOR_V2
        ? { user: acct, token, asset: quoteAddr, perBuyMax: perBuyWei, minPerBuy: perBuyWei, minTokensPerQuote: floor, maxGasPrice, totalCount: nCount, minInterval: effInterval, deadline, nonce }
        : { user: acct, token, perBuyMax: perBuyWei, maxGasPrice, totalCount: nCount, minInterval: effInterval, deadline, nonce };
      onToast(t("auto.signSchedule"));
      // the types object follows the executor generation, so viem's literal typing is per-version: cast
      const signature = (await client.signTypedData({ account: acct, domain: executorDomain(), types: BUY_AUTH_TYPES, primaryType: "BuyAuth", message } as never)) as Hex;
      await postAuth(
        {
          user: acct, token,
          perBuyMax: perBuyWei.toString(), maxGasPrice: maxGasPrice.toString(), totalCount: String(nCount),
          minInterval: String(effInterval), deadline: deadline.toString(), nonce: nonce.toString(),
          ...(EXECUTOR_V2 ? { asset: quoteAddr, minPerBuy: perBuyWei.toString(), minTokensPerQuote: floor.toString() } : {}),
        },
        signature,
      );
      onToast(t("auto.scheduled"));
      setPerBuy("");
    });

  const ago = (ts: number) => (ts > 0 && now > 0 ? t("wall.ago", { v: fmtDuration(Math.max(0, now - ts)) }) : t("wall.never"));
  const active = (auths ?? []).filter((a) => a.status === "active");
  const label = "block text-[12px] text-muted";
  const sub = "mt-4 mb-2 mono-label text-[10.5px] tracking-[.14em] text-ink-3";

  return (
    <Panel>
      <PanelHead title={t("auto.title")} address={executor} explorer={explorer.address} label={t("auto.executor")} />
      <Note className="mb-3">{t("auto.body", { sym: symbol, q: quote.symbol, fee: (Number(feeBps) / 100).toFixed(2), gas: stipend.toString(), gasSym })}</Note>

      {!authenticated ? (
        <SignInButton onClick={login} label={t("auto.signIn")} />
      ) : (
        <>
          <Row label={t("auto.deposited", { sym: quote.symbol })} value={`${fmtAmount(d.quoteBal, quote.decimals)} ${quote.symbol}`} />
          {!quote.native && <Row label={t("auto.depositedGas", { sym: gasSym })} value={`${fmtAmount(d.nativeBal, 18, 6)} ${gasSym}`} />}

          {/* deposit */}
          <div className={sub}>{t("auto.deposit")}</div>
          <div className={`grid gap-2 ${quote.native ? "grid-cols-[1fr_auto]" : "grid-cols-[auto_1fr_auto]"}`}>
            {!quote.native && <ChipGroup label={t("auto.assetAria")} value={depAsset} onChange={setDepAsset} options={[{ value: "quote", label: quote.symbol }, { value: "gas", label: `${gasSym} · gas` }]} />}
            <input type="text" inputMode="decimal" autoComplete="off" value={depAmount} onChange={(e) => setDepAmount(e.target.value)} placeholder={`0 ${symbolOf(quote.native ? "quote" : depAsset)}`} aria-label={t("auto.deposit")} className={`${INPUT_CLASS} tnum py-2`} />
            <OutlineButton type="button" onClick={deposit} disabled={busy || blocked}>
              {busy ? <Spinner /> : t("auto.depositBtn")}
            </OutlineButton>
          </div>
          {!quote.native && depAsset === "quote" && <Note className="mt-1.5">{t("auto.erc20Note")}</Note>}

          {/* schedule */}
          <div className={sub}>{t("auto.schedule")}</div>
          <div className="grid gap-3 min-[520px]:grid-cols-2">
            <div>
              <label htmlFor={`ab-per-${token.slice(2, 8)}`} className={label}>
                {t("auto.perBuy", { sym: quote.symbol })}
              </label>
              <input id={`ab-per-${token.slice(2, 8)}`} type="text" inputMode="decimal" autoComplete="off" value={perBuy} onChange={(e) => setPerBuy(e.target.value)} placeholder="0" className={`${INPUT_CLASS} tnum mt-1 py-2`} />
            </div>
            <div>
              <label htmlFor={`ab-n-${token.slice(2, 8)}`} className={label}>
                {t("auto.count")}
              </label>
              <input id={`ab-n-${token.slice(2, 8)}`} type="number" min="1" step="1" value={count} onChange={(e) => setCount(e.target.value)} className={`${INPUT_CLASS} tnum mt-1 py-2`} />
            </div>
            <div>
              <span className={label}>{t("auto.every")}</span>
              <div className="mt-1">
                <ChipGroup label={t("auto.every")} value={intervalSecs} onChange={setIntervalSecs} options={[...INTERVALS.map((iv) => ({ value: iv.secs, label: iv.label })), { value: CUSTOM, label: t("auto.custom") }]} />
              </div>
              {intervalSecs === CUSTOM && <input type="number" min="60" step="1" value={customSecs} onChange={(e) => setCustomSecs(e.target.value)} placeholder={t("auto.secondsPh")} aria-label={t("auto.every")} className={`${INPUT_CLASS} tnum mt-2 py-2`} />}
            </div>
            <div>
              <span className={label}>{t("auto.validFor")}</span>
              <div className="mt-1">
                <ChipGroup label={t("auto.validFor")} value={validSecs} onChange={setValidSecs} options={[{ value: 7 * 86400, label: t("auto.days", { n: 7 }) }, { value: 30 * 86400, label: t("auto.days", { n: 30 }) }]} />
              </div>
            </div>
            {EXECUTOR_V2 && (
              <div className="min-[520px]:col-span-2">
                <span className={label}>{t("auto.priceCap")}</span>
                <div className="mt-1">
                  <ChipGroup label={t("auto.priceCap")} value={capMult} onChange={setCapMult} options={[...PRICE_CAPS.map((c) => ({ value: c.mult, label: c.label })), { value: NO_CAP, label: t("auto.noCap") }]} />
                </div>
                <Note className="mt-1.5">{t("auto.priceCapNote")}</Note>
              </div>
            )}
          </div>
          {perBuyWei > 0n && nCount > 0 && (
            <div className="mt-3">
              <Row small label={t("auto.needed", { n: nCount })} value={`${fmtAmount(quoteNeeded, quote.decimals)} ${quote.symbol}`} tone={shortQuote ? "neg" : "muted"} />
              <Row small label={quote.native ? t("auto.stipendSame") : t("auto.stipend")} value={gasNeeded === undefined ? "—" : `${fmtAmount(gasNeeded, 18, 6)} ${gasSym}`} tone={shortNative ? "neg" : "muted"} />
              <Row small label={t("auto.maxGas")} value={maxGasPrice === undefined ? "—" : `${Number(formatUnits(maxGasPrice, 9)).toLocaleString(undefined, { maximumFractionDigits: 3 })} gwei`} tone="muted" />
              {(shortQuote || shortNative) && <Note tone="neg" className="mt-1.5">{t("auto.shortNote")}</Note>}
            </div>
          )}
          <PrimaryButton type="button" className="mt-3" onClick={schedule} disabled={busy || blocked || perBuyWei <= 0n || nCount < 1}>
            {busy ? <Spinner /> : t("auto.signBtn")}
          </PrimaryButton>
          <Note className="mt-2 text-center">{t("auto.signNote")}</Note>

          {/* active schedules */}
          <div className={sub}>{t("auto.active")}</div>
          {auths === null ? (
            <Note>{hasIndexer() ? t("wall.loading") : t("auto.noIndexer")}</Note>
          ) : active.length === 0 ? (
            <Note>{t("auto.none")} {auths.length > 0 ? t("auto.past", { n: auths.length }) : ""}</Note>
          ) : (
            <ul className="divide-y divide-stroke rounded-xl border border-stroke">
              {active.map((a) => {
                const mine = a.auth.token.toLowerCase() === token.toLowerCase();
                return (
                  <li key={a.authId} className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-[13px]">
                    <span className="min-w-0">
                      <span className="text-ink">{mine ? symbol : <span className="font-mono text-[12px]">{a.auth.token.slice(0, 6)}…{a.auth.token.slice(-4)}</span>}</span>
                      <span className="block text-[11.5px] text-ink-3">
                        {t("auto.everyLine", { v: fmtDuration(Number(a.auth.minInterval)) })} · {t("auto.upTo", { v: mine ? `${fmtAmount(BigInt(a.auth.perBuyMax), quote.decimals)} ${quote.symbol}` : `${a.auth.perBuyMax} raw` })}
                        {a.auth.minTokensPerQuote && a.auth.minTokensPerQuote !== "0" ? ` · ${t("auto.capped")}` : ""} · {t("auto.lastRun", { v: ago(a.lastAt) })}
                      </span>
                    </span>
                    <span className="tnum whitespace-nowrap text-ink">
                      {a.count} / {a.auth.totalCount}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <OutlineButton type="button" className="mt-2 w-full" onClick={cancelAll} disabled={busy || blocked}>
            {t("auto.cancelAll")}
          </OutlineButton>
          <Note className="mt-1.5 text-center">{t("auto.cancelNote")}</Note>

          {/* withdraw */}
          <div className={sub}>{t("auto.withdraw")}</div>
          <div className={`grid gap-2 ${quote.native ? "grid-cols-[1fr_auto]" : "grid-cols-[auto_1fr_auto]"}`}>
            {!quote.native && <ChipGroup label={t("auto.assetAria")} value={wdAsset} onChange={setWdAsset} options={[{ value: "quote", label: quote.symbol }, { value: "gas", label: `${gasSym} · gas` }]} />}
            <input type="text" inputMode="decimal" autoComplete="off" value={wdAmount} onChange={(e) => setWdAmount(e.target.value)} placeholder={`0 ${symbolOf(wdWhich)}`} aria-label={t("auto.withdraw")} className={`${INPUT_CLASS} tnum py-2`} />
            <OutlineButton type="button" onClick={withdraw} disabled={busy || blocked}>
              {busy ? <Spinner /> : t("auto.withdrawBtn")}
            </OutlineButton>
          </div>
          <Note className="mt-1.5">
            {t("auto.available")}{" "}
            <button type="button" className="text-brand hover:underline" onClick={() => wdBal !== undefined && setWdAmount(formatUnits(wdBal, decimalsOf(wdWhich)))}>
              {fmtAmount(wdBal, decimalsOf(wdWhich), 6)} {symbolOf(wdWhich)}
            </button>
          </Note>
        </>
      )}
    </Panel>
  );
}
