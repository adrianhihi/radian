"use client";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { useNetwork } from "@/lib/networks";
import { useIdentity, pinnedContracts } from "@/lib/identity";
import { useEffect, useState } from "react";

// Everything a careful user needs to check that this site is talking to the
// contracts it claims to, without trusting the site. Full addresses (never
// truncated: same-named fakes exist), pinned runtime code hashes with a live
// re-check, and the build recipe that reproduces the bytecode from source.

const CODE_HASH_CMD = "cast keccak $(cast code <address> --rpc-url <rpc>)";

export default function VerifyPage() {
  useReveal();
  const net = useNetwork();
  const identity = useIdentity();
  const [pinned, setPinned] = useState<ReturnType<typeof pinnedContracts>>([]);
  useEffect(() => setPinned(pinnedContracts()), [net.key]);
  const byName = new Map(identity.results.map((r) => [r.name, r]));

  const others: { name: string; address: string; note: string }[] = [
    { name: "$RADIAN token", address: net.radian.token, note: "a normal launch token; its curve is the buyback venue" },
    { name: "$RADIAN curve", address: net.radian.curve, note: "per-launch contract, so no single hash to pin — verify it through the factory registry" },
    ...net.quoteAssets.filter((q) => !q.native).map((q) => ({ name: `${q.symbol} (quote asset)`, address: q.address, note: q.stock?.standIn ? "clearly labeled testnet stand-in, not a real security" : q.blurb })),
  ];

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 60px", maxWidth: 900 }}>
        <div className="reveal">
          <span className="eyebrow">◆ Verify it yourself</span>
          <h1 style={{ fontSize: 34, marginTop: 14 }}>Don&apos;t trust this page. Check it.</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
            Network: <strong>{net.label}</strong> (chain {net.chainId}). Addresses are printed in full because same-named fakes
            exist. Each platform contract&apos;s runtime code hash was recorded at deploy; the site re-hashes the live code
            before it lets you launch or trade, and this table shows that check.
          </p>
        </div>

        <div className="panel reveal" style={{ marginTop: 24, overflowX: "auto" }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Pinned contracts · live check</h3>
          {pinned.length === 0 ? (
            <p className="hint">Nothing pinned on this network yet (contracts not deployed).</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--fg-dim)" }}>
                  <th style={{ padding: "6px 8px" }}>Contract</th>
                  <th style={{ padding: "6px 8px" }}>Address</th>
                  <th style={{ padding: "6px 8px" }}>Runtime code hash (pinned)</th>
                  <th style={{ padding: "6px 8px" }}>Live</th>
                </tr>
              </thead>
              <tbody>
                {pinned.map((e) => {
                  const r = byName.get(e.name);
                  const status = !identity.checked ? "unverified" : r?.ok ? "match" : "MISMATCH";
                  const color = status === "match" ? "var(--up)" : status === "MISMATCH" ? "var(--down)" : "var(--fg-dim)";
                  return (
                    <tr key={e.name} style={{ borderTop: "1px solid var(--border-soft)" }}>
                      <td style={{ padding: "8px", whiteSpace: "nowrap" }}>{e.name}</td>
                      <td style={{ padding: "8px", fontFamily: "var(--mono, monospace)", wordBreak: "break-all" }}>
                        <a href={`${net.explorer}/address/${e.address}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{e.address}</a>
                      </td>
                      <td style={{ padding: "8px", fontFamily: "var(--mono, monospace)", wordBreak: "break-all", fontSize: 12 }}>{e.expected}</td>
                      <td style={{ padding: "8px", color, fontWeight: 600, whiteSpace: "nowrap" }}>{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {identity.error && <p className="hint" style={{ marginTop: 8 }}>Live check failed: {identity.error}. Reload, or run the command below yourself.</p>}
          <p className="hint" style={{ marginTop: 10 }}>
            Reproduce a hash yourself: <code>{CODE_HASH_CMD}</code>. RPC: <code>{net.rpc}</code>.
          </p>
        </div>

        <div className="panel reveal" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Other addresses</h3>
          {others.map((o) => (
            <div key={o.name} className="kv" style={{ alignItems: "flex-start" }}>
              <span style={{ minWidth: 160 }}>{o.name}</span>
              <span className="v" style={{ fontFamily: "var(--mono, monospace)", wordBreak: "break-all", textAlign: "right" }}>
                <a href={`${net.explorer}/address/${o.address}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{o.address}</a>
                <div className="hint" style={{ marginTop: 2 }}>{o.note}</div>
              </span>
            </div>
          ))}
          <p className="hint" style={{ marginTop: 8 }}>
            Any token&apos;s curve is authoritative only if the factory says so: call <code>getLaunchedToken(token)</code> on the
            factory and compare the <code>curve</code> field with what this site shows.
          </p>
        </div>

        <div className="panel reveal" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Reproduce the bytecode from source</h3>
          <p className="hint">
            The trading engine is a byte-for-byte port of Pons V2 (Robinhood Chain, chain 4663, factory <code>0x7eD598…EC7e</code>,
            verified on Sourcify). Sources keep the original <code>PonsV2*</code> names and MIT headers so you can diff them
            against the upstream. Builds are reproducible: submodules are pinned to exact commits and metadata is stripped
            (<code>bytecode_hash = &quot;none&quot;</code>, <code>cbor_metadata = false</code>), so a fresh clone produces identical bytecode.
          </p>
          <pre style={{ marginTop: 10, padding: 12, background: "var(--bg-elev, rgba(127,127,127,.08))", borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{`git clone --recurse-submodules https://github.com/adrianhihi/radian && cd radian
forge build
# runtime code of a contract as compiled:
jq -r .deployedBytecode.object out/PonsV2LaunchFactory.sol/PonsV2LaunchFactory.json | cut -c1-80
# compare against what the chain runs (constructor immutables are embedded, so compare
# after deploy with the pinned hash above, or diff the code sections yourself):
cast code ${net.contracts.factory} --rpc-url ${net.rpc} | cut -c1-80`}</pre>
        </div>

        <div className="panel reveal" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 18, marginBottom: 10 }}>Numbers that must not be combined</h3>
          <ul className="hint" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>A curve&apos;s <em>quote reserve</em> includes the phantom reserve that shapes the price. It is not cash held; <em>tracked quote</em> is.</li>
            <li>Tokens in the 5-year buyback vault are <em>locked</em>, not burned. Burned $RADIAN lowers total supply; it does not move the curve price, which only sees reserves.</li>
            <li>Staking APR is computed from the current reward rate and the current $RADIAN price. It changes whenever either does and is not a promise.</li>
            <li>Indexer counts (trades, volume) can lag the chain by a few blocks and exclude retired or test launches. A dash means unknown, never zero.</li>
            <li>Stock stand-ins on testnet track a reference price for display only. They are not securities and have no redemption.</li>
          </ul>
        </div>
      </main>
    </>
  );
}
