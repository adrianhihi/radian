"use client";

// The trade form: pay / flip / receive, 25% · 50% · Max, the quote lines
// (spot price, fee, slippage → min received), the button and a result banner.
// Used by the swap console (with a token picker) and the token page (locked to
// its token). Every send is a real transaction through the shared trade path
// (lib/useTrade): router v4 with the referral tag where The Pound runs, the
// PoF router for Proof-of-Fee launches, the curve directly elsewhere.
//
// The quote mirrors PonsV2BondingCurve exactly (lib/useTrade quoteBuy / quoteSell);
// `minOut` is handed to the contract, which enforces it on chain.
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseEther, parseUnits, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { PrimaryButton } from "@/components/ui/primitives";
import { FlipButton, PayCard, QuoteLine, ReceiveCard, TokenPill } from "./SwapCards";
import { publicClient, erc20Abi, explorer, hasPound, type LaunchTemplate } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useTrade, readCurveQuoteState, quoteBuy, quoteSell, type CurveQuoteState } from "@/lib/useTrade";
import { ReceiptTimeout } from "@/lib/pendingTx";
import { fmtNum, fmtPrice } from "@/lib/ui/format";

/** What the form needs to know about a token; the page or the launch row supplies it. */
export type TradeToken = {
  token: Address;
  curve: Address;
  pairToken: Address;
  native: boolean;
  template?: LaunchTemplate | null;
  name: string;
  symbol: string;
  quoteSymbol: string;
  quoteDecimals: number;
  graduated: boolean;
};

export type Side = "buy" | "sell";

export const SLIPPAGE_OPTIONS = [50, 100, 300] as const;
const SLIPPAGE_KEY = "radian.slippageBps";
const BPS = 10_000n;
const POLL_MS = 4000;

