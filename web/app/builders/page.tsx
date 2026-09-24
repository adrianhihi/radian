"use client";

// Builders, on baskvia's /integrate skeleton: head · three numbers · three
// steps with code · the unsigned plans · before you ship · addresses · for your
// risk team · verify. Copy in lib/content/integrate.ts; addresses from the
// network config; snippets built from them so they are correct as pasted.
import { ArrowDown, ArrowRight, Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/shell/Shell";
import { useLang } from "@/components/LangProvider";
import { Footer } from "@/components/ui/primitives";
import { INTEGRATE } from "@/lib/content/integrate";
import { useNetwork } from "@/lib/networks";

const ZERO = "0x0000000000000000000000000000000000000000";

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-3 overflow-hidden rounded-[12px] border border-stroke bg-[rgba(0,0,0,.25)]">
      <div className="flex items-center justify-between border-b border-stroke px-3 py-1.5">
        <span className="mono-label text-[9.5px] tracking-[.14em] text-ink-3">{label}</span>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(code).then(
              () => {
                setDone(true);
                setTimeout(() => setDone(false), 1400);
              },
              () => {},
            )
          }
          className="mono-label inline-flex items-center gap-1 text-[9.5px] tracking-[.12em] text-ink-3 hover:text-brand"
        >
          {done ? <Check size={11} strokeWidth={2} aria-hidden="true" /> : <Copy size={11} strokeWidth={1.8} aria-hidden="true" />} Copy
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-[1.7] text-ink-2">{code}</pre>
    </div>
  );
}

