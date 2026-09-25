"use client";

// Buy from another chain — the buyer side of "launch once, trade everywhere": pay USDC on
// Base or BNB, Relay delivers the launch's quote asset to the CrossBuyReceiver on the home
// chain and calls it in the same fill, and the receiver buys through the router for this
// wallet with its referral tag (lib/crossBuy.ts, docs/CROSS_CHAIN_BUY.md). Sits under the
// trade console on the token page and in the swap aside.
//
// Honest gates, in order: no `crossBuy` on the network → nothing rendered; `receiver` unset
// → "not wired on this network yet"; Relay's chain list unreachable → says so; the home
// chain not in it (the testnet) → the form, disabled, with the explainer. A quote that fails
// shows Relay's words, never an estimate. The Buy button re-quotes first (the numbers shown
// are a preview; the calls carry the price bound of the quote that is sent), then one wallet
// confirmation per Relay step on the origin chain. Nothing is retried or resent.
import { Check, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { PrimaryButton } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { PayCard, QuoteLine, TokenPill } from "./SwapCards";
import { SLIPPAGE_KEY, SLIPPAGE_OPTIONS, type TradeToken } from "./SwapForm";
import { CrossBuyError, executeCrossBuy, originExplorerTx, originUsdcBalance, quoteCrossBuy, relaySupports, type CrossBuyQuote, type CrossBuyStage, type RelayAmount } from "@/lib/crossBuy";
import { useIdentity } from "@/lib/identity";
import { useNetwork, type CrossBuyOrigin } from "@/lib/networks";
import { getReferrer } from "@/lib/referral";
import { txErrorText } from "@/lib/txError";
import { recordTx } from "@/lib/txLog";
import { quoteBuy, readCurveQuoteState } from "@/lib/useTrade";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { fmtNum, usd } from "@/lib/ui/format";
import { readLS } from "@/lib/ui/storage";

type Gate = "checking" | "notWired" | "relayDown" | "unserved" | "ready";
type QuoteState = { status: "idle" } | { status: "quoting" } | { status: "ready"; q: CrossBuyQuote; bps: number } | { status: "error"; text: string };
type Outcome = { kind: "filled" | "pending" | "refunded" | "failed"; text: string; destinationTxHash?: Hex | null; originTxHash?: Hex | null };

const QUOTE_DEBOUNCE_MS = 600;
const BALANCE_POLL_MS = 15_000;
const MAX_WAIT_MIN = 15;

/** the viewer's slippage tolerance, shared with the trade form */
const slippageBps = (): number => {
  const v = Number(readLS(SLIPPAGE_KEY));
  return Number.isFinite(v) && (SLIPPAGE_OPTIONS as readonly number[]).includes(v) ? v : 100;
};
const feeText = (f: RelayAmount): string => `${f.amountFormatted} ${f.currency?.symbol ?? ""}${f.amountUsd ? ` (${usd(Number(f.amountUsd))})` : ""}`;
const tokens = (v: bigint) => fmtNum(Number(formatUnits(v, 18)), 0);

export function CrossChainBuy({ tk, onTraded, className = "" }: { tk: TradeToken; onTraded?: () => void; className?: string }) {
  const t = useT();
  const net = useNetwork();
  const cfg = net.crossBuy;
  const { address, authenticated, login, getWalletClientFor } = useRadianWallet();
  const identity = useIdentity();
  const identityOk = !(identity.checked && !identity.ok);

  const origins = useMemo(() => cfg?.origins ?? [], [cfg]);
  const [originId, setOriginId] = useState<number | null>(null);
  const origin: CrossBuyOrigin | null = origins.find((o) => o.chainId === originId) ?? origins[0] ?? null;
  const [gate, setGate] = useState<Gate>("checking");
  const [gateDetail, setGateDetail] = useState("");
  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState<bigint | null>(null);
  const [balFailed, setBalFailed] = useState(false);
  const [quote, setQuote] = useState<QuoteState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const alive = useRef(true);
  const quoteSeq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Gate: the receiver must be deployed here, and Relay must list this chain.
  useEffect(() => {
    if (!cfg) return;
    if (!cfg.receiver) {
      setGate("notWired");
      return;
    }
    let on = true;
    setGate("checking");
    relaySupports(net.chainId)
      .then((ok) => on && setGate(ok ? "ready" : "unserved"))
      .catch((e: unknown) => {
        if (!on) return;
        setGateDetail((e as Error)?.message ?? "");
        setGate("relayDown");
      });
    return () => {
      on = false;
    };
  }, [cfg, net.chainId]);

  // The buyer's USDC on the chosen origin chain.
  useEffect(() => {
    if (!origin || !address || gate !== "ready") {
      setBal(null);
      return;
    }
    let on = true;
    setBalFailed(false);
    const pull = () =>
      originUsdcBalance(origin, address)
        .then((b) => on && setBal(b))
        .catch(() => on && setBalFailed(true));
    pull();
    const iv = setInterval(pull, BALANCE_POLL_MS);
    return () => {
      on = false;
      clearInterval(iv);
    };
  }, [origin, address, gate]);

  const dec = origin?.usdcDecimals ?? 6;
  const inWei = useMemo(() => {
    if (!amount) return 0n;
    try {
      return parseUnits(amount, dec);
    } catch {
      return 0n;
    }
  }, [amount, dec]);

  const chain = origin?.label ?? "";
  const home = net.chainName;

  const failText = useCallback(
    (e: unknown): string => {
      if (e instanceof CrossBuyError) {
        switch (e.kind) {
          case "unknownToken":
            return t("xbuy.unknownToken");
          case "curve":
            return t("xbuy.curveQuote");
          case "unsupportedStep":
            return t("xbuy.unsupportedStep", { kind: e.detail });
          case "noWallet":
            return t("xbuy.noWallet");
          case "relay":
            return t("xbuy.quoteFailed", { m: e.detail });
          case "reverted":
            return t("tx.errRevertedWhy", { m: e.detail });
          case "failed":
            return t("xbuy.failed", { m: e.detail || "—" });
          case "refunded":
            return t("xbuy.refunded", { chain, m: e.detail });
        }
      }
      return txErrorText(t, e, { gasSym: origin?.nativeSymbol ?? "gas", address: address ?? "" });
    },
    [t, chain, origin?.nativeSymbol, address],
  );

  /** One quote: the curve's bound for what Relay delivers, then Relay's binding quote with the calls. */
  const runQuote = useCallback(async (): Promise<{ q: CrossBuyQuote; bps: number } | null> => {
    if (!cfg?.receiver || !origin || !address || inWei <= 0n || gate !== "ready") return null;
    const seq = ++quoteSeq.current;
    setQuote({ status: "quoting" });
    try {
      const bps = slippageBps();
      const cs = await readCurveQuoteState(tk.curve, address);
      const q = await quoteCrossBuy({
        origin,
        amount: inWei,
        token: tk.token,
        recipient: address,
        receiver: cfg.receiver,
        homeChainId: net.chainId,
        refundTo: address,
        referrer: getReferrer(),
        curveQuote: (delivered) => {
          const r = quoteBuy(cs, delivered, bps);
          return r ? { out: r.out, minOut: r.minOut } : null;
        },
      });
      if (!alive.current || seq !== quoteSeq.current) return null;
      setQuote({ status: "ready", q, bps });
      return { q, bps };
    } catch (e: unknown) {
      if (!alive.current || seq !== quoteSeq.current) return null;
      setQuote({ status: "error", text: failText(e) });
      return null;
    }
  }, [cfg, origin, address, inWei, gate, tk.curve, tk.token, net.chainId, failText]);

  useEffect(() => {
    if (inWei <= 0n) {
      quoteSeq.current += 1; // a quote in flight for an amount that is gone must not land
      setQuote({ status: "idle" });
      return;
    }
    const id = setTimeout(() => void runQuote(), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [inWei, runQuote]);

  const onAmount = (v: string) => {
    setAmount(v);
    setOutcome(null);
  };
  const pickOrigin = (id: number) => {
    setOriginId(id);
    setQuote({ status: "idle" });
    setOutcome(null);
  };
  const fraction = (f: number) => {
    if (bal == null) return;
    onAmount(formatUnits((bal * BigInt(Math.round(f * 100))) / 100n, dec));
  };

  const stageText = (s: CrossBuyStage) =>
    s === "switch" ? t("xbuy.stSwitch", { chain }) : s === "approve" ? t("xbuy.stApprove", { chain }) : s === "confirm" ? t("xbuy.stConfirm", { chain }) : s === "sent" ? t("xbuy.stSent", { chain }) : t("xbuy.stFilling", { home });

  const buy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!origin || !address || busy || gate !== "ready") return;
    if (inWei <= 0n) {
      setQuote({ status: "error", text: t("trade.needAmount") });
      return;
    }
    if (!identityOk) {
      setOutcome({ kind: "failed", text: t("quick.identity") });
      return;
    }
    setBusy(true);
    setOutcome(null);
    let originTxHash: Hex | null = null;
    try {
      const fresh = await runQuote(); // the binding quote; the panel shows it before the wallet opens
      if (!fresh) return;
      const { q } = fresh;
      if (bal != null && BigInt(q.pay.amount) > bal) {
        setOutcome({ kind: "failed", text: t("trade.tooMuch") });
        return;
      }
      const res = await executeCrossBuy(q, {
        getClient: getWalletClientFor,
        maxWaitMs: MAX_WAIT_MIN * 60_000,
        onStage: (s, meta) => {
          if (meta?.hash) originTxHash = meta.hash;
          if (alive.current) setStage(stageText(s));
        },
      });
      if (!alive.current) return;
      originTxHash = res.originTxHash ?? originTxHash;
      if (res.status === "pending") {
        setOutcome({ kind: "pending", text: t("xbuy.pendingLong", { min: MAX_WAIT_MIN, id: res.requestId ?? "—" }), originTxHash });
        return;
      }
      if (res.destinationTxHash) recordTx(address, { hash: res.destinationTxHash, kind: "buy", token: tk.token, amount: `${q.pay.amountFormatted} USDC · ${origin.label}`, time: Date.now() });
      setOutcome({ kind: "filled", text: t("xbuy.done", { v: tokens(q.tokensOut), sym: tk.symbol, home }), destinationTxHash: res.destinationTxHash, originTxHash });
      setAmount("");
      setQuote({ status: "idle" });
      onTraded?.();
    } catch (err: unknown) {
      if (!alive.current) return;
      setOutcome({ kind: err instanceof CrossBuyError && err.kind === "refunded" ? "refunded" : "failed", text: failText(err), originTxHash });
    } finally {
      if (alive.current) {
        setBusy(false);
        setStage(null);
      }
    }
  };

  if (!cfg || tk.graduated) return null;

  const disabled = gate !== "ready";
  const q = quote.status === "ready" ? quote.q : null;
  const bps = quote.status === "ready" ? quote.bps : slippageBps();
  const over = bal != null && (q ? BigInt(q.pay.amount) : inWei) > bal;
  const inputId = `xbuy-amount-${tk.token.slice(2, 8)}`;
  const chipCls = (o: CrossBuyOrigin) =>
    `mono-label rounded-full border px-3 py-1 text-[10.5px] tracking-[.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
      o.chainId === origin?.chainId ? "border-brand bg-glass-2 text-brand" : "border-stroke text-ink-3 hover:border-brand hover:text-brand"
    }`;
  const pctChip = "flex-1 rounded-[7px] border border-stroke bg-glass-2 px-2 py-1.5 text-[11.5px] text-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40";
  const balanceText = !address || disabled ? "" : balFailed ? t("xbuy.balanceNone") : bal != null ? t("trade.balance", { v: `${fmtNum(Number(formatUnits(bal, dec)), 2)} USDC` }) : "";
  const statusText =
    busy && stage ? (
      <>
        <Spinner size={12} /> {stage}
      </>
    ) : quote.status === "quoting" ? (
      <>
        <Spinner size={12} /> {t("xbuy.quoting")}
      </>
    ) : quote.status === "error" ? (
      quote.text
    ) : over ? (
      t("trade.tooMuch")
    ) : (
      ""
    );

  return (
    <section aria-label={t("xbuy.title")} className={`rounded-xl border border-stroke-2 p-4 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">{t("xbuy.title")}</h3>
        <span className="mono-label text-[9.5px] tracking-[.14em] text-ink-3">{t("xbuy.viaRelay")}</span>
      </div>

      {gate === "notWired" ? (
        <p className="mt-2 text-[12.5px] leading-[1.7] text-muted">{t("xbuy.notWired", { home })}</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] leading-[1.6] text-ink-3">{t("xbuy.sub", { chain, home, sym: tk.symbol })}</p>
          {gate === "checking" && (
            <p role="status" className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
              <Spinner size={12} /> {t("xbuy.checking")}
            </p>
          )}
          {gate === "relayDown" && (
            <p role="status" className="mt-2 text-[12px] leading-[1.6] text-neg">
              {t("xbuy.relayDown", { m: gateDetail })}
            </p>
          )}
          {gate === "unserved" && (
            <p role="note" className="mt-2 rounded-lg border border-signal/40 bg-[rgba(106,208,224,.08)] px-3 py-2 text-[12px] leading-[1.6] text-ink-2">
              {t("xbuy.unserved", { home })}
            </p>
          )}

          <form noValidate onSubmit={buy} className="mt-3">
            <div role="group" aria-label={t("xbuy.originAria")} className="mb-3 flex flex-wrap gap-1.5">
              {origins.map((o) => (
                <button key={o.chainId} type="button" aria-pressed={o.chainId === origin?.chainId} disabled={disabled || busy} onClick={() => pickOrigin(o.chainId)} className={chipCls(o)}>
                  {o.label}
                </button>
              ))}
            </div>
            <PayCard
              label={t("xbuy.youPay", { chain })}
              inputId={inputId}
              balance={balanceText}
              inputProps={{
                name: "cross-buy-amount",
                "aria-label": t("xbuy.payAria"),
                "aria-describedby": `${inputId}-status`,
                "aria-invalid": quote.status === "error" || over,
                value: amount,
                disabled: disabled || busy,
                onChange: (e) => onAmount(e.target.value),
              }}
              trailing={<TokenPill>USDC</TokenPill>}
            />
            <div className="my-3 flex gap-2">
              {([0.25, 0.5, 1] as const).map((f) => (
                <button key={f} type="button" className={pctChip} disabled={bal == null || disabled || busy} onClick={() => fraction(f)}>
                  {f === 1 ? t("trade.max") : `${f * 100}%`}
                </button>
              ))}
            </div>

            <div className="grid gap-[10px]">
              <QuoteLine label={t("trade.youReceiveEst")} value={q ? `≈ ${tokens(q.tokensOut)} ${tk.symbol}` : "—"} />
              <QuoteLine label={t("xbuy.payBound")} value={q ? `${q.pay.amountFormatted} ${q.pay.currency?.symbol ?? "USDC"}` : "—"} muted />
              <QuoteLine label={t("xbuy.arrives", { home })} value={q ? `${q.deliveredFormatted} ${tk.quoteSymbol}` : "—"} muted />
              <QuoteLine label={t("xbuy.relayFee")} value={q?.relayFee ? feeText(q.relayFee) : "—"} muted />
              <QuoteLine label={t("xbuy.originGas", { chain })} value={q?.originGas ? feeText(q.originGas) : "—"} muted />
              <QuoteLine label={t("xbuy.eta")} value={q?.etaSeconds != null ? t("xbuy.etaSeconds", { s: q.etaSeconds }) : "—"} muted />
              <QuoteLine label={t("xbuy.minOut", { p: bps / 100 })} value={q ? `${tokens(q.minTokensOut)} ${tk.symbol}` : "—"} />
            </div>

            <p id={`${inputId}-status`} role="status" className={`my-2 flex min-h-5 items-center gap-2 text-[12.5px] leading-[1.6] ${busy || quote.status === "quoting" ? "text-muted" : "text-neg"}`}>
              {statusText}
            </p>

            {!authenticated ? (
              <PrimaryButton type="button" onClick={login} disabled={disabled}>
                {t("trade.connect")}
              </PrimaryButton>
            ) : (
              <PrimaryButton type="submit" disabled={disabled || busy || !q || over || !identityOk}>
                {busy && <Spinner size={14} />} {t("xbuy.buy", { chain })}
              </PrimaryButton>
            )}
            <p className="mt-3 text-[11px] leading-[1.7] text-ink-3">{t("xbuy.note", { home, chain })}</p>
          </form>

          {outcome && (
            <div
              role="status"
              className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-[12.5px] leading-[1.7] ${
                outcome.kind === "filled" ? "bg-[rgba(108,199,154,.13)] text-pos" : outcome.kind === "pending" ? "bg-[rgba(106,208,224,.1)] text-ink-2" : "bg-[rgba(240,102,90,.12)] text-neg"
              }`}
            >
              {outcome.kind === "filled" && <Check size={14} strokeWidth={2} aria-hidden="true" className="mt-1 flex-none" />}
              <span className="min-w-0">
                {outcome.text}
                {outcome.destinationTxHash && (
                  <>
                    {" "}
                    <Link href={`/tx/${outcome.destinationTxHash}`} className="underline">
                      {t("xbuy.track")}
                    </Link>
                  </>
                )}
                {outcome.originTxHash && origin && (
                  <>
                    {" "}
                    <a href={originExplorerTx(origin, outcome.originTxHash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                      {t("xbuy.originTx", { chain })} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                    </a>
                  </>
                )}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
