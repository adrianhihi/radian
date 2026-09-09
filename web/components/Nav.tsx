"use client";
import Link from "next/link";
import { useRadianWallet } from "@/lib/useRadianWallet";

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

  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="brand">
          <BrandMark />
          Radian
        </Link>
        <div className="nav-links">
          <Link href="/#explore">Explore</Link>
          <Link href="/live">Live</Link>
          <Link href="/stats">Stats</Link>
          <Link href="/launch">Launch</Link>
          <Link href="/builders">Builders</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/docs">Docs</Link>
          {!ready ? (
            <button className="btn btn-ghost" disabled>
              …
            </button>
          ) : authenticated ? (
            <button className="btn btn-ghost" onClick={logout} title="Log out">
              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Account"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={login}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
