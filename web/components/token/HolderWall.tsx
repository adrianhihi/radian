"use client";

// The holder wall on the token page: holders sign a message (no gas) and the
// indexer stores it after checking the signature and that the signer holds the
// token right now. One line per wallet; a new post replaces the old one.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { useT } from "@/components/LangProvider";
import { AddressAvatar } from "@/components/ui/AddressAvatar";
import { Note, Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { fetchWall, postWall, WALL_MAX, type WallEntry } from "@/lib/wall";
import { ago, shortAddr } from "@/lib/ui/format";

const REASON: Record<string, string> = { holding: "hw.errHolding", signature: "hw.errSignature", stale: "hw.errStale", rejected: "hw.errRejected", empty: "hw.errEmpty", rate: "hw.errRate" };

export function HolderWall({ token, symbol, myTokens }: { token: Address; symbol: string; myTokens: bigint }) {
  const t = useT();
  const { authenticated, login, address, getWalletClient } = useRadianWallet();
  const [entries, setEntries] = useState<WallEntry[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    fetchWall(token)
      .then((e) => {
        setEntries(e);
        setNow(Date.now());
      })
      .catch(() => setEntries([]));
  }, [token]);
  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const holds = myTokens > 0n;
  const submit = async () => {
    if (!authenticated) return login();
    setBusy(true);
    setMsg(null);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error("wallet");
      const r = await postWall(token, text, wc);
      if (r.ok) {
        setText("");
        setMsg({ text: t("hw.posted"), error: false });
        load();
      } else {
        const key = REASON[r.reason];
        setMsg({ text: key ? t(key as "hw.errHolding") : t("hw.errNetwork"), error: true });
      }
    } catch {
      setMsg({ text: t("hw.errNetwork"), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("hw.title")} className="border-b border-stroke p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold uppercase tracking-[.06em] text-ink">{t("hw.title")}</h2>
        <span className="mono-label text-[10px] tracking-[.14em] text-ink-3">{t("hw.sub", { sym: symbol })}</span>
      </div>

      {entries === null ? (
        <p className="py-5 text-center">
          <Spinner size={18} />
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-stroke-2 px-4 py-5 text-center text-[13px] text-ink-3">{t("hw.empty", { sym: symbol })}</p>
      ) : (
        <ul className="mt-4 grid gap-2 nav:grid-cols-2">
          {entries.map((e) => (
            <li key={e.address} className="flex gap-3 rounded-[12px] border border-stroke bg-glass-2 p-3">
              <AddressAvatar address={e.address} size={32} />
              <span className="min-w-0 flex-1">
                <span className="mono-label flex items-center justify-between gap-2 text-[10px] tracking-[.08em] text-ink-3">
                  <Link href={`/profile/${e.address}`} className="hover:text-brand">
                    {shortAddr(e.address)}
                  </Link>
                  <span className="tnum">{ago(e.time, now)}</span>
                </span>
                <span className="mt-1 block break-words text-[13px] leading-[1.6] text-ink">{e.text}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-[12px] border border-stroke p-3">
        {!authenticated ? (
          <button type="button" onClick={login} className="mono-label text-[10.5px] tracking-[.12em] text-brand hover:underline">
            {t("hw.signIn", { sym: symbol })}
          </button>
        ) : !holds ? (
          <Note>{t("hw.needHold", { sym: symbol })}</Note>
        ) : (
          <>
            <label htmlFor={`wall-${token.slice(2, 8)}`} className="mono-label text-[10px] tracking-[.12em] text-ink-3">
              {t("hw.compose", { addr: shortAddr(address ?? "") })}
            </label>
            <textarea id={`wall-${token.slice(2, 8)}`} rows={2} maxLength={WALL_MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("hw.placeholder")} className={`${INPUT_CLASS} mt-1.5 text-[13px]`} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="tnum text-[11px] text-ink-3">
                {text.length}/{WALL_MAX}
              </span>
              <button type="button" disabled={busy || !text.trim()} onClick={submit} className="mono-label rounded-[10px] border border-brand/50 px-3 py-1.5 text-[10.5px] tracking-[.14em] text-brand transition-colors hover:bg-glass-2 disabled:border-stroke disabled:text-ink-3 disabled:opacity-60">
                {busy ? <Spinner size={12} /> : t("hw.post")}
              </button>
            </div>
            <Note className="mt-1.5">{t("hw.noGas")}</Note>
          </>
        )}
        {msg && (
          <p role="status" className={`mt-2 text-[12.5px] ${msg.error ? "text-neg" : "text-pos"}`}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}
