"use client";

// Creator tools on your own profile: where each launch's creator fees go, and
// the way to hand that to another address. The factory lets only the current
// fee recipient transfer it (transferCreatorFeeRecipient), so a creator whose
// recipient is a different wallet sees that, not a button that would revert.
import { useEffect, useState } from "react";
import { isAddress, parseAbi, type Address, type Hex } from "viem";
import { useT } from "@/components/LangProvider";
import { AssetLogo } from "@/components/ui/AssetLogo";
import { OutlineButton, Panel, SectionHead } from "@/components/ui/primitives";
import { Note, Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import { publicClient, arcTestnet, RADIAN, type LaunchRow } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { waitReceipt, ReceiptTimeout } from "@/lib/pendingTx";
import { recordTx } from "@/lib/txLog";
import { txErrorText } from "@/lib/txError";
import { resizeLogo, uploadLogo } from "@/lib/wall";
import { shortAddr } from "@/lib/ui/format";

const recipientAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists))",
  "function transferCreatorFeeRecipient(address token, address newRecipient)",
]);

export function CreatorTools({ mine, onPending, onChanged }: { mine: LaunchRow[]; onPending: (h: Hex) => void; onChanged?: () => void }) {
  const t = useT();
  const { address, getWalletClient } = useRadianWallet();
  const [recipients, setRecipients] = useState<Record<string, Address>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ token: string; text: string; error: boolean } | null>(null);

  const load = async () => {
    if (!mine.length) return;
    try {
      const res = await publicClient.multicall({ allowFailure: true, contracts: mine.map((r) => ({ address: RADIAN.factory, abi: recipientAbi, functionName: "getLaunchedToken" as const, args: [r.token] as const })) });
      const out: Record<string, Address> = {};
      mine.forEach((r, i) => {
        const v = res[i]?.status === "success" ? (res[i].result as { creatorFeeRecipient: Address }) : null;
        if (v) out[r.token.toLowerCase()] = v.creatorFeeRecipient;
      });
      setRecipients(out);
    } catch {}
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.map((r) => r.token).join(",")]);

  const save = async (token: Address) => {
    if (!isAddress(next)) return;
    setBusy(token);
    setMsg(null);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error(t("create.noWallet"));
      setMsg({ token, text: t("profile.recipientConfirm"), error: false });
      const h = await wc.client.writeContract({ account: wc.account, chain: arcTestnet, address: RADIAN.factory, abi: recipientAbi, functionName: "transferCreatorFeeRecipient", args: [token, next as Address] });
      await waitReceipt(h, "claim", { token, what: "recipient" });
      recordTx(wc.account, { hash: h, kind: "claim", token, time: Date.now() });
      setMsg({ token, text: t("profile.recipientDone"), error: false });
      setEditing(null);
      setNext("");
      await load();
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        onPending(e.hash);
        setMsg({ token, text: t("trade.pending"), error: false });
      } else {
        setMsg({ token, text: txErrorText(t, e, { fallback: t("create.failed") }), error: true });
      }
    } finally {
      setBusy(null);
    }
  };

  const [logoBusy, setLogoBusy] = useState<string | null>(null);
  const [logoMsg, setLogoMsg] = useState<{ token: string; text: string; error: boolean } | null>(null);
  const pickLogo = async (token: Address, file: File | undefined) => {
    if (!file) return;
    setLogoBusy(token);
    setLogoMsg(null);
    try {
      const dataUrl = await resizeLogo(file);
      const wc = await getWalletClient();
      if (!wc) throw new Error(t("create.noWallet"));
      const r = await uploadLogo(token, dataUrl, wc);
      if (r.ok) {
        setLogoMsg({ token, text: t("logo.saved"), error: false });
        onChanged?.();
      } else setLogoMsg({ token, text: t(r.reason === "rejected" ? "hw.errRejected" : r.reason === "creator" ? "logo.errCreator" : r.reason === "too-large" ? "logo.errSize" : "hw.errNetwork"), error: true });
    } catch {
      setLogoMsg({ token, text: t("logo.errDecode"), error: true });
    } finally {
      setLogoBusy(null);
    }
  };

  if (!mine.length || !address) return null;
  return (
    <Panel>
      <SectionHead title={t("profile.creatorTools")} />
      <Note className="-mt-3 mb-3">{t("profile.recipientNote")}</Note>
      <ul className="divide-y divide-stroke">
        {mine.map((r) => {
          const rec = recipients[r.token.toLowerCase()];
          const isRecipient = !!rec && rec.toLowerCase() === address.toLowerCase();
          const open = editing === r.token;
          return (
            <li key={r.token} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <AssetLogo symbol={r.symbol} src={/^https?:\/\//.test(r.logo) ? r.logo : null} seed={r.token} size={30} radius={15} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[14px] text-ink">${r.symbol}</b>
                  <span className="tnum font-mono text-[12px] text-ink-3">{rec ? shortAddr(rec) : "—"}</span>
                </span>
                {rec && !open && isRecipient && (
                  <OutlineButton type="button" onClick={() => { setEditing(r.token); setNext(""); setMsg(null); }} disabled={busy !== null}>
                    {t("profile.recipientChange")}
                  </OutlineButton>
                )}
              </div>
              {rec && !isRecipient && <Note className="mt-1.5">{t("profile.recipientNotYou")}</Note>}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="mono-label text-[10px] tracking-[.12em] text-ink-3">{t("logo.label")}</span>
                <label className={`mono-label cursor-pointer rounded-[10px] border border-brand/50 px-3 py-1.5 text-[10.5px] tracking-[.12em] text-brand hover:bg-glass-2 ${logoBusy ? "pointer-events-none opacity-50" : ""}`}>
                  {logoBusy === r.token ? <Spinner size={12} /> : /^https?:\/\//.test(r.logo) ? t("logo.change") : t("logo.pick")}
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="sr-only" disabled={logoBusy !== null} onChange={(e) => void pickLogo(r.token, e.target.files?.[0])} />
                </label>
                <Note className="min-w-0 flex-1">{t("logo.note")}</Note>
              </div>
              {logoMsg && logoMsg.token === r.token && <Note tone={logoMsg.error ? "neg" : undefined} className="mt-1.5">{logoMsg.text}</Note>}
              {open && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input value={next} onChange={(e) => setNext(e.target.value.trim())} placeholder="0x…" aria-label={t("profile.recipient")} className={`${INPUT_CLASS} min-w-0 flex-1 py-2 font-mono text-[12.5px]`} />
                  <OutlineButton type="button" disabled={busy !== null || !isAddress(next)} onClick={() => save(r.token)}>
                    {busy === r.token ? <Spinner /> : t("profile.recipientSave")}
                  </OutlineButton>
                  <OutlineButton type="button" onClick={() => setEditing(null)} disabled={busy !== null}>
                    {t("profile.recipientCancel")}
                  </OutlineButton>
                </div>
              )}
              {msg && msg.token === r.token && <Note tone={msg.error ? "neg" : undefined} className="mt-1.5">{msg.text}</Note>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