const pctOf = (bps: bigint) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 2)}%`;

export function SwapForm({
  tk,
  candidates,
  onToken,
  onTraded,
  onPending,
}: {
  tk: TradeToken | null;
  /** the swap console's picker; the token page passes none and the token is locked */
  candidates?: TradeToken[];
  onToken?: (token: Address) => void;
  /** after a confirmed trade, so the page re-reads its own state */
  onTraded?: () => void;
  /** the receipt timed out: the page shows its pending bar and keeps checking */
  onPending?: (hash: Hex) => void;
}) {
  const t = useT();
  const { address } = useRadianWallet();
  const { buy, sell, authenticated, login, identityOk } = useTrade();

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [cs, setCs] = useState<CurveQuoteState | null>(null);
  const [quoteBal, setQuoteBal] = useState<bigint | null>(null);
  const [tokenBal, setTokenBal] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Slippage tolerance is a per-viewer preference.
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(SLIPPAGE_KEY));
      if (Number.isFinite(v) && (SLIPPAGE_OPTIONS as readonly number[]).includes(v)) setSlippageBps(v);
    } catch {}
  }, []);
  const pickSlippage = (bps: number) => {
    setSlippageBps(bps);
    try {
      window.localStorage.setItem(SLIPPAGE_KEY, String(bps));
    } catch {}
  };

  const dec = tk?.quoteDecimals ?? 18;

  // Curve facts for the quote (the snipe tax decays by the second, so keep
  // polling while the form is open) and the wallet's balances for Max.
  const refresh = useCallback(async () => {
    if (!tk) return;
    try {
      setCs(await readCurveQuoteState(tk.curve, address));
    } catch {
      setCs(null);
    }
    if (!address) {
      setQuoteBal(null);
      setTokenBal(null);
      return;
    }
    try {
      const [qb, tb] = await Promise.all([
        tk.native ? publicClient.getBalance({ address }) : (publicClient.readContract({ address: tk.pairToken, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>),
        publicClient.readContract({ address: tk.token, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
      ]);
      setQuoteBal(qb);
      setTokenBal(tb);
    } catch {
      setQuoteBal(null);
      setTokenBal(null);
    }
  }, [tk?.curve, tk?.token, tk?.pairToken, tk?.native, address]);

  useEffect(() => {
    setCs(null);
    setMsg(null);
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);

  const onAmount = (v: string) => {
    setAmount(v);
    setMsg(null);
  };
  const flip = () => {
    setSide((s) => (s === "buy" ? "sell" : "buy"));
    setAmount(""); // the unit changes with the side; a kept number would be the wrong one
    setMsg(null);
  };

  const inWei = useMemo(() => {
    if (!amount) return 0n;
    try {
      return side === "buy" ? parseUnits(amount, dec) : parseEther(amount);
    } catch {
      return 0n;
    }
  }, [amount, side, dec]);

  const q = cs && inWei > 0n ? (side === "buy" ? quoteBuy(cs, inWei, slippageBps) : quoteSell(cs, inWei, slippageBps)) : null;
  const bal = side === "buy" ? quoteBal : tokenBal;
  const over = bal != null && inWei > bal;
  const spot = cs && cs.tokenReserve > 0n ? Number(formatUnits(cs.quoteReserve, dec)) / Number(formatUnits(cs.tokenReserve, 18)) : 0;
  // effective snipe tax on a buy: the contract clamps it below the fee ceiling
  const snipeBps = (() => {
    if (!cs || side !== "buy" || cs.snipeBps <= 0n) return 0n;
    const max = BPS - cs.feeBps - cs.creatorTaxBps - 100n;
    return cs.snipeBps > max ? max : cs.snipeBps;
  })();

  const fmtOut = (v: bigint) => (side === "buy" ? fmtNum(Number(formatUnits(v, 18)), 0) : fmtNum(Number(formatUnits(v, dec)), 4));
  const outSym = side === "buy" ? tk?.symbol : tk?.quoteSymbol;
  const inSym = side === "buy" ? tk?.quoteSymbol : tk?.symbol;

  const fraction = (f: number) => {
    if (bal == null) return;
    // a native quote keeps 5% back for gas
    const base = side === "buy" && tk?.native ? (bal * 95n) / 100n : bal;
    const v = (base * BigInt(Math.round(f * 100))) / 100n;
    onAmount(formatUnits(v, side === "buy" ? dec : 18));
  };

  const shownError = !amount ? "" : over ? t("trade.tooMuch") : !q && cs ? t("trade.needAmount") : "";
  const invalid = !q || over || busy || !identityOk;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tk) return;
    if (!q) {
      setMsg({ ok: false, text: t("trade.needAmount") });
      return;
    }
    if (over) {
      setMsg({ ok: false, text: t("trade.tooMuch") });
      return;
    }
    if (!identityOk) {
      setMsg({ ok: false, text: t("quick.identity") });
      return;
    }
    setBusy(true);
    setMsg(null);
    const target = { token: tk.token, curve: tk.curve, pairToken: tk.pairToken, native: tk.native, template: tk.template };
    const onStatus = (s: string) =>
      setStatus(
        s === "approve"
          ? t("trade.approve", { sym: side === "buy" ? tk.quoteSymbol : tk.symbol })
          : s === "confirm"
            ? side === "buy"
              ? t("trade.confirmBuy")
              : t("trade.confirmSell")
            : s === "sent"
              ? t("trade.sent")
              : null,
      );
    const est = fmtOut(q.out);
    try {
      if (side === "buy") await buy(target, inWei, q.minOut, onStatus);
      else await sell(target, inWei, q.minOut, onStatus);
      setMsg({ ok: true, text: side === "buy" ? t("trade.doneBuy", { v: est, sym: tk.symbol }) : t("trade.doneSell", { v: est, sym: tk.quoteSymbol }) });
      setAmount("");
      onTraded?.();
      refresh();
    } catch (err: any) {
      if (err instanceof ReceiptTimeout) {
        setMsg({ ok: true, text: t("trade.pending") });
        onPending?.(err.hash);
      } else {
        setMsg({ ok: false, text: err?.shortMessage ?? err?.message ?? "Failed." });
      }
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  if (!tk) return <p className="text-[13px] text-muted">{t("swap.noTokens")}</p>;

  const picker =
    candidates && candidates.length > 1 && onToken ? (
      <span className="relative flex-shrink-0">
        <select
          aria-label={t("swap.pickAria")}
          value={tk.token}
          onChange={(e) => onToken(e.target.value as Address)}
          className="mono-label max-w-[150px] appearance-none truncate rounded-full border border-stroke-2 bg-glass-2 py-1.5 pl-3 pr-7 text-[11px] text-ink focus-visible:border-brand"
        >
          {candidates.map((c) => (
            <option key={c.token} value={c.token}>
              {c.symbol} · {c.name}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
          <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </span>
    ) : (
      <TokenPill>{tk.symbol}</TokenPill>
    );

  if (tk.graduated)
    return (
      <div>
        {picker !== null && candidates && candidates.length > 1 && <div className="mb-3 flex justify-end">{picker}</div>}
        <div className="rounded-xl border border-stroke-2 px-4 py-6 text-center">
          <span className="mono-label rounded-full border border-signal/60 px-2.5 py-1 text-[10.5px] tracking-[.12em] text-signal">{t("tcard.graduated")}</span>
          <p className="mt-3 text-[13px] leading-[1.7] text-muted">{t("trade.graduatedBody")}</p>
          <a href={explorer.address(tk.token)} target="_blank" rel="noreferrer" className="mono-label mt-3 inline-block text-[11px] tracking-[.08em] text-brand hover:underline">
            {t("trade.onExplorer")}
          </a>
        </div>
      </div>
    );

  const chip = "flex-1 rounded-[7px] border border-stroke bg-glass-2 px-2 py-2 text-xs text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-40";
  const inputId = `swap-amount-${tk.token.slice(2, 8)}`;

  return (
    <>
      <form noValidate onSubmit={submit}>
        <PayCard
          label={t("trade.youPay")}
          inputId={inputId}
          balance={bal != null ? t(side === "buy" ? "trade.balance" : "trade.holding", { v: `${fmtNum(Number(formatUnits(bal, side === "buy" ? dec : 18)), side === "buy" ? 4 : 0)} ${inSym}` }) : ""}
          inputProps={{
            name: "amount",
            "aria-describedby": `${inputId}-error`,
            "aria-invalid": Boolean(shownError),
            "aria-label": side === "buy" ? t("trade.payAria") : t("trade.sellAria"),
            value: amount,
            onChange: (e) => onAmount(e.target.value),
          }}
          trailing={side === "buy" ? <TokenPill>{tk.quoteSymbol}</TokenPill> : picker}
        />
        <FlipButton label={t("trade.flipAria")} onClick={flip} />
        <ReceiveCard label={t("trade.youReceive")} value={q ? fmtOut(q.out) : "—"} trailing={side === "buy" ? picker : <TokenPill>{tk.quoteSymbol}</TokenPill>} />

        <div className="my-3 flex gap-2">
          {([0.25, 0.5, 1] as const).map((f) => (
            <button key={f} type="button" className={chip} disabled={bal == null} onClick={() => fraction(f)}>
              {f === 1 ? t("trade.max") : `${f * 100}%`}
            </button>
          ))}
        </div>

        {side === "buy" && snipeBps > 0n && cs && (
          <div role="alert" className="my-3 rounded-lg border border-neg/40 bg-[rgba(240,102,90,.1)] px-3 py-2.5 text-[12.5px] leading-[1.6] text-ink-2">
            <b className="text-neg">{t("trade.snipeNow", { p: pctOf(snipeBps) })}</b> {t("trade.snipeBody", { s: cs.snipeTaxSeconds.toString() })}
          </div>
        )}

        <div className="my-[18px] grid gap-[10px]">
          <QuoteLine label={t("trade.spot")} value={cs ? `${fmtPrice(spot)} ${tk.quoteSymbol}` : "—"} muted />
          <QuoteLine
            label={
              cs
                ? `${t("trade.fee")} · ${pctOf(cs.feeBps)}${cs.creatorTaxBps > 0n ? ` + ${pctOf(cs.creatorTaxBps)} ${t("trade.creatorTax")}` : ""}${snipeBps > 0n ? ` + ${pctOf(snipeBps)} ${t("trade.snipeTax")}` : ""}`
                : t("trade.fee")
            }
            value={q ? `${fmtNum(Number(formatUnits(q.fee, dec)), 4)} ${tk.quoteSymbol}` : "—"}
            muted
          />
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted">{t("trade.slippage")}</span>
            <span role="group" aria-label={t("trade.slippageAria")} className="inline-flex gap-0.5 rounded-md border border-stroke bg-glass-2 p-0.5">
              {SLIPPAGE_OPTIONS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  aria-pressed={slippageBps === bps}
                  onClick={() => pickSlippage(bps)}
                  className={`tnum rounded px-2 py-0.5 text-[11px] ${slippageBps === bps ? "bg-glass-hi text-ink" : "text-ink-3 hover:text-ink-2"}`}
                >
                  {bps / 100}%
                </button>
              ))}
            </span>
          </div>
          <QuoteLine label={t("trade.minOut")} value={q ? `${fmtOut(q.minOut)} ${outSym}` : "—"} />
        </div>

        <p id={`${inputId}-error`} role="status" className="mb-2 min-h-5 text-[13px] leading-[1.6] text-neg">
          {shownError}
        </p>

        {!authenticated ? (
          <PrimaryButton type="button" onClick={login}>
            {t("trade.connect")}
          </PrimaryButton>
        ) : (
          <PrimaryButton type="submit" disabled={invalid}>
            {busy ? (status ?? "…") : side === "buy" ? (snipeBps > 0n ? t("trade.buyAnyway", { p: pctOf(snipeBps) }) : t("trade.buy")) : t("trade.sell")}
          </PrimaryButton>
        )}

        <p className="mt-3 text-center text-[11.5px] leading-[1.7] text-ink-3">
          {t("trade.noteMin")}
          {tk.template?.kind === "pof" && side === "buy" && ` ${t("trade.notePof")}`}
          {hasPound && tk.template?.kind !== "pof" && ` ${t("trade.notePound")}`}
        </p>
      </form>

      {msg && (
        <div role="status" className={`mt-[15px] rounded-lg p-3 text-[13px] leading-[1.7] ${msg.ok ? "bg-[rgba(108,199,154,.13)] text-pos" : "bg-[rgba(240,102,90,.12)] text-neg"}`}>
          {msg.text}
        </div>
      )}
    </>
  );
}
