"use client";

// One transaction, resolved through the indexer (GET /tx/:hash) so this tab needs no RPC of its
// own: the hash with its explorer link, a status pill, the decoded events (launch, buy, sell,
// claim, settlement, burn) and, for a launch, the way to the token. Polls every 4 s until the
// transaction settles; a read that fails says so instead of showing "pending" forever.
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { formatUnits, isHash } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Empty, Footer, OutlineButton, OutlineLink, PageHead, Panel, SectionHead } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/rows";
import { fetchTxStatus, hasIndexer, type TxEvent, type TxStatusResult } from "@/lib/indexer";
import { useNetwork } from "@/lib/networks";
import { fmtNum, shortAddr } from "@/lib/ui/format";

const POLL_MS = 4000;
// An unsettled answer (pending, not found, unreadable) is re-read this many times — about three
// minutes — then the page stops and offers a manual check instead of polling a dead endpoint all day.
const MAX_UNSETTLED_POLLS = 45;

type Status = TxStatusResult["status"] | "reading" | "unreadable";

const isSettled = (d: TxStatusResult | null) => d?.status === "success" || d?.status === "reverted";
const big = (v?: string): bigint | null => {
  if (v == null) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
};

export default function TxPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const t = useT();
  const net = useNetwork();
  const valid = isHash(hash);
  const [data, setData] = useState<TxStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noIndex, setNoIndex] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [round, setRound] = useState(0); // "Check again" restarts the loop

  useEffect(() => {
    if (!valid) return;
    if (!hasIndexer()) {
      setNoIndex(true);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setStopped(false);
    const tick = async () => {
      let done = false;
      try {
        const d = await fetchTxStatus(hash);
        if (!alive) return;
        setData(d);
        setError(null);
        done = isSettled(d);
      } catch (e) {
        if (!alive) return;
        setError((e as Error)?.message ?? String(e));
      }
      if (done) return;
      attempts += 1;
      if (attempts >= MAX_UNSETTLED_POLLS) {
        setStopped(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [hash, valid, round]);

  const status: Status = error ? "unreadable" : data ? data.status : "reading";
  const LABEL: Record<Status, string> = {
    reading: t("txs.reading"),
    pending: t("txs.pending"),
    success: t("txs.success"),
    reverted: t("txs.reverted"),
    unknown: t("txs.unknown"),
    unreadable: t("txs.unreadable"),
  };
  const KIND: Record<string, string> = { launch: t("tx.launch"), buy: t("tx.buy"), sell: t("tx.sell"), claim: t("tx.claim"), flush: t("fly.evFlush"), settle: t("txs.evSettle"), burn: t("txs.evBurn") };
  const body =
    status === "pending" ? t("txs.pendingBody")
    : status === "unknown" ? t("txs.unknownBody")
    : status === "reverted" ? t("txs.revertedBody")
    : status === "unreadable" ? t("txs.unreadableBody", { err: error ?? "" })
    : null;
  const tokenLabel = (e: { token?: string; symbol?: string }) => (e.symbol ? `$${e.symbol}` : shortAddr(e.token));
  const amountOf = (e: TxEvent): string | null => {
    const a = e.amounts;
    if (!a) return null;
    const q = (v?: string) => {
      const b = big(v);
      return b == null ? null : `${fmtNum(Number(formatUnits(b, a.quoteDecimals ?? 18)), 4)} ${a.quoteSymbol ?? ""}`.trim();
    };
    const tk = (v?: string) => {
      const b = big(v);
      return b == null ? null : `${fmtNum(Number(formatUnits(b, 18)), 0)} ${e.symbol ?? ""}`.trim();
    };
    if (e.kind === "buy" || e.kind === "burn" || e.kind === "flush") return [q(a.quote), tk(a.tokens)].filter(Boolean).join(" → ") || null;
    if (e.kind === "sell") return [tk(a.tokens), q(a.quote)].filter(Boolean).join(" → ") || null;
    return q(a.amount);
  };
  const events = data?.events ?? [];
  const block = data?.blockNumber ? Number(data.blockNumber).toLocaleString("en-US") : null;

  return (
    <Shell>
      <div className="screen-in">
        <PageHead eyebrow={t("txs.eyebrow")} title={t("txs.title")} sub={t("txs.sub")} aside={<OutlineLink href="/activity">{t("activity.title")}</OutlineLink>} />
        <Panel>
          {!valid ? (
            <Empty>{t("txs.badHash")}</Empty>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {noIndex ? null : <StatusPill status={status} label={LABEL[status]} />}
                {block && (
                  <span className="tnum text-[12.5px] text-muted">
                    {data?.confirmations != null ? t("txs.block", { block, conf: data.confirmations }) : t("txs.blockOnly", { block })}
                  </span>
                )}
              </div>

              <div className="mt-4">
                <div className="mono-label text-[10px] tracking-[.12em] text-ink-3">{t("txs.hash")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="tnum break-all font-mono text-[12.5px] text-ink">{hash}</code>
                  <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] text-brand hover:underline">
                    {t("trust.viewTx")} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" />
                  </a>
                </div>
              </div>

              {(noIndex || body) && (
                <p role="status" className={`mt-4 text-[13px] leading-[1.7] ${status === "reverted" || status === "unreadable" ? "text-neg" : "text-muted"}`}>
                  {noIndex ? t("txs.noIndex") : body}
                </p>
              )}

              {stopped && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted">
                  <span>{t("txs.stopped")}</span>
                  <OutlineButton type="button" onClick={() => setRound((r) => r + 1)}>
                    {t("txs.retry")}
                  </OutlineButton>
                </div>
              )}

              {status === "success" && data?.token && (
                <div className="mt-5">
                  <OutlineLink href={`/token/${data.token.address}`}>{t("txs.openToken", { sym: tokenLabel({ token: data.token.address, symbol: data.token.symbol }) })}</OutlineLink>
                </div>
              )}

              {status === "success" && (
                <section className="mt-7">
                  <SectionHead title={t("txs.events")} />
                  {events.length === 0 ? (
                    <Empty>{t("txs.noEvents")}</Empty>
                  ) : (
                    <ul className="divide-y divide-stroke rounded-xl border border-stroke">
                      {events.map((e, i) => {
                        const amount = amountOf(e);
                        return (
                          <li key={i} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]">
                            <span className="min-w-32 flex-none font-semibold text-ink">
                              {KIND[e.kind] ?? e.kind}
                              {e.template && (
                                <span className="mono-label ml-2 rounded-full border border-stroke-2 px-2 py-0.5 text-[9.5px] tracking-[.1em] text-ink-2">
                                  {e.template === "wall" ? t("tcard.wall") : t("tcard.pof")}
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1 text-ink-2">
                              {e.token ? (
                                <Link href={`/token/${e.token}`} className="hover:text-brand">
                                  {tokenLabel(e)}
                                </Link>
                              ) : (
                                "—"
                              )}
                              {amount && <span className="tnum ml-2 text-ink-3">{amount}</span>}
                            </span>
                            {e.trader && <span className="tnum text-[12px] text-ink-3">{shortAddr(e.trader)}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </Panel>
        <Footer />
      </div>
    </Shell>
  );
}

/** The status as a pill: brand while it is still being read or mined, green / red once settled, plain when unknown or unreadable. */
function StatusPill({ status, label }: { status: Status; label: string }) {
  const busy = status === "pending" || status === "reading";
  const tone =
    status === "success" ? "border-pos/60 text-pos"
    : status === "reverted" ? "border-neg/60 text-neg"
    : busy ? "border-brand/60 text-brand"
    : "border-stroke-2 text-ink-2";
  return (
    <span role="status" className={`mono-label inline-flex items-center gap-2 rounded-full border bg-glass-2 px-3 py-1.5 text-[11px] tracking-[.12em] ${tone}`}>
      {busy && <Spinner size={11} />}
      {label}
    </span>
  );
}