export default function BuildersPage() {
  const { lang } = useLang();
  const net = useNetwork();
  const c = INTEGRATE[lang] ?? INTEGRATE.en;
  const api = net.indexerUrl || "https://<indexer>";
  const has = (a?: string) => !!a && a !== ZERO;

  const CODE = [
    `// Every launch on ${net.chainName}, with curve, pair token, template and 24h facts
GET ${api}/launches
// One launch, block-consistent (every read at one block)
GET ${api}/v1/curve/<token>
// What the API knows about itself: contracts, identity hashes, services
GET ${api}/v1/manifest`,
    `// Quote a buy of 10 units of the quote asset (raw units) for <recipient>, 1% slippage
GET ${api}/v1/quote?token=<token>&side=buy&amount=10000000&recipient=<addr>&slippageBps=100
// → { out, minOut, fee, price: { method: "simulation" | "reserves" },
//     plan: { to, data, value, approve? } }   // unsigned; aimed at the router or the PoF router`,
    `// RadianLaunchRouter on ${net.chainName}: ${has(net.contracts.router) ? net.contracts.router : "not deployed here"}
function buy(address token, uint256 quoteIn, uint256 minTokensOut, address recipient, address referrer) payable
function sell(address token, uint256 tokensIn, uint256 minQuoteOut, address recipient, address referrer)
// referrer = YOUR address → 5.55% of the fee credits you in the PoundVault, claimable any time after settlement
// minTokensOut / minQuoteOut are enforced by the curve: never pass 0 for a user`,
  ];
  const PLAN = [
    `POST ${api}/v1/launch-plan
{ "template": "standard" | "wall" | "pof", "creator": "<addr>", "pairToken": "<quote or 0x0>",
  "buyAmount": "<raw>", "minTokensOut": "0", "launchConfigId": "0",
  "params": { "name", "symbol", "logo", "description", "socials": {...}, "salt": "<bytes32>",
              "creatorFeeRecipient"?, "creatorTaxBps"?, "buybackEnabled"? },
  "cfg"?: { ...wall or pof settings } }
// → { to, data, value, launchFee, approve?, predicted: { treasury, staking } | { vault } | null }`,
    `POST ${api}/v1/auth   // a signed EIP-712 BuyAuth for the RadianExecutor
{ "auth": { user, token, asset, amountPerBuy, minTokensPerQuote, interval, count, maxGasPrice, deadline, nonce }, "signature": "0x…" }
GET  ${api}/v1/auth/<user>   // the user's active authorizations and how many buys ran`,
  ];

  const rows = c.addrRows.map((r) => {
    const a =
      r.key === "factory" ? net.contracts.factory
      : r.key === "router" ? net.contracts.router
      : r.key === "pofRouter" ? net.contracts.pofRouter
      : r.key === "executor" ? net.contracts.executor
      : r.key === "vault" ? net.pound?.vault
      : r.key === "burner" ? net.pound?.burner
      : net.indexerUrl;
    return { ...r, value: a && a !== ZERO ? a : null };
  });

  return (
    <Shell>
      <div className="screen-in">
        <header className="pt-6 text-center">
          <p className="mono-label text-[10.5px] tracking-[.2em] text-ink-3">{c.eyebrow}</p>
          <h1 className="mt-5 text-[clamp(38px,7vw,84px)] font-bold uppercase leading-[.95] tracking-[-2px] text-ink">
            {c.title[0]}
            <br />
            <span className="bg-[image:var(--brand-grad)] bg-clip-text text-transparent">{c.title[1]}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[58ch] text-[16px] leading-[1.65] text-ink-2">{c.sub}</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="#steps" className="grad-fill mono-label inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[11px] font-semibold tracking-[.14em]">
              {c.steps} <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
            </a>
            <Link href="/docs" className="mono-label rounded-full border border-stroke-2 px-5 py-2.5 text-[11px] tracking-[.14em] text-ink-2 hover:border-brand hover:text-brand">
              {c.learn}
            </Link>
          </div>
        </header>

        <section className="mx-auto mt-10 grid max-w-[980px] gap-4 min-[720px]:grid-cols-3">
          {c.stats.map(([big, h, p]) => (
            <div key={h} className="glass-panel rounded-2xl p-5 text-center">
              <div className="tnum text-[34px] font-bold text-ink">{big}</div>
              <div className="mono-label mt-1 text-[10.5px] tracking-[.16em] text-brand">{h}</div>
              <p className="mt-2 text-[13px] leading-[1.6] text-muted">{p}</p>
            </div>
          ))}
        </section>

        <section id="steps" aria-labelledby="int-steps" className="mx-auto mt-14 max-w-[980px] scroll-mt-24">
          <h2 id="int-steps" className="text-[clamp(26px,3.6vw,40px)] font-bold uppercase tracking-[-.5px] text-ink">
            {c.stepsTitle}
          </h2>
          <p className="mono-label mt-2 text-[10.5px] tracking-[.14em] text-brand">{c.stepsSub}</p>
          <ol className="mt-6 grid gap-4">
            {c.step.map((s, i) => (
              <li key={s.h} className="glass-panel rounded-2xl p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full border border-brand/60 text-[13px] text-brand">{i + 1}</span>
                  <h3 className="text-[18px] font-bold uppercase text-ink">{s.h}</h3>
                </div>
                <p className="mt-3 text-[13.5px] leading-[1.7] text-muted">{s.body}</p>
                <CodeBlock code={CODE[i]} label={s.label} />
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="int-plans" className="mx-auto mt-14 max-w-[980px]">
          <h2 id="int-plans" className="text-[22px] font-bold uppercase text-ink">
            {c.plansTitle}
          </h2>
          <div className="mt-4 grid gap-4 nav:grid-cols-2">
            {c.plans.map((s, i) => (
              <div key={s.h} className="glass-panel rounded-2xl p-5">
                <h3 className="text-[15px] font-semibold text-ink">{s.h}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.7] text-muted">{s.body}</p>
                <CodeBlock code={PLAN[i]} label={s.label} />
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="int-ship" className="mx-auto mt-14 max-w-[980px]">
          <h2 id="int-ship" className="text-[22px] font-bold uppercase text-ink">
            {c.shipTitle}
          </h2>
          <div className="mt-4 grid gap-3 min-[720px]:grid-cols-2">
            {c.ship.map(([h, p]) => (
              <div key={h} className="rounded-[14px] border border-stroke p-4">
                <h3 className="text-[14.5px] font-semibold text-ink">{h}</h3>
                <p className="mt-1.5 text-[13px] leading-[1.7] text-muted">{p}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="int-addr" className="mx-auto mt-14 max-w-[980px]">
          <h2 id="int-addr" className="text-[22px] font-bold uppercase text-ink">
            {c.addrTitle} · {net.chainName}
          </h2>
          <p className="mt-2 text-[13px] leading-[1.7] text-muted">{c.addrNote}</p>
          <div className="mt-4 overflow-x-auto rounded-[14px] border border-stroke">
            <table className="w-full text-left text-[13px]">
              <tbody className="divide-y divide-stroke">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-ink-2">
                      {r.label}
                      <span className="block text-[11px] font-normal text-ink-3">{r.note}</span>
                    </th>
                    <td className="px-4 py-3">
                      {r.value ? (
                        <a href={r.key === "indexer" ? r.value : `${net.explorer}/address/${r.value}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[12px] text-brand hover:underline">
                          {r.value}
                        </a>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.value ? (
                        <span className="mono-label rounded border border-pos/40 px-1.5 py-0.5 text-[9.5px] tracking-[.12em] text-pos">{c.live}</span>
                      ) : (
                        <span className="mono-label rounded border border-stroke px-1.5 py-0.5 text-[9.5px] tracking-[.12em] text-ink-3">{c.notHere}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mx-auto mt-14 grid max-w-[980px] gap-4 min-[720px]:grid-cols-2">
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="text-[18px] font-bold uppercase text-ink">{c.riskTitle}</h2>
            <ul className="mt-3 grid gap-2 text-[13px] leading-[1.6] text-muted">
              {c.risk.map((r) => (
                <li key={r} className="flex gap-2">
                  <Check size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 flex-none text-pos" />
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="text-[18px] font-bold uppercase text-ink">{c.verifyTitle}</h2>
            <p className="mt-3 text-[13px] leading-[1.7] text-muted">{c.verifyBody}</p>
            <Link href="/verify" className="mono-label mt-4 inline-flex items-center gap-1.5 text-[10.5px] tracking-[.14em] text-brand hover:underline">
              {c.verifyCta} <ArrowRight size={11} strokeWidth={1.8} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <Footer />
      </div>
    </Shell>
  );
}
