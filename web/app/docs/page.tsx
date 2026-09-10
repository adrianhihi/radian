"use client";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { RADIAN } from "@/lib/radian";

const addr = (a: string) => `https://testnet.arcscan.app/address/${a}`;

function Table({ rows, head }: { rows: [string, string][]; head: [string, string] }) {
  return (
    <div className="panel reveal" style={{ padding: 0, overflow: "hidden" }}>
      <div className="kv" style={{ padding: "11px 20px", color: "var(--fg-faint)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <span>{head[0]}</span>
        <span>{head[1]}</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="kv" style={{ padding: "13px 20px", alignItems: "flex-start", gap: 20 }}>
          <span style={{ fontWeight: 600, flexShrink: 0, minWidth: 130 }}>{k}</span>
          <span style={{ color: "var(--fg-dim)", textAlign: "right" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function DocsPage() {
  useReveal();
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0", maxWidth: 820 }}>
        <div className="reveal">
          <h1 style={{ fontSize: 36 }}>Documentation</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 12, fontSize: 17 }}>
            Radian is a permissionless token launchpad on Circle&apos;s Arc chain. Every token is
            born on a constant-product bonding curve quoted in <strong>native USDC</strong>, then
            graduates into a permanently locked Uniswap V4 pool. Radian is non-custodial — your
            wallet signs every transaction directly against the contracts; Radian never holds your
            funds. The trading engine is a faithful port of Pons V2, diffable byte-for-byte against
            the verified upstream on Sourcify.
          </p>
        </div>

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Architecture at a glance</h2>
        <div style={{ marginTop: 16 }}>
          <Table
            head={["Component", "Role"]}
            rows={[
              ["LaunchFactory", "Entry point — atomically deploys the token and its bonding curve, snapshots fee terms"],
              ["LaunchToken", "Fixed 1,000,000,000-supply ERC-20; whole supply minted to its curve; no owner, no mint"],
              ["BondingCurve", "Constant-product curve quoted in native USDC; buy/sell with slippage + deadline guards"],
              ["MemeHook (V4)", "Singleton Uniswap V4 hook on graduated pools — keeps charging the fee, converts to quote"],
              ["LaunchLocker", "Holds the graduated V4 position forever — no withdrawal path exists"],
              ["BuybackVault", "Fee-funded buybacks locked on a 5-year linear vest (locked, never burned)"],
              ["FeeEscrow", "Claimable ledger for creator and protocol fee balances"],
            ]}
          />
        </div>

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Launch flow</h2>
        {[
          { h: "1 · Create", b: "One transaction deploys the token + curve and mints the full 1B supply to the curve. Launch fee is 1 USDC (paid as msg.value). You also pay gas." },
          { h: "2 · Optional first buy", b: "In the same flow you can buy your own token on the fresh curve. As the creator you're exempt from the launch-window snipe tax, so it settles untaxed — it sets the opening price and signals conviction." },
          { h: "3 · Trade", b: "Anyone buys and sells on the curve from block one. Price rises as supply is bought — fair discovery, no presale, no team allocation. A 1% fee is charged on the USDC leg of every trade." },
          { h: "4 · Graduate", b: "When the curve's real USDC reserve crosses the threshold (20 USDC on testnet), it drains into a full-range Uniswap V4 position that is locked forever. Trading continues on the V4 pool via the singleton hook." },
        ].map((s, i) => (
          <div className="panel reveal" data-reveal-delay={i * 50} key={s.h} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 17, marginBottom: 6 }}>{s.h}</h3>
            <p style={{ color: "var(--fg-dim)", margin: 0 }}>{s.b}</p>
          </div>
        ))}

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Required inputs</h2>
        <div style={{ marginTop: 16 }}>
          <Table
            head={["Field", "Description"]}
            rows={[
              ["Name", "Full token name, e.g. \"Arc Doge\""],
              ["Symbol", "Ticker, up to 10 characters"],
              ["Image", "PNG/JPG/WebP/GIF — uploaded and linked in the token's on-chain logo field"],
              ["Description / Socials", "Optional — written into token metadata (website, X)"],
              ["First buy", "Optional creator buy on the new curve, in USDC (0 to skip)"],
            ]}
          />
        </div>

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Anti-snipe</h2>
        <div className="panel reveal" style={{ marginTop: 14 }}>
          <p style={{ color: "var(--fg-dim)", margin: 0 }}>
            For the first ~15 seconds after launch, a decaying tax (99% → 0%) is applied to
            non-exempt buyers on the quote leg, so a launch can&apos;t be sniped in its opening
            block. The creator and their declared wallets are exempt. The tax rides the same USDC
            leg as the base fee and lifts automatically — no admin action.
          </p>
        </div>

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Fees & the buyback flywheel</h2>
        <div style={{ marginTop: 16 }}>
          <Table
            head={["Leg", "Where it goes"]}
            rows={[
              ["Trade fee", "1% of every swap, charged on the USDC leg (before and after graduation)"],
              ["Creator", "50% of the fee — streamed to the fee escrow, claimable anytime"],
              ["Protocol", "Part of the remainder — to the protocol fee recipient via escrow"],
              ["Buyback", "The rest buys the token back on its own curve and locks it in the 5-year vesting vault"],
              ["Creator tax", "Optional, up to 10%, paid 100% to the creator on top of the base fee"],
            ]}
          />
          <p className="hint" style={{ marginTop: 10 }}>
            Fee accounting is a lifecycle: swap fees accrue → a sweep records them into the vault
            and escrow → creator/protocol claim, or the buyback slice is bought and locked.
            Buybacks are locked, not burned.
          </p>
        </div>

        <h2 className="reveal" style={{ fontSize: 24, marginTop: 40 }}>Contracts</h2>
        <p className="reveal" style={{ color: "var(--fg-dim)", marginTop: 6 }}>
          Deployed on Arc testnet (chain 5042002). All verifiable on Arcscan.
        </p>
        <div className="panel reveal" style={{ padding: 0, overflow: "hidden", marginTop: 12 }}>
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
        <p className="hint reveal" style={{ marginTop: 12, marginBottom: 60 }}>
          Native gas token is USDC (18-decimal for msg.value; 6-decimal ERC-20 view at
          0x3600…0000). Not affiliated with Circle, Robinhood, or Pons-Labs.
        </p>
      </main>
    </>
  );
}
