"use client";

// Compact buy: one card, two rows. Row one: quote pill · amount · MAX. Row two:
// token picker · estimate · Buy (or Sign in). Real transactions through the
// shared trade path (router v4 with the referral tag where The Pound runs).
import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { publicClient, erc20Abi, quoteByAddress, explorer, activeNetwork, type LaunchRow } from "@/lib/radian";
import { txErrorText } from "@/lib/txError";
import { recordTx } from "@/lib/txLog";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { useTrade, readCurveQuoteState, quoteBuy, type CurveQuoteState } from "@/lib/useTrade";
import { ReceiptTimeout } from "@/lib/pendingTx";

const SLIPPAGE_BPS = 100;

export function QuickBuy({ rows, token, onToken }: { rows: LaunchRow[]; token: string | null; onToken: (t: string) => void }) {
  const t = useT();
  const { address } = useRadianWallet();
  const { buy, authenticated, login, identityOk } = useTrade();
  const candidates = useMemo(() => rows.filter((r) => !r.graduated), [rows]);
  const row = candidates.find((r) => r.token === token) ?? candidates[0];
  const [amount, setAmount] = useState("");
  const [cs, setCs] = useState<CurveQuoteState | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: Hex } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const quote = row ? quoteByAddress(row.pairToken) : undefined;
  const native = quote?.native ?? row?.pairToken === "0x0000000000000000000000000000000000000000";
  const dec = row?.quoteDecimals ?? 18;

  // curve facts for the estimate, and the wallet's quote balance for MAX
  useEffect(() => {
    if (!row) return;
    let alive = true;
    const load = async () => {
      try {
        const s = await readCurveQuoteState(row.curve, address);
        if (alive) setCs(s);
      } catch {
        if (alive) setCs(null);
      }
      if (address) {
        try {
          const b = native ? await publicClient.getBalance({ address }) : ((await publicClient.readContract({ address: row.pairToken, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint);
          if (alive) setBalance(b);
        } catch {
          if (alive) setBalance(null);
        }
      }
    };
    load();
    const iv = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [row?.curve, row?.pairToken, address, native]);

  if (!row) return <p className="text-[13px] text-muted">{t("quick.noTokens")}</p>;

  let inWei = 0n;
  try {
    inWei = amount ? parseUnits(amount, dec) : 0n;
  } catch {
    inWei = 0n;
  }
  const q = cs && inWei > 0n ? quoteBuy(cs, inWei, SLIPPAGE_BPS) : null;
  const est = q ? Number(formatUnits(q.out, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }) : null;
  const invalid = !q || busy || !identityOk;
  const inputId = `quick-amount-${row.token.slice(2, 8)}`;
  const btn = "mono-label flex-none rounded-lg border border-stroke-2 px-3.5 py-2 text-[11px] tracking-[.1em] text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-40";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q) {
      setMsg({ ok: false, text: t("quick.needAmount") });
      return;
    }
    if (!identityOk) {
      setMsg({ ok: false, text: t("quick.identity") });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const hash = await buy({ token: row.token, curve: row.curve, pairToken: row.pairToken, native, template: row.template }, inWei, q.minOut, (s) => {
        setStatus(s === "approve" ? t("quick.approve", { sym: row.quoteSymbol }) : s === "confirm" ? t("quick.confirm") : s === "sent" ? t("quick.sent") : null);
      });
      if (address) recordTx(address, { hash, kind: "buy", token: row.token, amount: `${amount} ${row.quoteSymbol}`, time: Date.now() });
      setMsg({ ok: true, text: t("quick.bought", { v: est ?? "", sym: row.symbol }), hash });
      setAmount("");
    } catch (err: unknown) {
      if (err instanceof ReceiptTimeout) setMsg({ ok: true, text: t("quick.pending"), hash: err.hash });
      else setMsg({ ok: false, text: txErrorText(t, err, { gasSym: activeNetwork.nativeSymbol ?? "USDC", address: address ?? "" }) });
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <form noValidate onSubmit={submit}>
      <div className="rounded-xl border border-stroke-2 bg-[rgba(255,238,220,.04)] focus-within:border-brand">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <span className="mono-label flex-none rounded-full border border-stroke-2 bg-glass-2 px-2.5 py-1 text-[11px] text-ink">{row.quoteSymbol}</span>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            aria-label={t("quick.payAria")}
            aria-invalid={!!amount && !q}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tnum w-full min-w-0 border-0 bg-transparent text-right text-lg text-ink outline-none"
          />
          <button type="button" className="mono-label flex-none text-[10px] tracking-[.1em] text-muted hover:text-brand disabled:opacity-40" disabled={balance == null} onClick={() => balance != null && setAmount(formatUnits(native ? (balance * 95n) / 100n : balance, dec))}>
            {t("quick.max")}
          </button>
        </div>
        <div className="flex items-center gap-2.5 border-t border-stroke px-3 py-2.5">
          {candidates.length > 1 ? (
            <span className="relative flex-shrink-0">
              <select aria-label={t("quick.selectAria")} value={row.token} onChange={(e) => onToken(e.target.value)} className="mono-label appearance-none rounded-full border border-stroke-2 bg-glass-2 py-1.5 pl-3 pr-7 text-[11px] text-ink focus-visible:border-brand">
                {candidates.map((r) => (
                  <option key={r.token} value={r.token}>
                    {r.name} · {r.symbol}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
                <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
              </span>
            </span>
          ) : (
            <span className="mono-label flex-none rounded-full border border-stroke-2 bg-glass-2 px-2.5 py-1 text-[11px] text-ink">{row.symbol}</span>
          )}
          <span className="tnum ml-auto truncate text-sm text-muted" aria-live="polite">
            {est ? t("quick.est", { v: est, sym: row.symbol }) : "—"}
          </span>
          {authenticated ? (
            <button type="submit" className={btn} disabled={invalid}>
              {busy ? "…" : t("quick.buy")}
            </button>
          ) : (
            <button type="button" className={btn} onClick={login}>
              {t("quick.connect")}
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-[11px] text-ink-3">
        {balance != null && <span className="tnum">{t("quick.balance", { v: Number(formatUnits(balance, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 }), sym: row.quoteSymbol })}</span>}
        {q && <span className="tnum">{t("quick.minOut", { v: Number(formatUnits(q.minOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 }), sym: row.symbol })}</span>}
      </div>
      {status && (
        <p role="status" className="mt-2 text-[12.5px] leading-[1.6] text-muted">
          {status}
        </p>
      )}
      {msg && (
        <div role="status" className={`mt-2 rounded-lg p-2.5 text-[12.5px] leading-[1.6] ${msg.ok ? "bg-[rgba(108,199,154,.13)] text-pos" : "bg-[rgba(240,102,90,.12)] text-neg"}`}>
          {msg.text}
          {msg.hash && (
            <>
              {" "}
              <a href={explorer.tx(msg.hash)} target="_blank" rel="noreferrer" className="underline">
                {t("trade.viewTx")} ↗
              </a>
            </>
          )}
        </div>
      )}
    </form>
  );
}
