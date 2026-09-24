"use client";

// Edit your own profile on your creator page: name, bio, X handle. Collapsed to one pill;
// opening re-seeds the form from the saved profile; "Sign & save" asks the wallet for a
// signature (free) and the indexer verifies it. Closes itself after a save.
import { useState } from "react";
import { useT } from "@/components/LangProvider";
import { Spinner } from "@/components/ui/rows";
import { INPUT_CLASS } from "@/components/create/Field";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { cleanProfile, saveProfile, PROFILE_LIMITS, type Profile } from "@/lib/profile";

export function ProfileEditor({ profile }: { profile: Profile | null }) {
  const t = useT();
  const { getWalletClient } = useRadianWallet();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile?.name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [x, setX] = useState(profile?.x ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const start = () => {
    setName(profile?.name ?? "");
    setBio(profile?.bio ?? "");
    setX(profile?.x ?? "");
    setMsg(null);
    setOpen(true);
  };

  const save = async () => {
    if (!cleanProfile({ name, bio, x })) return setMsg({ text: t("profile.invalid"), error: true });
    setBusy(true);
    setMsg(null);
    try {
      const wc = await getWalletClient();
      if (!wc) throw new Error("wallet");
      const r = await saveProfile(wc, { name, bio, x });
      if (r.ok) {
        setMsg({ text: t("profile.saved"), error: false });
        setOpen(false);
      } else setMsg({ text: r.reason === "rejected" ? t("hw.errRejected") : r.reason === "bad-input" ? t("profile.invalid") : t("profile.notSaved", { r: r.reason }), error: true });
    } catch {
      setMsg({ text: t("hw.errNetwork"), error: true });
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <span className="inline-flex flex-col items-center gap-1">
        <button type="button" onClick={start} className="mono-label rounded-full border border-brand/50 px-3 py-1 text-[11px] text-brand hover:bg-glass-2">
          {t("profile.edit")}
        </button>
        {msg && (
          <span role="status" className={`text-[12px] ${msg.error ? "text-neg" : "text-pos"}`}>
            {msg.text}
          </span>
        )}
      </span>
    );

  return (
    <form
      className="mt-2 grid w-full max-w-[420px] gap-2 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="grid gap-1 text-[11px] text-ink-3">
        {t("profile.name")}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={PROFILE_LIMITS.NAME} placeholder={t("profile.namePh")} className={`${INPUT_CLASS} py-2 text-[13.5px]`} />
      </label>
      <label className="grid gap-1 text-[11px] text-ink-3">
        {t("profile.bio")}
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={PROFILE_LIMITS.BIO} rows={2} placeholder={t("profile.bioPh")} className={`${INPUT_CLASS} resize-none py-2 text-[13.5px]`} />
      </label>
      <label className="grid gap-1 text-[11px] text-ink-3">
        {t("profile.x")}
        <input value={x} onChange={(e) => setX(e.target.value)} maxLength={PROFILE_LIMITS.X + 1} placeholder="@" className={`${INPUT_CLASS} py-2 font-mono text-[13px]`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="grad-fill inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-[550] disabled:opacity-50">
          {busy && <Spinner size={14} />} {t("profile.save")}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-[12.5px] text-ink-3 hover:text-ink">
          {t("profile.cancel")}
        </button>
        <span className="text-[11px] text-ink-3">{t("profile.free")}</span>
      </div>
      {msg && (
        <p role="status" className={`text-[12px] ${msg.error ? "text-neg" : "text-pos"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
