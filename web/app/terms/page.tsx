"use client";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { useNetwork, isTestnet } from "@/lib/networks";

// Plain-language terms and risk disclosure. Facts only; nothing here is a promise.
export default function TermsPage() {
  const net = useNetwork();
  const sections: { h: string; p: string[] }[] = [
    {
      h: "What Radian is",
      p: [
        "Radian is a website that lets you interact with smart contracts on public blockchains: a token factory, bonding curves, Uniswap V4 pools and a few optional add-on contracts. Your wallet signs every transaction. Radian never holds your funds and cannot reverse a transaction.",
        "The contracts are listed with their addresses and pinned code hashes on the Verify and Factory pages. The site refuses to launch or trade if the live code does not match those hashes.",
      ],
    },
    {
      h: "Not audited",
      p: [
        "The trading engine is a source-identical port of a verified upstream launchpad. The Radian-specific contracts (launch router, launch templates, delegated buys, The Pound's vault and burner) have been reviewed internally but have not been audited by an external firm. Bugs can exist. Do not put in money you cannot afford to lose.",
      ],
    },
    {
      h: "Risks you take",
      p: [
        "Tokens launched here can lose all their value. Most will. Nothing on this site is a recommendation to buy or sell anything.",
        "A token's quote asset is another on-chain asset (a stablecoin, the gas coin, or a tokenized stock). If that asset's issuer pauses, upgrades or restricts it, curves priced in it can stop working until the issuer acts. Tokenized stocks are subject to their issuer's own rules and regional restrictions; you are responsible for being allowed to hold them where you live.",
        "Prices on a bonding curve move with every trade. Early buys pay a snipe tax that decays over seconds. Graduation into a Uniswap V4 pool changes how price is set. A creator can add a fee on trades; it is shown before you trade.",
        "Wallet security is yours. Radian cannot recover a lost key or a signed transaction.",
      ],
    },
    {
      h: "Fees",
      p: [
        "A fixed launch fee and a percentage fee on every curve trade are charged by the contracts and shown on the Factory page for the current network. Part of the trade fee goes to the protocol, the rest to the token's creator or to the template the creator chose.",
      ],
    },
    {
      h: "No warranty, your responsibility",
      p: [
        "The site and contracts are provided as they are, without warranties of any kind. You use them at your own risk and you are responsible for complying with the laws that apply to you, including tax and securities rules. If you are not allowed to use a service like this where you live, do not use it.",
        "Radian is not affiliated with Circle, Robinhood, Uniswap or Pons-Labs. Their trademarks belong to them.",
      ],
    },
  ];
  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 60px", maxWidth: 820 }}>
        <span className="eyebrow">◆ Terms &amp; risks</span>
        <h1 style={{ fontSize: 34, marginTop: 14 }}>Read this before you trade.</h1>
        <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
          Network: <strong>{net.label}</strong>.{" "}
          {isTestnet(net)
            ? "This is a testnet: no real money, and the stock quote assets are stand-ins."
            : "This is a live network with real assets."}
        </p>
        {sections.map((sct) => (
          <section key={sct.h} className="panel" style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 18, marginBottom: 8 }}>{sct.h}</h3>
            {sct.p.map((t, i) => (
              <p key={i} style={{ color: "var(--fg-dim)", marginTop: 8, lineHeight: 1.6 }}>{t}</p>
            ))}
          </section>
        ))}
        <p className="hint" style={{ marginTop: 18 }}>
          Contract addresses and live checks: <Link href="/verify" style={{ color: "var(--radian-2)" }}>Verify</Link> ·{" "}
          <Link href="/factory" style={{ color: "var(--radian-2)" }}>Factory</Link>
        </p>
      </main>
    </>
  );
}
