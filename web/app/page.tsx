"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { Nav } from "@/components/Nav";
import { TokenCard } from "@/components/TokenCard";
import { useReveal } from "@/lib/useReveal";
import { useLaunches } from "@/lib/useLaunches";
import { useNetwork } from "@/lib/networks";

type Sort = "new" | "top" | "graduating";
type Filter = "all" | "live" | "graduated";

export default function Home() {
  const { rows, loading, error } = useLaunches();
  const net = useNetwork();
  const [sort, setSort] = useState<Sort>("new");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  useReveal();

  const shown = useMemo(() => {
    let r = rows;
    if (filter === "live") r = r.filter((x) => !x.graduated);
    if (filter === "graduated") r = r.filter((x) => x.graduated);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((x) => x.name.toLowerCase().includes(s) || x.symbol.toLowerCase().includes(s));
    }
    const arr = [...r];
    if (sort === "top") arr.sort((a, b) => (b.trackedQuote > a.trackedQuote ? 1 : -1));
    else if (sort === "graduating")
      arr.sort((a, b) => Number(b.graduated) - Number(a.graduated) || b.progress - a.progress);
    // "new" keeps the indexer's newest-first order
    return arr;
  }, [rows, sort, filter, q]);

  const stats = useMemo(() => {
    const total = rows.length;
    const graduated = rows.filter((r) => r.graduated).length;
    const tvl = rows.reduce((s, r) => s + Number(formatUnits(r.trackedQuote, 18)), 0);
    return { total, graduated, tvl };
  }, [rows]);

  return (
    <>
      <Nav />

      <header className="hero wrap">
        <span className="eyebrow reveal">◆ Live on Circle Arc testnet</span>
        <h1 className="reveal" data-reveal-delay={80}>
          Launch a token on <span className="grad">Arc</span>,
          <br /> priced in real dollars.
        </h1>
        <p className="sub reveal" data-reveal-delay={160}>
          Radian is the launchpad for Circle&apos;s Arc chain. Every token is born on a fair
          bonding curve quoted in <strong>native USDC</strong> — no seed capital, liquidity
          locked forever, graduating into Uniswap V4.
        </p>
        <div className="hero-cta reveal" data-reveal-delay={240}>
          <Link href="/launch" className="btn btn-primary">
            Launch a token →
          </Link>
          <Link href="#explore" className="btn btn-ghost">
            Explore launches
          </Link>
        </div>

        <div className="stats">
          {[
            { k: stats.total.toString(), l: "Tokens launched" },
            { k: stats.graduated.toString(), l: "Graduated" },
            {
              k: stats.tvl.toLocaleString(undefined, { maximumFractionDigits: 0 }),
              l: "USDC in curves",
            },
            { k: "1%", l: "Trade fee" },
          ].map((s, i) => (
            <div className="stat reveal" data-reveal-delay={120 + i * 70} key={s.l}>
              <div className="k">{s.k}</div>
              <div className="l">{s.l}</div>
            </div>
          ))}
        </div>
      </header>

      <main>
        <section className="section wrap" id="explore">
          <div className="section-head">
            <div className="reveal">
              <h2>Explore launches</h2>
              <p>Every token trading live on Radian. Search, sort, and filter.</p>
            </div>
          </div>

          {!net.live && (
            <div className="soon-banner reveal">
              <h3>Radian on Arc mainnet — September 16, 2026</h3>
              <p>
                Mainnet launches with Circle&apos;s Arc public mainnet. Switch to Testnet (top
                right) to explore and trade live now.
              </p>
            </div>
          )}

          <div className="explore-controls reveal" hidden={!net.live}>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search name or ticker…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="seg" style={{ width: "auto" }}>
              {(["new", "top", "graduating"] as Sort[]).map((s) => (
                <button
                  key={s}
                  className={sort === s ? "on-buy" : ""}
                  onClick={() => setSort(s)}
                  style={{ padding: "8px 14px", flex: "none" }}
                >
                  {s === "new" ? "New" : s === "top" ? "Top" : "Graduating"}
                </button>
              ))}
            </div>
            <div className="seg" style={{ width: "auto" }}>
              {(["all", "live", "graduated"] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={filter === f ? "on-buy" : ""}
                  onClick={() => setFilter(f)}
                  style={{ padding: "8px 14px", flex: "none" }}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {!net.live ? null : loading && rows.length === 0 ? (
            <div className="empty">Loading launches from Arc…</div>
          ) : error ? (
            <div className="empty">Couldn&apos;t reach Arc RPC: {error}</div>
          ) : shown.length === 0 ? (
            <div className="empty">
              {rows.length === 0 ? (
                <>
                  No launches yet.{" "}
                  <Link href="/launch" style={{ color: "var(--radian-2)" }}>
                    Be the first →
                  </Link>
                </>
              ) : (
                "No tokens match your filter."
              )}
            </div>
          ) : (
            <div className="grid">
              {shown.map((row, i) => (
                <TokenCard key={row.token} row={row} delay={(i % 3) * 90} />
              ))}
            </div>
          )}
        </section>

        <section className="section wrap">
          <div className="section-head">
            <div className="reveal">
              <h2>How Radian works</h2>
              <p>One transaction to launch. The curve does price discovery. Nobody can rug it.</p>
            </div>
          </div>
          <div className="steps">
            {[
              {
                t: "Create",
                d: "Name it, add a logo, hit launch. A fixed 1B-supply token and its bonding curve deploy in a single transaction, quoted in native USDC.",
              },
              {
                t: "Trade",
                d: "Buy and sell on the curve from block one. Price rises as supply is bought — fair discovery, no presale, no team allocation. 1% fee, shared with the creator.",
              },
              {
                t: "Graduate",
                d: "When the curve fills, liquidity migrates into a permanently-locked Uniswap V4 pool. No withdrawal path — the liquidity is locked for good.",
              },
            ].map((s, i) => (
              <div className="step reveal" data-reveal-delay={i * 100} key={s.t}>
                <div className="n">{i + 1}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="footer wrap">
          <div className="cols">
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg)", fontWeight: 700, fontFamily: "var(--font-display)" }}>
                Radian
              </div>
              <div style={{ marginTop: 8, maxWidth: 340 }}>
                The launchpad for Circle&apos;s Arc chain. Testnet preview — not affiliated with
                Circle, Robinhood, or Pons-Labs.
              </div>
            </div>
            <div style={{ display: "flex", gap: 40 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Link href="/launch">Launch</Link>
                <Link href="/#explore">Explore</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <a href="https://testnet.arcscan.app/address/0x90022cC2107De9c070F889E3A67009FcA270E4E2" target="_blank" rel="noreferrer">
                  Factory
                </a>
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                  Get testnet USDC
                </a>
              </div>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}
