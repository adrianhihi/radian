"use client";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";

export default function BuildersPage() {
  useReveal();
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0", maxWidth: 820 }}>
        <div className="reveal">
          <span className="eyebrow">◆ Builders Program</span>
          <h1 style={{ fontSize: 38, marginTop: 18 }}>Build the Arc economy.</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 14, fontSize: 17 }}>
            Radian is the launch layer for Circle&apos;s Arc chain. Creators keep half of every
            trade fee, forever — on the curve and after graduation. Here&apos;s what you get.
          </p>
        </div>

        <div className="steps" style={{ marginTop: 30 }}>
          {[
            { t: "70% of fees", d: "Every trade on your token pays a 1% fee in its quote asset. 70% of it is yours — to a fee escrow you claim any time, before and after graduation. Turn on Buyback & Lock and half of that share buys your token back instead." },
            { t: "Real-money pricing", d: "Your token is quoted in native USDC, EURC, or a stock — not a volatile gas coin. Holders see a price in real money from the first trade." },
            { t: "Locked liquidity", d: "Graduation seeds a permanently-locked Uniswap V4 pool. Your community can trust the liquidity can never be pulled." },
          ].map((s, i) => (
            <div className="step reveal" data-reveal-delay={i * 90} key={s.t}>
              <div className="n">★</div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>

        <div className="panel reveal" style={{ marginTop: 22 }}>
          <h3 style={{ fontSize: 20 }}>Creator economics</h3>
          <div className="kv" style={{ marginTop: 12 }}><span>Trade fee</span><span className="v">1% of every swap (USDC leg)</span></div>
          <div className="kv"><span>Your share</span><span className="v">50% of the fee</span></div>
          <div className="kv"><span>Optional creator tax</span><span className="v">up to 10%, 100% to you</span></div>
          <div className="kv"><span>Launch cost</span><span className="v">1 USDC</span></div>
          <div className="kv"><span>Payout</span><span className="v">Claim from fee escrow anytime</span></div>
        </div>

        <div className="reveal" style={{ marginTop: 28, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <Link href="/launch" className="btn btn-primary">Launch a token →</Link>
          <Link href="/docs" className="btn btn-ghost">Read the docs</Link>
        </div>
        <p className="hint" style={{ marginTop: 20 }}>
          Testnet preview. Grants and creator rewards for the mainnet program will be announced
          ahead of Arc mainnet.
        </p>
      </main>
    </>
  );
}
