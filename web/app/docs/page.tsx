"use client";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { RADIAN } from "@/lib/radian";
import { useNetwork } from "@/lib/networks";



const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "launch-flow", label: "Launch flow" },
  { id: "inputs", label: "Required inputs" },
  { id: "fee-modes", label: "Fee modes" },
  { id: "templates", label: "Templates" },
  { id: "auto-buy", label: "Auto-buy" },
  { id: "anti-snipe", label: "Anti-snipe" },
  { id: "fees", label: "Fees & buyback" },
  { id: "contracts", label: "Contracts" },
];

function Table({ rows, head }: { rows: [string, string][]; head: [string, string] }) {
  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div className="kv" style={{ padding: "11px 20px", color: "var(--fg-faint)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        <span>{head[0]}</span><span>{head[1]}</span>
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
  const net = useNetwork();
  const addr = (a: string) => `${net.explorer}/address/${a}`;
  const [active, setActive] = useState("overview");
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-20% 0px -70% 0px" }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  return (
    <>
      <Nav />
      <main className="wrap docs-layout">
        <aside className="docs-toc">
          <div className="docs-toc-inner">
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg-faint)", marginBottom: 12 }}>
              Documentation
            </div>
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className={`docs-toc-link${active === s.id ? " on" : ""}`}>
                {s.label}
              </a>
            ))}
          </div>
        </aside>

        <div className="docs-content">
          <section id="overview">
            <h1 style={{ fontSize: 34 }}>How Radian works</h1>
            <p style={{ color: "var(--fg-dim)", marginTop: 12, fontSize: 16 }}>
              Radian is a permissionless token launchpad on Circle&apos;s Arc chain. Every token is
              born on a constant-product bonding curve quoted in the asset its creator chose —
              <strong>native USDC</strong> by default, EURC, or (on testnet) a stock stand-in — then
              graduates into a permanently locked Uniswap V4 pool. Radian is non-custodial — your
              wallet signs every transaction; Radian never holds your funds. The trading engine is a
              faithful port of Pons V2, diffable byte-for-byte against the verified upstream on Sourcify.
            </p>
          </section>

          <section id="architecture">
            <h2>Architecture</h2>
            <Table
              head={["Component", "Role"]}
              rows={[
                ["LaunchFactory", "Atomically deploys the token + curve and snapshots fee terms"],
                ["LaunchToken", "Fixed 1B-supply ERC-20 minted entirely to its curve; no owner, no mint"],
                ["BondingCurve", "Constant-product curve in the launch's quote asset; buy/sell enforce an on-chain minimum-received (slippage) bound — there is no deadline parameter"],
                ["MemeHook (V4)", "Singleton Uniswap V4 hook on graduated pools — keeps charging the fee"],
                ["LaunchLocker", "Holds the graduated V4 position forever — no withdrawal path exists"],
                ["BuybackVault", "Fee-funded buybacks locked on a 5-year linear vest (locked, never burned)"],
                ["FeeEscrow", "Claimable ledger for creator and protocol fee balances"],
              ]}
            />
          </section>

          <section id="launch-flow">
            <h2>Launch flow</h2>
            {[
              { h: "1 · Create", b: "One transaction deploys the token + curve and mints the full 1B supply to the curve. Launch fee is 1 USDC (msg.value), plus gas." },
              { h: "2 · Optional first buy", b: "Add a first buy and it rides the same transaction: the launch router deploys the curve and fills your buy in the launch block, before any other wallet can see it. As the creator you're snipe-tax-exempt, so it settles untaxed and sets the opening price." },
              { h: "3 · Trade", b: "Anyone buys and sells on the curve from block one. Price rises as supply is bought — fair discovery, no presale. A 1% fee is charged on the quote-asset leg." },
              { h: "4 · Graduate", b: "When the curve's real USDC reserve crosses the threshold, it drains into a full-range Uniswap V4 position that is locked forever. Trading continues on the V4 pool via the hook." },
            ].map((s) => (
              <div className="panel" key={s.h} style={{ marginTop: 12 }}>
                <h3 style={{ fontSize: 16, marginBottom: 6 }}>{s.h}</h3>
                <p style={{ color: "var(--fg-dim)", margin: 0 }}>{s.b}</p>
              </div>
            ))}
          </section>

          <section id="inputs">
            <h2>Required inputs</h2>
            <Table
              head={["Field", "Description"]}
              rows={[
                ["Name", "Full token name, e.g. \"Arc Doge\""],
                ["Symbol", "Ticker, up to 10 characters"],
                ["Token image", "PNG/JPG/WebP/GIF uploaded and linked in the token's on-chain logo field"],
                ["Description / Socials", "Optional — written into token metadata (website, X)"],
                ["Fee mode", "How the quote-asset fee is used (see below)"],
                ["First buy", "Optional creator buy on the new curve, in the chosen quote asset (0 to skip)"],
              ]}
            />
          </section>

          <section id="fee-modes">
            <h2>Fee modes</h2>
            <p style={{ color: "var(--fg-dim)", marginTop: 6 }}>
              Chosen at launch and snapshotted on-chain. Two modes are live; two need a contract upgrade.
            </p>
            <Table
              head={["Mode", "Behavior"]}
              rows={[
                ["Buyback & Lock", "The buyback share of fees buys the token on its own curve and locks it in the 5-year vault"],
                ["Creator Fees", "The creator fee (plus an optional creator tax up to 10%) goes to a wallet you choose"],
                ["Holder Rewards", "Distribute fees to holders — planned, needs a contract upgrade"],
                ["Fee Sharing", "Split fees across up to five wallets — planned, needs a contract upgrade"],
              ]}
            />
          </section>

          <section id="templates">
            <h2>Templates</h2>
            <p style={{ color: "var(--fg-dim)", marginTop: 6 }}>
              A template decides what the creator-fee share of every trade does. It is chosen at launch and written on-chain by the
              launch router, which sets creator-fee mode with a per-launch contract as the only recipient — no wallet can be
              substituted later. Fee mode does not apply to templated launches.
            </p>
            <Table
              head={["Template", "What fees do"]}
              rows={[
                ["Standard", "The fee mode above applies: buyback & lock, or creator fees to a wallet you choose."],
                ["Stock Treasury — The Wall", "Needs a stock as the paired market. Creator fees are claimed (by anyone) into a treasury that holds the stock and never sells it. A configured share of each claim (default 30%) streams to stakers of the token over 7 days, paid in the stock. The rest is a standing bid under book value: while the token is on its curve, a keeper may buy and burn when spot trades under book value × (1 + margin), within a daily budget. Book value = pile ÷ circulating supply, both read on-chain."],
                ["Proof-of-Fee", "Creator fees buy the token back on its own curve. Each round (1 minute to 24 hours), the buyback is paid to the traders whose fees funded it, by share of quote spent through the official PoF router (\"Work\"). Direct curve buys and all sells earn no Work. Under-subscribed rounds pay out pro-rata and the rest rolls forward. Nothing is minted."],
              ]}
            />
            <div className="panel" style={{ marginTop: 12 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>What is and is not promised</h3>
              <p style={{ color: "var(--fg-dim)", margin: 0 }}>
                The Wall is a bid funded by fees, not a guarantee: it can only spend what fees have put in the pile, at most the
                daily budget, and only while the token is on its curve. Book value is not a price floor. Proof-of-Fee rewards can
                never exceed what fees actually bought back; a round with no fees pays nothing. Staking rewards are fees actually
                collected; the rate changes with every claim and is not an APY. On testnet the stock assets are stand-ins with no
                redemption. Everything on a token page is read from that launch&apos;s own contracts, and a dash means unknown, never zero.
              </p>
            </div>
          </section>

          <section id="auto-buy">
            <h2>Auto-buy</h2>
            <div className="panel">
              <p style={{ color: "var(--fg-dim)", margin: 0 }}>
                Any curve token&apos;s page can schedule buys through the <strong>RadianExecutor</strong>. You deposit the quote asset
                (and native USDC for gas when the quote is an ERC-20) into the executor, then sign one EIP-712 message that caps
                the amount per buy, the interval, the number of buys, the maximum gas price and an expiry. A keeper run by the
                indexer executes the buys on that schedule; tokens always land in your wallet. The fee is 0.5% of quote actually
                spent (a contract constant) plus a gas stipend of 300,000 gas × min(gas price, your cap) per buy, both taken from
                your deposit. Withdrawing your deposit and cancelling every schedule are plain transactions that need nobody&apos;s
                cooperation. The keeper cannot exceed the caps you signed, and it cannot move funds anywhere but into a buy of the
                token you named.
              </p>
            </div>
          </section>

          <section id="anti-snipe">
            <h2>Anti-snipe</h2>
            <div className="panel">
              <p style={{ color: "var(--fg-dim)", margin: 0 }}>
                For the first ~15 seconds after launch, a decaying tax (99% → 0%) applies to non-exempt
                buyers on the quote leg, so a launch can&apos;t be sniped in its opening block. The
                creator and their declared wallets are exempt; the tax lifts automatically.
              </p>
            </div>
          </section>

          <section id="fees">
            <h2>Fees & the buyback flywheel</h2>
            <Table
              head={["Leg", "Where it goes"]}
              rows={[
                ["Trade fee", "1% of every swap, on the quote-asset leg, before and after graduation"],
                ["Protocol", "30% of the fee — to the protocol recipient via escrow"],
                ["Creator", "70% of the fee — to the fee escrow, claimable anytime (35% when Buyback & Lock is on)"],
                ["Buyback", "In Buyback & Lock mode, the other 35% buys the token back when the platform sweeps fees and vests it over 5 years (70% creator / 30% protocol)"],
                ["Creator tax", "Optional, up to 10%, paid 100% to the creator on top of the base fee"],
              ]}
            />
          </section>

          <section id="contracts">
            <h2>Contracts</h2>
            <p style={{ color: "var(--fg-dim)", marginTop: 6, marginBottom: 12 }}>
              Addresses below are for {net.chainName} (chain {net.chainId}); switch network to see another chain.
              Runtime code hashes are pinned and re-checked on every visit (see Verify). Verification proves
              source = bytecode; it is not an audit.
            </p>
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              {[
                ["LaunchFactory", RADIAN.factory],
                ["MemeHook (Uniswap V4)", RADIAN.hook],
                ["BuybackVault", RADIAN.vault],
                ["LaunchLocker", RADIAN.locker],
                ["FeeEscrow", RADIAN.escrow],
                ["PoolManager (Uniswap V4)", RADIAN.poolManager],
                ["LaunchRouter (templates)", RADIAN.router],
                ["PoFRouter", RADIAN.pofRouter],
                ["RadianExecutor (auto-buy)", RADIAN.executor],
              ].map(([label, a]) => (
                <div key={a} className="kv" style={{ padding: "13px 20px" }}>
                  <span>{label}</span>
                  <a className="v mono" href={addr(a)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
                    {a.slice(0, 10)}…{a.slice(-8)}
                  </a>
                </div>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 12, marginBottom: 60 }}>
              Native gas token is USDC (18-decimal msg.value). Not affiliated with Circle, Robinhood, or Pons-Labs.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
