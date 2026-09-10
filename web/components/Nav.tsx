"use client";
import Link from "next/link";
import { useState } from "react";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { NetworkSwitcher } from "./NetworkSwitcher";

const LINKS = [
  { href: "/#explore", label: "Explore" },
  { href: "/live", label: "Live" },
  { href: "/stats", label: "Stats" },
  { href: "/launch", label: "Launch" },
  { href: "/builders", label: "Builders" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/docs", label: "Docs" },
];

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" fill="none">
      <defs>
        <linearGradient id="rg" x1="0" y1="0" x2="40" y2="40">
          <stop stopColor="#4f7cff" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" stroke="url(#rg)" strokeWidth="2.5" opacity="0.35" />
      <path d="M20 4 A16 16 0 0 1 34.9 14.7" stroke="url(#rg)" strokeWidth="3.4" strokeLinecap="round" />
      <line x1="20" y1="20" x2="20" y2="4" stroke="url(#rg)" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="20" y1="20" x2="34.9" y2="14.7" stroke="url(#rg)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="20" cy="20" r="2.6" fill="#4f7cff" />
    </svg>
  );
}

export function Nav() {
  const { ready, authenticated, login, logout, address } = useRadianWallet();

  const [open, setOpen] = useState(false);

  const authBtn = !ready ? (
    <button className="btn btn-ghost" disabled>…</button>
  ) : authenticated ? (
    <button className="btn btn-ghost" onClick={logout} title="Log out">
      {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Account"}
    </button>
  ) : (
    <button className="btn btn-primary" onClick={login}>Sign in</button>
  );

  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <BrandMark />
          Radian
        </Link>
        <div className="nav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
          <NetworkSwitcher />
          {authBtn}
        </div>
        <div className="nav-mobile">
          {authBtn}
          <button className="nav-burger" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
      {open && (
        <div className="nav-drawer">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>
          ))}
          <div style={{ padding: "8px 12px 2px" }}>
            <NetworkSwitcher />
          </div>
        </div>
      )}
    </nav>
  );
}
