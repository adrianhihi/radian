"use client";

// The factory directory on the design system: what the one factory contract on
// this network is configured to do, what it has produced, and who holds which
// role. Everything is read live from the chain and the indexer; the copy is in
// lib/content/factory.ts.
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useLang } from "@/components/LangProvider";
import { DataTable, TD, TD_MONO, TD_NUM } from "@/components/ui/DataTable";
import { CondCell, CondGrid, Footer, OutlineButton, Panel, SectionHead } from "@/components/ui/primitives";
import { FACTORY, fill } from "@/lib/content/factory";
import { NETWORKS, setActiveNetwork, useNetwork } from "@/lib/networks";
import { useIdentity, pinnedContracts } from "@/lib/identity";
import { useLaunches } from "@/lib/useLaunches";
import { useFactoryState } from "@/lib/factory";
import { RADIAN, publicClient, type LaunchRow } from "@/lib/radian";
import { poundVaultAbi } from "@/lib/pound";
import { fmtAmount } from "@/lib/templates";
import { shortAddr } from "@/lib/ui/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const pct = (bps: number | null | undefined) => (bps == null ? "—" : `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export default function FactoryPage() {
  const { lang } = useLang();
  const c = FACTORY[lang] ?? FACTORY.en;
  const net = useNetwork();
  const { state, loading, error } = useFactoryState();
  const { rows } = useLaunches();
  const identity = useIdentity();
  const [pinned, setPinned] = useState<ReturnType<typeof pinnedContracts>>([]);
  useEffect(() => setPinned(pinnedContracts()), [net.key]);
  // The Pound's live split (the vault owner can move it between 50% and 100%)
  const [burnShare, setBurnShare] = useState<number | null>(null);
  useEffect(() => {
    if (!net.pound) return;
    publicClient.readContract({ address: net.pound.vault, abi: poundVaultAbi, functionName: "burnShareBps" }).then((v) => setBurnShare(Number(v))).catch(() => {});
  }, [net.key, net.pound]);

  const gas = net.nativeSymbol ?? "USDC";
  const addr = (a: string) => `${net.explorer}/address/${a}`;
  const byName = new Map(identity.results.map((r) => [r.name, r]));
  const identityOk = identity.checked && identity.results.length > 0 && identity.results.every((r) => r.ok);
  const total = rows.length;
  const graduated = rows.filter((r) => r.graduated).length;
  const walls = rows.filter((r) => r.template?.kind === "wall").length;
  const pofs = rows.filter((r) => r.template?.kind === "pof").length;
  const latest = rows.slice(0, 12);
  const countByQuote = (address: string) => rows.filter((r) => same(r.pairToken, address) || (address === ZERO && (!r.pairToken || r.pairToken === ZERO))).length;
  const others = Object.values(NETWORKS).filter((n) => n.live && !n.hidden && n.key !== net.key);
  const templateLabel = (r: LaunchRow) => (r.template?.kind === "wall" ? c.templates.items.wall[0] : r.template?.kind === "pof" ? c.templates.items.pof[0] : c.templates.items.standard[0]);

  const roles: { role: string; address: string | null | undefined; note: string; check?: boolean | null; expect?: string }[] = state
    ? [
        { role: c.roles.items.factoryOwner[0], address: state.factoryOwner, note: c.roles.items.factoryOwner[1] },
        { role: c.roles.items.hookOwner[0], address: state.hook.owner, note: c.roles.items.hookOwner[1] },
        net.pound
          ? { role: c.roles.items.recipientPound[0], address: state.hook.protocolFeeRecipient, note: c.roles.items.recipientPound[1], check: same(state.hook.protocolFeeRecipient, net.pound.vault), expect: c.roles.expectVault }
          : { role: c.roles.items.recipient[0], address: state.hook.protocolFeeRecipient, note: c.roles.items.recipient[1] },
        ...(net.pound ? [{ role: c.roles.items.burner[0], address: net.pound.burner, note: c.roles.items.burner[1] }] : []),
        { role: c.roles.items.forwarder[0], address: state.launchForwarder, note: c.roles.items.forwarder[1], check: state.launchForwarder ? same(state.launchForwarder, RADIAN.router) : null, expect: c.roles.expectRouter },
        { role: c.roles.items.sweep[0], address: state.hook.feeSweepOperator, note: c.roles.items.sweep[1] },
        { role: c.roles.items.routerKeeper[0], address: state.routerKeeper, note: c.roles.items.routerKeeper[1] },
        ...(net.pound ? [] : [{ role: c.roles.items.treasuryKeeper[0], address: state.treasuryKeeper, note: c.roles.items.treasuryKeeper[1] }]),
      ]
    : [];

  const rules: [string, string, string][] = state
    ? [
        [c.rules.rows.launchFee[0], state.launchFee == null ? "—" : `${fmtAmount(state.launchFee, 18, 6)} ${gas}`, c.rules.rows.launchFee[1]],
        [c.rules.rows.tradeFee[0], pct(state.hook.hookFeeBps), c.rules.rows.tradeFee[1]],
        [c.rules.rows.protocolShare[0], pct(state.hook.protocolFeeShareBps), c.rules.rows.protocolShare[1]],
        [c.rules.rows.buybackShare[0], pct(state.hook.buybackBurnBps), c.rules.rows.buybackShare[1]],
        ...(net.pound
          ? ([
              [c.rules.rows.referral[0], "5.55%", c.rules.rows.referral[1]],
              [c.rules.rows.launcherReferral[0], "5.55%", c.rules.rows.launcherReferral[1]],
              [c.rules.rows.packBurn[0], burnShare == null ? c.rules.packBurnMin : pct(burnShare), c.rules.rows.packBurn[1]],
            ] as [string, string, string][])
          : []),
        [c.rules.rows.maxTax[0], pct(state.maxCreatorTaxBps), c.rules.rows.maxTax[1]],
        [c.rules.rows.snipe[0], state.snipeTaxStartBps == null || state.snipeTaxSeconds == null ? "—" : fill(c.rules.snipeValue, { start: pct(state.snipeTaxStartBps), s: state.snipeTaxSeconds }), c.rules.rows.snipe[1]],
        [c.rules.rows.impact[0], pct(state.hook.maxInternalPriceImpactBps), c.rules.rows.impact[1]],
      ]
    : [];

  return (
    <Shell>
      <div className="screen-in">
        <p className="mono-label text-[10.5px] tracking-[.2em] text-brand">{c.eyebrow}</p>
        <h1 className="mt-3 text-[clamp(30px,4vw,42px)] font-[650] leading-[1.3] tracking-[-.5px] text-ink">{c.title}</h1>
        <p className="mt-2.5 max-w-[72ch] text-sm leading-[1.7] text-muted">{fill(c.intro, { chain: net.label, id: net.chainId })}</p>
        <p className="mt-2 text-[12.5px] text-ink-3">
          {c.factoryLabel}:{" "}
          <a href={addr(net.contracts.factory)} target="_blank" rel="noreferrer" className="break-all font-mono text-brand hover:underline">
            {net.contracts.factory}
          </a>
        </p>

        {!net.live && <p className="mt-6 text-[13px] text-muted">{c.notLive}</p>}
        {error && <p className="mt-6 text-[13px] text-neg">{fill(c.readError, { err: error })}</p>}
        {loading && net.live && <p className="mt-6 text-[13px] text-muted">{c.reading}</p>}

        {state && (
          <div className="mt-7 grid gap-5">
            <CondGrid className="mt-0">
              <CondCell label={c.cells.launches} value={state.launchEnabled == null ? "—" : state.launchEnabled ? c.cells.open : c.cells.closed} />
              <CondCell label={c.cells.launchFee} value={state.launchFee == null ? "—" : `${fmtAmount(state.launchFee, 18, 4)} ${gas}`} />
              <CondCell label={c.cells.tradeFee} value={pct(state.hook.hookFeeBps)} />
              <CondCell label={c.cells.protocolShare} value={pct(state.hook.protocolFeeShareBps)} />
            </CondGrid>

            <Panel>
              <SectionHead title={c.rules.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.rules.sub}</p>
              <DataTable head={c.rules.head}>
                {rules.map(([k, v, note]) => (
                  <tr key={k}>
                    <td className={`${TD} whitespace-nowrap text-ink`}>{k}</td>
                    <td className={`${TD} tnum whitespace-nowrap text-ink`}>{v}</td>
                    <td className={TD}>{note}</td>
                  </tr>
                ))}
              </DataTable>
            </Panel>

            <Panel>
              <SectionHead title={c.configs.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.configs.sub}</p>
              {state.configs.length === 0 ? (
                <p className="text-[13px] text-muted">{c.configs.none}</p>
              ) : (
                <DataTable head={c.configs.head} align={["left", "right", "right", "right", "right", "left", "right", "left"]}>
                  {state.configs.map((cfg) => (
                    <tr key={cfg.id}>
                      <td className={TD}>{cfg.id}</td>
                      <td className={TD_NUM}>{Number(formatUnits(cfg.supply, 18)).toLocaleString()}</td>
                      <td className={TD_NUM}>{pct(cfg.curveFeeBps)}</td>
                      <td className={TD_NUM}>
                        {fmtAmount(cfg.graduationThreshold, 18, 2)} {gas}
                      </td>
                      <td className={TD_NUM}>
                        {fmtAmount(cfg.phantomQuote, 18, 2)} {gas}
                      </td>
                      <td className={TD}>{cfg.poolFee === 0 ? c.configs.hookFee : `${(cfg.poolFee / 10_000).toFixed(2)}%`}</td>
                      <td className={TD_NUM}>{cfg.tickSpacing}</td>
                      <td className={`${TD} font-semibold ${cfg.enabled ? "text-pos" : "text-neg"}`}>{cfg.enabled ? c.configs.yes : c.configs.no}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <p className="mt-3 text-[12px] text-ink-3">{fill(c.configs.note, { gas })}</p>
            </Panel>

            <Panel>
              <SectionHead title={c.quotes.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.quotes.sub}</p>
              <DataTable head={c.quotes.head} align={["left", "left", "left", "right", "right", "right", "left"]}>
                {state.quotes.map((q) => (
                  <tr key={q.key}>
                    <td className={TD}>
                      <b className="text-ink">{q.symbol}</b>
                      <span className="block text-[11px] text-ink-3">{q.blurb}</span>
                    </td>
                    <td className={TD}>{q.native ? c.quotes.kinds.gas : q.stock ? (q.stock.standIn ? c.quotes.kinds.standIn : c.quotes.kinds.stock) : c.quotes.kinds.stable}</td>
                    <td className={`${TD} font-semibold ${q.approved ? "text-pos" : q.approved === false ? "text-neg" : ""}`}>{q.approved == null ? "—" : q.approved ? c.configs.yes : c.configs.no}</td>
                    <td className={TD_NUM}>{q.graduationThreshold == null ? "—" : `${fmtAmount(q.graduationThreshold, q.decimals, 2)} ${q.symbol}`}</td>
                    <td className={TD_NUM}>{q.phantomQuote == null ? "—" : `${fmtAmount(q.phantomQuote, q.decimals, 2)} ${q.symbol}`}</td>
                    <td className={TD_NUM}>{countByQuote(q.address)}</td>
                    <td className={TD_MONO}>
                      {q.native ? (
                        c.quotes.native
                      ) : (
                        <a href={addr(q.address)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          {q.address}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </Panel>

            <Panel>
              <SectionHead title={c.templates.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.templates.sub}</p>
              <div className="grid gap-3 min-[620px]:grid-cols-3">
                {(
                  [
                    { key: "standard", n: total - walls - pofs, impls: [] as { l: string; a: string }[] },
                    { key: "wall", n: walls, impls: [{ l: "WallTreasury", a: net.contracts.wallTreasuryImpl }, { l: "WallStaking", a: net.contracts.wallStakingImpl }, { l: "WallLadder", a: net.contracts.wallLadderImpl }] },
                    { key: "pof", n: pofs, impls: [{ l: "PoFVault", a: net.contracts.pofVaultImpl }, { l: "PoFRouter", a: net.contracts.pofRouter }] },
                  ] as const
                ).map((tpl) => (
                  <div key={tpl.key} className="rounded-[14px] border border-stroke p-4">
                    <div className="tnum text-[26px] font-light text-ink">{tpl.n}</div>
                    <div className="mono-label text-[10px] tracking-[.14em] text-ink-3">{fill(c.templates.launches, { name: c.templates.items[tpl.key][0] })}</div>
                    <p className="mt-2.5 text-[12.5px] leading-[1.6] text-muted">{c.templates.items[tpl.key][1]}</p>
                    {tpl.impls
                      .filter((i) => i.a && i.a !== ZERO)
                      .map((i) => (
                        <div key={i.l} className="mt-1.5 text-[11px] text-ink-3">
                          {i.l}:{" "}
                          <a href={addr(i.a)} target="_blank" rel="noreferrer" className="font-mono text-brand hover:underline">
                            {shortAddr(i.a)}
                          </a>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
              <Link href="/create" className="mono-label mt-4 inline-block text-[10.5px] tracking-[.12em] text-brand hover:underline">
                {c.templates.cta} →
              </Link>
            </Panel>

            <Panel>
              <SectionHead title={c.registry.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">
                {fill(c.registry.sub, { total, graduated, n: latest.length })}{" "}
                <Link href="/explore" className="text-brand hover:underline">
                  Explore →
                </Link>
              </p>
              {latest.length === 0 ? (
                <p className="text-[13px] text-muted">{c.registry.none}</p>
              ) : (
                <DataTable head={c.registry.head}>
                  {latest.map((r) => (
                    <tr key={r.token}>
                      <td className={TD}>
                        <Link href={`/token/${r.token}`} className="font-semibold text-ink hover:text-brand">
                          {r.symbol}
                        </Link>
                        <span className="block text-[11px] text-ink-3">{r.name}</span>
                      </td>
                      <td className={TD}>{templateLabel(r)}</td>
                      <td className={TD}>{r.quoteSymbol}</td>
                      <td className={`${TD} ${r.graduated ? "text-signal" : ""}`}>{r.graduated ? c.registry.graduated : fill(c.registry.toGrad, { p: Math.round(r.progress * 100) })}</td>
                      <td className={TD_MONO}>
                        <Link href={`/profile/${r.deployer}`} className="text-brand hover:underline">
                          {shortAddr(r.deployer)}
                        </Link>
                      </td>
                      <td className={TD_MONO}>
                        <a href={addr(r.curve)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          {shortAddr(r.curve)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </Panel>

            <Panel>
              <SectionHead title={c.roles.title} />
              <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.roles.sub}</p>
              <DataTable head={c.roles.head}>
                {roles.map((r) => (
                  <tr key={r.role}>
                    <td className={`${TD} whitespace-nowrap text-ink`}>{r.role}</td>
                    <td className={TD_MONO}>
                      {r.address && r.address !== ZERO ? (
                        <a href={addr(r.address)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                          {r.address}
                        </a>
                      ) : (
                        "—"
                      )}
                      {r.check === true && <span className="ml-2 font-sans text-[11px] text-pos">{r.expect ?? c.roles.asExpected}</span>}
                      {r.check === false && <span className="ml-2 font-sans text-[11px] text-neg">{fill(c.roles.notExpected, { what: r.expect ?? "" })}</span>}
                    </td>
                    <td className={TD}>{r.note}</td>
                  </tr>
                ))}
              </DataTable>
            </Panel>
          </div>
        )}

        <Panel className="mt-5">
          <SectionHead title={fill(c.contracts.title, { chain: net.label })} />
          <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">
            {!identity.checked ? c.contracts.checkRunning : identityOk ? c.contracts.checkOk : c.contracts.checkBad}{" "}
            <Link href="/verify" className="text-brand hover:underline">
              {c.contracts.link} →
            </Link>
          </p>
          {pinned.length === 0 ? (
            <p className="text-[13px] text-muted">{c.contracts.none}</p>
          ) : (
            <DataTable head={c.contracts.head}>
              {pinned.map((e) => {
                const r = byName.get(e.name);
                const status = !identity.checked ? "unverified" : r?.ok ? "match" : "mismatch";
                return (
                  <tr key={e.name}>
                    <td className={`${TD} whitespace-nowrap text-ink`}>{e.name}</td>
                    <td className={TD_MONO}>
                      <a href={addr(e.address)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {e.address}
                      </a>
                    </td>
                    <td className={`${TD} font-semibold ${status === "match" ? "text-pos" : status === "mismatch" ? "text-neg" : "text-ink-3"}`}>{status === "match" ? c.contracts.match : status === "mismatch" ? c.contracts.mismatch : c.contracts.unverified}</td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Panel>

        {others.length > 0 && (
          <Panel className="mt-5">
            <SectionHead title={c.others.title} />
            <p className="-mt-3 mb-4 text-[13px] leading-[1.7] text-muted">{c.others.sub}</p>
            <DataTable head={[...c.others.head, ""]}>
              {others.map((n) => (
                <tr key={n.key}>
                  <td className={`${TD} text-ink`}>{n.label}</td>
                  <td className={TD}>
                    {n.chainName} ({n.chainId})
                  </td>
                  <td className={TD_MONO}>
                    <a href={`${n.explorer}/address/${n.contracts.factory}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {n.contracts.factory}
                    </a>
                  </td>
                  <td className={TD}>
                    <OutlineButton type="button" onClick={() => setActiveNetwork(n.key)}>
                      {c.others.switch}
                    </OutlineButton>
                  </td>
                </tr>
              ))}
            </DataTable>
          </Panel>
        )}
        <Footer />
      </div>
    </Shell>
  );
}
