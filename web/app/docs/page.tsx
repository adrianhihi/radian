"use client";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { RADIAN } from "@/lib/radian";

const addr = (a: string) => `https://testnet.arcscan.app/address/${a}`;

export default function DocsPage() {
  useReveal();
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0", maxWidth: 780 }}>
        <div className="reveal">
          <h1 style={{ fontSize: 36 }}>How Radian works</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 12, fontSize: 17 }}>
            Radian is a permissionless launchpad on Circle&apos;s Arc chain. Every token is born
            on a constant-product bonding curve quoted in <strong>native USDC</strong>, then
            graduates into a permanently locked Uniswap V4 pool. The trading engine is a faithful
            port of Pons V2; you can diff our sources against the verified upstream on Sourcify.
          </p>
        </div>

        {[
          {
            h: "1 · Launch",
            b: "A single transaction deploys a fixed-supply (1,000,000,000) ERC-20 and its bonding curve, minting the entire supply to the curve. No presale, no team allocation. Launch fee is 1 USDC.",
          },
          {
            h: "2 · Bonding curve",
            b: "The curve prices trades as a constant product against a phantom USDC reserve, so there is an opening price with zero seed capital and the price rises as supply is bought. A 1% fee is charged on the USDC leg of every trade — half to the creator, the rest split between the protocol and a buyback.",
          },
          {
            h: "3 · Anti-snipe",
            b: "For the first 15 seconds after launch, a decaying tax (99% → 0%) is applied to non-exempt buyers, so a launch can't be sniped in its opening block. The creator and their declared wallets are exempt.",
          },
          {
            h: "4 · Graduation",
            b: "When the curve's real USDC reserve crosses the threshold (20 USDC on testnet), the curve drains into a full-range Uniswap V4 position that is locked forever — the locker exposes no withdrawal path. Trading continues on the V4 pool through a singleton hook that keeps charging the fee.",
          },
          {
            h: "5 · Buyback & lock",
            b: "The buyback share of fees is used to buy the token back on its own curve and lock it in a five-year linear vesting vault — a fee flywheel that rewards the protocol without a rug vector. Buybacks are locked, never burned.",
          },
        ].map((s, i) => (
          <div className="panel reveal" data-reveal-delay={i * 60} key={s.h} style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>{s.h}</h3>
            <p style={{ color: "var(--fg-dim)", margin: 0 }}>{s.b}</p>
          </div>
        ))}

        <div className="section" style={{ paddingTop: 40 }}>
          <div className="section-head reveal">
            <div>
              <h2 style={{ fontSize: 24 }}>Contracts</h2>
              <p>Deployed on Arc testnet (chain 5042002). All verifiable on Arcscan.</p>
            </div>
          </div>
          <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
            {[
              ["LaunchFactory", RADIAN.factory],
              ["MemeHook (Uniswap V4)", RADIAN.hook],
              ["BuybackVault", RADIAN.vault],
              ["LaunchLocker", RADIAN.locker],
              ["FeeEscrow", RADIAN.escrow],
              ["PoolManager (Uniswap V4)", RADIAN.poolManager],
            ].map(([label, a]) => (
              <div key={a} className="kv" style={{ padding: "13px 20px" }}>
                <span>{label}</span>
                <a className="v mono" href={addr(a)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
                  {a.slice(0, 10)}…{a.slice(-8)}
                </a>
              </div>
            ))}
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            Native gas token is USDC (18-decimal for msg.value). Not affiliated with Circle,
            Robinhood, or Pons-Labs.
          </p>
        </div>
      </main>
    </>
  );
}
