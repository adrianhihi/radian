"use client";

// Verify, on baskvia's /verify skeleton: everything a careful person needs to
// check that this site talks to the contracts it claims to, without trusting
// the site. Full addresses (same-named fakes exist), pinned runtime code hashes
// with the live re-check, the other addresses, how to reproduce the bytecode,
// and the numbers that must not be combined.
import { Check, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Footer, Panel } from "@/components/ui/primitives";
import { useNetwork } from "@/lib/networks";
import { useIdentity, pinnedContracts } from "@/lib/identity";
import { parseAbi } from "viem";
import { publicClient, RADIAN } from "@/lib/radian";
import { fingerprint } from "@/lib/ui/fingerprint";

const CODE_HASH_CMD = "cast keccak $(cast code <address> --rpc-url <rpc>)";

export default function VerifyPage() {
  const t = useT();
  const net = useNetwork();
  const identity = useIdentity();
  const [pinned, setPinned] = useState<ReturnType<typeof pinnedContracts>>([]);
  useEffect(() => setPinned(pinnedContracts()), [net.key]);
  const byName = new Map(identity.results.map((r) => [r.name, r]));
  // who owns the factory today, read live (a Safe on mainnet)
  const [owner, setOwner] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    publicClient
      .readContract({ address: RADIAN.factory, abi: parseAbi(["function owner() view returns (address)"]), functionName: "owner" })
      .then((o) => alive && setOwner(o as string))
      .catch(() => alive && setOwner(null));
    return () => {
      alive = false;
    };
  }, [net.key]);
  // the pinned contracts by purpose, in a fixed order
  const groupOf = (name: string): "pound" | "templates" | "radian" | "core" =>
    /pound|pack/i.test(name) ? "pound" : /wall|pof|executor/i.test(name) ? "templates" : /radian|staking|treasury/i.test(name) ? "radian" : "core";
  const groups = (["core", "templates", "pound", "radian"] as const).map((g) => ({ g, rows: pinned.filter((e) => groupOf(e.name) === g) })).filter((x) => x.rows.length > 0);
  const groupLabel = { core: t("verify.groupCore"), templates: t("verify.groupTemplates"), pound: t("verify.groupPound"), radian: t("verify.groupRadian") } as const;

  const others: { name: string; address: string; note: string }[] = [
    ...(net.radian.token !== "0x0000000000000000000000000000000000000000" ? [{ name: t("verify.radianToken"), address: net.radian.token, note: t("verify.radianTokenNote") }, { name: t("verify.radianCurve"), address: net.radian.curve, note: t("verify.radianCurveNote") }] : []),
    ...net.quoteAssets.filter((q) => !q.native).map((q) => ({ name: t("verify.quoteAsset", { sym: q.symbol }), address: q.address, note: q.stock?.standIn ? t("verify.standIn") : q.blurb })),
  ];
  const overall = !identity.checked ? "unverified" : identity.results.every((r) => r.ok) ? "match" : "mismatch";

  return (
    <Shell>
      <div className="screen-in mx-auto max-w-[900px]">
        <p className="mono-label mt-6 text-[10.5px] tracking-[.2em] text-ink-3">{t("verify.eyebrow")}</p>
        <h1 className="mt-2 text-[clamp(30px,4.6vw,46px)] font-bold leading-[1.1] tracking-[-1px] text-ink">{t("verify.title")}</h1>
        <p className="mt-4 max-w-[70ch] text-[14.5px] leading-[1.75] text-muted">{t("verify.intro", { chain: net.label, id: net.chainId })}</p>

        <div className="mt-8 grid gap-5">
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[20px] font-bold text-ink">{t("verify.pinnedTitle")}</h2>
              <span className={`mono-label inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] tracking-[.12em] ${overall === "match" ? "border-pos/50 text-pos" : overall === "mismatch" ? "border-neg/60 text-neg" : "border-stroke text-ink-3"}`}>
                {overall === "match" ? <Check size={11} strokeWidth={2.2} aria-hidden="true" /> : overall === "mismatch" ? <X size={11} strokeWidth={2.2} aria-hidden="true" /> : null}
                {overall === "match" ? t("verify.allMatch") : overall === "mismatch" ? t("verify.someMismatch") : t("verify.checking")}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-ink-3">{t("verify.pinnedSub")}</p>
            {pinned.length === 0 ? (
              <p className="mt-4 text-[13px] text-muted">{t("verify.nothingPinned")}</p>
            ) : (
              groups.map(({ g, rows }) => (
              <div key={g} className="mt-4">
              <h3 className="mono-label text-[10px] tracking-[.16em] text-ink-3">{groupLabel[g]}</h3>
              <ul className="divide-y divide-stroke">
                {rows.map((e) => {
                  const r = byName.get(e.name);
                  const status = !identity.checked ? "unverified" : r?.ok ? "match" : "mismatch";
                  return (
                    <li key={e.name} className="grid gap-2 py-3.5 min-[720px]:grid-cols-[200px_minmax(0,1fr)] min-[720px]:items-start">
                      <div>
                        <div className="mono-label text-[10.5px] tracking-[.14em] text-ink-2">{e.name}</div>
                        <span className={`mono-label mt-1.5 inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[9.5px] tracking-[.12em] ${status === "match" ? "border-pos/40 text-pos" : status === "mismatch" ? "border-neg/60 text-neg" : "border-stroke text-ink-3"}`}>
                          {status === "match" && <Check size={11} strokeWidth={2.2} aria-hidden="true" />}
                          {status === "mismatch" && <X size={11} strokeWidth={2.2} aria-hidden="true" />}
                          {status === "match" ? t("verify.match") : status === "mismatch" ? t("verify.mismatch") : t("verify.unverified")}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="mono-label mb-1.5 inline-block rounded-full border border-brand/40 bg-glass-2 px-2.5 py-0.5 text-[10.5px] tracking-[.1em] text-brand" title={t("verify.fingerprintNote")}>
                          {fingerprint(e.address)}
                        </span>
                        <br />
                        <a href={`${net.explorer}/address/${e.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-[12px] text-ink-2 hover:text-brand">
                          {e.address} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" className="flex-none" />
                        </a>
                        <div className="mt-1 break-all font-mono text-[11px] text-ink-3">{e.expected}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              </div>
              ))
            )}
            {identity.error && <p className="mt-3 text-[12.5px] text-neg">{t("verify.liveFailed", { err: identity.error })}</p>}
            <p className="mt-4 text-[12.5px] leading-[1.7] text-ink-3">
              {t("verify.reproduceHash")} <code className="rounded border border-stroke-2 bg-glass-2 px-1.5 py-px font-mono text-[11px] text-ink-2">{CODE_HASH_CMD}</code> · RPC <code className="rounded border border-stroke-2 bg-glass-2 px-1.5 py-px font-mono text-[11px] text-ink-2">{net.rpc}</code>
            </p>
          </Panel>

          <Panel>
            <h2 className="text-[20px] font-bold text-ink">{t("verify.othersTitle")}</h2>
            <p className="mt-1 text-[12.5px] leading-[1.6] text-ink-3">{t("verify.othersSub")}</p>
            <ul className="mt-4 divide-y divide-stroke">
              {others.map((o) => (
                <li key={o.name + o.address} className="grid gap-2 py-3.5 min-[720px]:grid-cols-[200px_minmax(0,1fr)]">
                  <div>
                    <div className="mono-label text-[10.5px] tracking-[.14em] text-ink-2">{o.name}</div>
                    <div className="mt-1 text-[11.5px] text-ink-3">{o.note}</div>
                  </div>
                  <div className="min-w-0">
                    <span className="mono-label mb-1.5 inline-block rounded-full border border-brand/40 bg-glass-2 px-2.5 py-0.5 text-[10.5px] tracking-[.1em] text-brand" title={t("verify.fingerprintNote")}>
                      {fingerprint(o.address)}
                    </span>
                    <br />
                    <a href={`${net.explorer}/address/${o.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-[12px] text-ink-2 hover:text-brand">
                      {o.address} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" className="flex-none" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12.5px] leading-[1.7] text-ink-3">{t("verify.curveNote")}</p>
          </Panel>

          <Panel>
            <h2 className="text-[20px] font-bold text-ink">{t("verify.ownerTitle")}</h2>
            <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("verify.ownerBody")}</p>
            <div className="mt-4 grid gap-2 py-1 min-[720px]:grid-cols-[200px_minmax(0,1fr)]">
              <div className="mono-label text-[10.5px] tracking-[.14em] text-ink-2">{t("verify.ownerLabel")}</div>
              <div className="min-w-0">
                {owner === undefined ? (
                  <span className="text-[12.5px] text-ink-3">{t("verify.ownerReading")}</span>
                ) : owner === null ? (
                  <span className="text-[12.5px] text-ink-3">—</span>
                ) : (
                  <>
                    <span className="mono-label mb-1.5 inline-block rounded-full border border-brand/40 bg-glass-2 px-2.5 py-0.5 text-[10.5px] tracking-[.1em] text-brand" title={t("verify.fingerprintNote")}>
                      {fingerprint(owner)}
                    </span>
                    <br />
                    <a href={`${net.explorer}/address/${owner}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all font-mono text-[12px] text-ink-2 hover:text-brand">
                      {owner} <ExternalLink size={11} strokeWidth={1.8} aria-hidden="true" className="flex-none" />
                    </a>
                  </>
                )}
              </div>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-[20px] font-bold text-ink">{t("verify.reproduceTitle")}</h2>
            <p className="mt-2 text-[13px] leading-[1.7] text-muted">{t("verify.reproduceBody")}</p>
            <pre className="mt-3 overflow-x-auto rounded-[12px] border border-stroke bg-[rgba(0,0,0,.25)] p-3 font-mono text-[12px] leading-[1.7] text-ink-2">{`git clone --recurse-submodules https://github.com/adrianhihi/radian && cd radian
forge build
# runtime code of a contract as compiled:
jq -r .deployedBytecode.object out/PonsV2LaunchFactory.sol/PonsV2LaunchFactory.json | cut -c1-80
# compare against what the chain runs (constructor immutables are embedded, so compare
# after deploy with the pinned hash above, or diff the code sections yourself):
cast code ${net.contracts.factory} --rpc-url ${net.rpc} | cut -c1-80`}</pre>
          </Panel>

          <Panel>
            <h2 className="text-[20px] font-bold text-ink">{t("verify.numbersTitle")}</h2>
            <ul className="mt-3 grid gap-2 text-[13px] leading-[1.7] text-muted">
              {(["verify.num1", "verify.num2", "verify.num3", "verify.num4", "verify.num5"] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1.5 flex-none rounded-full bg-brand" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </Panel>

          <p className="rounded-2xl border border-brand/40 bg-[rgba(232,148,76,.05)] px-5 py-4 text-[13.5px] leading-[1.75] text-ink-2">
            {t("verify.warn")}{" "}
            <Link href="/terms" className="text-brand hover:underline">
              {t("nav.terms")} →
            </Link>
          </p>
        </div>
        <Footer />
      </div>
    </Shell>
  );
}
