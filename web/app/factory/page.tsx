"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { NETWORKS, setActiveNetwork, useNetwork } from "@/lib/networks";
import { useIdentity, pinnedContracts } from "@/lib/identity";
import { useLaunches } from "@/lib/useLaunches";
import { useFactoryState } from "@/lib/factory";
import { RADIAN, publicClient, type LaunchRow } from "@/lib/radian";
import { poundVaultAbi } from "@/lib/pound";
import { fmtAmount } from "@/lib/templates";

// The factory directory: what the one factory contract on this network is
// configured to do, what it has produced, and who holds which role. Everything
// is read live from the chain and the indexer; nothing here is hand-written state.

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const pct = (bps: number | null | undefined) => (bps == null ? "—" : `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const templateLabel = (r: LaunchRow) => (r.template?.kind === "wall" ? "The Wall" : r.template?.kind === "pof" ? "Proof-of-Fee" : "Standard");

const td: React.CSSProperties = { padding: "8px", verticalAlign: "top" };
const mono: React.CSSProperties = { ...td, fontFamily: "var(--mono, monospace)", fontSize: 12, wordBreak: "break-all" };
const th: React.CSSProperties = { padding: "6px 8px", textAlign: "left", color: "var(--fg-dim)", fontWeight: 600, fontSize: 12.5 };

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <tr style={{ borderTop: "1px solid var(--border-soft)" }}>{children}</tr>;

export default function FactoryPage() {
  useReveal();
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
  const explorerAddr = (a: string) => `${net.explorer}/address/${a}`;
  const byName = new Map(identity.results.map((r) => [r.name, r]));
  const identityOk = identity.checked && identity.results.length > 0 && identity.results.every((r) => r.ok);

  const total = rows.length;
  const graduated = rows.filter((r) => r.graduated).length;
  const walls = rows.filter((r) => r.template?.kind === "wall").length;
  const pofs = rows.filter((r) => r.template?.kind === "pof").length;
  const latest = [...rows].slice(0, 12);
  const countByQuote = (address: string) => rows.filter((r) => same(r.pairToken, address) || (address === ZERO && (!r.pairToken || r.pairToken === ZERO))).length;

  const others = Object.values(NETWORKS).filter((n) => n.live && !n.hidden && n.key !== net.key);

  // `check` compares the live address with what this site expects; `expect` names that expectation
  const roles: { role: string; address: string | null | undefined; note: string; check?: boolean | null; expect?: string }[] = state
    ? [
        { role: "Factory owner", address: state.factoryOwner, note: "sets the launch fee, launch configs, approved quote assets and the launch forwarder" },
        { role: "Hook owner", address: state.hook.owner, note: "sets the trade fee split and the price-impact cap for every curve" },
        net.pound
          ? {
              role: "Protocol fee recipient",
              address: state.hook.protocolFeeRecipient,
              note: "the PoundVault: settles the protocol share into referral accruals, the Pack burn pool and the treasury",
              check: same(state.hook.protocolFeeRecipient, net.pound.vault),
              expect: "the PoundVault",
            }
          : { role: "Protocol fee recipient", address: state.hook.protocolFeeRecipient, note: "receives the protocol share of trade fees" },
        ...(net.pound
          ? [{ role: "Pack burner", address: net.pound.burner, note: "spends the burn pool, in rotation, on the Pack (Safe-curated coins with a V4 pool here) and sends what it buys to 0x…dEaD" }]
          : []),
        {
          role: "Launch forwarder",
          address: state.launchForwarder,
          note: "the only contract allowed to launch on someone's behalf; this site launches through it",
          check: state.launchForwarder ? same(state.launchForwarder, RADIAN.router) : null,
          expect: "this site's router",
        },
        { role: "Fee sweep operator", address: state.hook.feeSweepOperator, note: "the keeper: moves earned fees off every curve about once an hour" },
        { role: "Router keeper", address: state.routerKeeper, note: "the keeper: Wall defends and ladders, Proof-of-Fee buybacks, delegated buys, stuck graduations" },
        ...(net.pound ? [] : [{ role: "$RADIAN treasury keeper", address: state.treasuryKeeper, note: "the keeper: buys back $RADIAN with protocol fees and pays stakers" }]),
      ]
    : [];

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 60px", maxWidth: 980 }}>
        <div className="reveal">
          <span className="eyebrow">◆ Factory</span>
          <h1 style={{ fontSize: 34, marginTop: 14 }}>One factory. Every launch.</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 10, maxWidth: 720 }}>
            Every Radian token on <strong>{net.label}</strong> (chain {net.chainId}) comes out of one factory contract. This page reads the
            factory&apos;s live settings, lists what it has produced, and names who holds which role. It is what the chain says, not
            what we say.
          </p>
          <p className="hint" style={{ marginTop: 6 }}>
            Factory:{" "}
            <a href={explorerAddr(net.contracts.factory)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)", fontFamily: "var(--mono, monospace)" }}>
              {net.contracts.factory}
            </a>
          </p>
        </div>

        {!net.live && <p className="hint" style={{ marginTop: 24 }}>This network is not live yet. Nothing to read.</p>}
        {error && <p className="hint" style={{ marginTop: 24 }}>Could not read the factory: {error}</p>}
        {loading && net.live && <p className="hint" style={{ marginTop: 24 }}>Reading the factory…</p>}

        {state && (
          <>
            <div className="stats reveal" style={{ marginTop: 28 }}>
              <div className="stat"><div className="k">{state.launchEnabled == null ? "—" : state.launchEnabled ? "Open" : "Closed"}</div><div className="l">Launches</div></div>
              <div className="stat"><div className="k">{state.launchFee == null ? "—" : `${fmtAmount(state.launchFee, 18, 4)} ${gas}`}</div><div className="l">Launch fee</div></div>
              <div className="stat"><div className="k">{pct(state.hook.hookFeeBps)}</div><div className="l">Trade fee on every curve</div></div>
              <div className="stat"><div className="k">{pct(state.hook.protocolFeeShareBps)}</div><div className="l">Protocol share of the fee</div></div>
            </div>

            <div className="panel reveal" style={{ marginTop: 24 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Launch rules</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>Applied by the factory and the hook to every token, whatever template it uses.</p>
              <Table head={["Rule", "Value", "What it means"]}>
                <Row><td style={td}>Launch fee</td><td style={td}>{state.launchFee == null ? "—" : `${fmtAmount(state.launchFee, 18, 6)} ${gas}`}</td><td style={td}>paid once, at launch, to the protocol</td></Row>
                <Row><td style={td}>Trade fee</td><td style={td}>{pct(state.hook.hookFeeBps)}</td><td style={td}>taken on every buy and sell on the curve</td></Row>
                <Row><td style={td}>Protocol share</td><td style={td}>{pct(state.hook.protocolFeeShareBps)}</td><td style={td}>of each trade fee; the rest is the creator slice</td></Row>
                <Row><td style={td}>Buyback share</td><td style={td}>{pct(state.hook.buybackBurnBps)}</td><td style={td}>of the creator slice locked for buybacks when the creator enables buyback</td></Row>
                {net.pound && (
                  <>
                    <Row><td style={td}>Referral share</td><td style={td}>5.55%</td><td style={td}>of each trade fee, to whoever referred the buyer — carved out of the protocol share by the PoundVault</td></Row>
                    <Row><td style={td}>Launcher-referral share</td><td style={td}>5.55%</td><td style={td}>of each trade fee, to whoever referred the token&apos;s creator</td></Row>
                    <Row><td style={td}>Pack burn share</td><td style={td}>{burnShare == null ? "≥ 50%" : pct(burnShare)}</td><td style={td}>of what remains of the protocol share, spent buying and burning Pack coins; the rest funds the treasury</td></Row>
                  </>
                )}
                <Row><td style={td}>Max creator tax</td><td style={td}>{pct(state.maxCreatorTaxBps)}</td><td style={td}>the most a creator can add on top of the trade fee</td></Row>
                <Row><td style={td}>Snipe tax</td><td style={td}>{state.snipeTaxStartBps == null || state.snipeTaxSeconds == null ? "—" : `${pct(state.snipeTaxStartBps)} falling to 0 over ${state.snipeTaxSeconds}s`}</td><td style={td}>on buys in the first seconds after launch, so bots cannot front-run the creator</td></Row>
                <Row><td style={td}>Price impact cap</td><td style={td}>{pct(state.hook.maxInternalPriceImpactBps)}</td><td style={td}>the most one internal buyback may move the price</td></Row>
              </Table>
            </div>

            <div className="panel reveal" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Launch configs</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>A launch picks one config by id. Supply is fixed. The curve graduates into a Uniswap V4 pool with the tick spacing shown; the pool&apos;s own LP fee must be zero because the hook charges the trade fee.</p>
              {state.configs.length === 0 ? (
                <p className="hint">No configs readable.</p>
              ) : (
                <Table head={["Id", "Supply", "Curve fee", "Graduates at", "Phantom quote", "V4 LP fee", "Tick spacing", "Enabled"]}>
                  {state.configs.map((c) => (
                    <Row key={c.id}>
                      <td style={td}>{c.id}</td>
                      <td style={td}>{Number(formatUnits(c.supply, 18)).toLocaleString()}</td>
                      <td style={td}>{pct(c.curveFeeBps)}</td>
                      <td style={td}>{fmtAmount(c.graduationThreshold, 18, 2)} {gas}</td>
                      <td style={td}>{fmtAmount(c.phantomQuote, 18, 2)} {gas}</td>
                      <td style={td}>{c.poolFee === 0 ? "0 (the hook charges the fee)" : `${(c.poolFee / 10_000).toFixed(2)}%`}</td>
                      <td style={td}>{c.tickSpacing}</td>
                      <td style={{ ...td, color: c.enabled ? "var(--up)" : "var(--down)", fontWeight: 600 }}>{c.enabled ? "yes" : "no"}</td>
                    </Row>
                  ))}
                </Table>
              )}
              <p className="hint" style={{ marginTop: 8 }}>Graduation and phantom amounts above are for the {gas} quote. Each other quote asset carries its own pair below.</p>
            </div>

            <div className="panel reveal" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Quote assets</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>What a curve can be priced in. Only assets the factory owner approved can be paired; the site cannot add one.</p>
              <Table head={["Asset", "Kind", "Approved", "Graduates at", "Phantom quote", "Launches", "Address"]}>
                {state.quotes.map((q) => (
                  <Row key={q.key}>
                    <td style={td}><strong>{q.symbol}</strong><div className="hint" style={{ marginTop: 2 }}>{q.blurb}</div></td>
                    <td style={td}>{q.native ? "gas coin" : q.stock ? (q.stock.standIn ? "stock stand-in (testnet)" : "tokenized stock") : "stablecoin"}</td>
                    <td style={{ ...td, color: q.approved ? "var(--up)" : q.approved === false ? "var(--down)" : "var(--fg-dim)", fontWeight: 600 }}>{q.approved == null ? "—" : q.approved ? "yes" : "no"}</td>
                    <td style={td}>{q.graduationThreshold == null ? "—" : `${fmtAmount(q.graduationThreshold, q.decimals, 2)} ${q.symbol}`}</td>
                    <td style={td}>{q.phantomQuote == null ? "—" : `${fmtAmount(q.phantomQuote, q.decimals, 2)} ${q.symbol}`}</td>
                    <td style={td}>{countByQuote(q.address)}</td>
                    <td style={mono}>{q.native ? "native" : <a href={explorerAddr(q.address)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{q.address}</a>}</td>
                  </Row>
                ))}
              </Table>
            </div>

            <div className="panel reveal" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Templates</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>Every template uses the same factory and curve. A template only decides where the creator slice of fees goes. Per-launch contracts are clones of the implementations listed here.</p>
              <div className="token-grid">
                {[
                  { name: "Standard", n: total - walls - pofs, d: "Fees go to the creator, or to a locked buyback if the creator chose that.", impls: [] as { l: string; a: string }[] },
                  { name: "The Wall", n: walls, d: "Fees fund a treasury that buys the token back on the curve below book value, then runs a bid ladder on Uniswap V4 after graduation. Stakers earn a stream.", impls: [{ l: "WallTreasury", a: net.contracts.wallTreasuryImpl }, { l: "WallStaking", a: net.contracts.wallStakingImpl }, { l: "WallLadder", a: net.contracts.wallLadderImpl }] },
                  { name: "Proof-of-Fee", n: pofs, d: "Fees fund buybacks whose proceeds go, each round, to the traders who paid the most fees through the router.", impls: [{ l: "PoFVault", a: net.contracts.pofVaultImpl }, { l: "PoFRouter", a: net.contracts.pofRouter }] },
                ].map((t) => (
                  <div key={t.name} className="stat">
                    <div className="k">{t.n}</div>
                    <div className="l">{t.name} launches</div>
                    <p style={{ fontSize: 13, color: "var(--fg-dim)", marginTop: 10 }}>{t.d}</p>
                    {t.impls.filter((i) => i.a && i.a !== ZERO).map((i) => (
                      <div key={i.l} className="hint" style={{ marginTop: 4 }}>
                        {i.l}: <a href={explorerAddr(i.a)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)", fontFamily: "var(--mono, monospace)" }}>{short(i.a)}</a>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 12 }}><Link href="/launch" style={{ color: "var(--radian-2)" }}>Launch with a template →</Link></p>
            </div>

            <div className="panel reveal" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Registry</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
                {total} launches, {graduated} graduated. The newest {latest.length} are listed; <Link href="/#explore" style={{ color: "var(--radian-2)" }}>Explore</Link> has all of them.
              </p>
              {latest.length === 0 ? (
                <p className="hint">No launches indexed yet.</p>
              ) : (
                <Table head={["Token", "Template", "Quote", "Status", "Creator", "Curve"]}>
                  {latest.map((r) => (
                    <Row key={r.token}>
                      <td style={td}><Link href={`/token/${r.token}`} style={{ color: "var(--fg)", fontWeight: 600 }}>{r.symbol}</Link><div className="hint" style={{ marginTop: 2 }}>{r.name}</div></td>
                      <td style={td}>{templateLabel(r)}</td>
                      <td style={td}>{r.quoteSymbol}</td>
                      <td style={{ ...td, color: r.graduated ? "var(--up)" : "var(--fg-dim)" }}>{r.graduated ? "graduated" : `${Math.round(r.progress * 100)}% to graduation`}</td>
                      <td style={mono}><a href={explorerAddr(r.deployer)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{short(r.deployer)}</a></td>
                      <td style={mono}><a href={explorerAddr(r.curve)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{short(r.curve)}</a></td>
                    </Row>
                  ))}
                </Table>
              )}
            </div>

            <div className="panel reveal" style={{ marginTop: 18 }}>
              <h3 style={{ fontSize: 18, marginBottom: 6 }}>Roles</h3>
              <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>Who can change what. The keeper is a bot that only calls functions anyone may call; it holds no user funds.</p>
              <Table head={["Role", "Address", "What it can do"]}>
                {roles.map((r) => (
                  <Row key={r.role}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{r.role}</td>
                    <td style={mono}>
                      {r.address && r.address !== ZERO ? <a href={explorerAddr(r.address)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{r.address}</a> : "—"}
                      {r.check === true && <span style={{ color: "var(--up)", marginLeft: 8, fontFamily: "inherit" }}>{r.expect ?? "as expected"}</span>}
                      {r.check === false && <span style={{ color: "var(--down)", marginLeft: 8, fontFamily: "inherit" }}>not {r.expect ?? "what this site expects"} — an owner change is pending</span>}
                    </td>
                    <td style={td}>{r.note}</td>
                  </Row>
                ))}
              </Table>
            </div>
          </>
        )}

        <div className="panel reveal" style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 18, marginBottom: 6 }}>Contracts on {net.label}</h3>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Live identity check: {!identity.checked ? "running" : identityOk ? "every pinned contract matches its recorded code hash" : "a pinned contract does NOT match"}.{" "}
            <Link href="/verify" style={{ color: "var(--radian-2)" }}>Hashes and how to reproduce them →</Link>
          </p>
          {pinned.length === 0 ? (
            <p className="hint">Nothing pinned on this network.</p>
          ) : (
            <Table head={["Contract", "Address", "Live"]}>
              {pinned.map((e) => {
                const r = byName.get(e.name);
                const status = !identity.checked ? "unverified" : r?.ok ? "match" : "MISMATCH";
                const color = status === "match" ? "var(--up)" : status === "MISMATCH" ? "var(--down)" : "var(--fg-dim)";
                return (
                  <Row key={e.name}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{e.name}</td>
                    <td style={mono}><a href={explorerAddr(e.address)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{e.address}</a></td>
                    <td style={{ ...td, color, fontWeight: 600 }}>{status}</td>
                  </Row>
                );
              })}
            </Table>
          )}
        </div>

        {others.length > 0 && (
          <div className="panel reveal" style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>Other networks</h3>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>The same factory design runs on each chain below, with its own addresses and its own indexer.</p>
            <Table head={["Network", "Chain", "Factory", ""]}>
              {others.map((n) => (
                <Row key={n.key}>
                  <td style={td}><strong>{n.label}</strong></td>
                  <td style={td}>{n.chainName} ({n.chainId})</td>
                  <td style={mono}><a href={`${n.explorer}/address/${n.contracts.factory}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{n.contracts.factory}</a></td>
                  <td style={td}><button className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => setActiveNetwork(n.key)}>Switch</button></td>
                </Row>
              ))}
            </Table>
          </div>
        )}
      </main>
    </>
  );
}
