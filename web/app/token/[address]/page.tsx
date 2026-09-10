"use client";
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits, parseEther, type Address } from "viem";
import { Nav } from "@/components/Nav";
import { TradePanel } from "@/components/TradePanel";
import { publicClient, curveAbi, tokenAbi, explorer, arcTestnet } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { findCurve } from "@/lib/registry";

type State = {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  curve: Address;
  quoteReserve: bigint;
  tokenReserve: bigint;
  trackedQuote: bigint;
  graduationThreshold: bigint;
  graduated: boolean;
  sellable: bigint;
};

export default function TokenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const token = address as Address;
  const { authenticated, login, address: account, getWalletClient } = useRadianWallet();
  const [st, setSt] = useState<State | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [myTokens, setMyTokens] = useState<bigint>(0n);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    // curve address comes from the registry (getLogs is unreliable on Arc)
    const curve = (findCurve(token)?.curve ?? null) as Address | null;
    if (!curve) return;
    const [name, symbol, logo, description, reserves, tracked, gthr, grad, sellable] =
      await Promise.all([
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "name" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "symbol" }),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "logo" }).catch(() => ""),
        publicClient.readContract({ address: token, abi: tokenAbi, functionName: "description" }).catch(() => ""),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "getReserves" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "trackedQuote" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduationThreshold" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "graduated" }),
        publicClient.readContract({ address: curve, abi: curveAbi, functionName: "sellableTokens" }).catch(() => 0n),
      ]);
    const r = reserves as [bigint, bigint];
    setSt({
      name: name as string,
      symbol: symbol as string,
      logo: logo as string,
      description: description as string,
      curve,
      quoteReserve: r[0],
      tokenReserve: r[1],
      trackedQuote: tracked as bigint,
      graduationThreshold: gthr as bigint,
      graduated: grad as boolean,
      sellable: sellable as bigint,
    });
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!account) return;
    publicClient
      .readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [account] })
      .then((b) => setMyTokens(b as bigint));
  }, [account, token, st]);

  // constant-product preview against live reserves (net of 1% fee)
  const preview = (() => {
    if (!st || !amount || Number(amount) <= 0) return null;
    try {
      const feeBps = 100n;
      if (side === "buy") {
        const inWei = parseEther(amount);
        const net = (inWei * (10000n - feeBps)) / 10000n;
        const out = (st.tokenReserve * net) / (st.quoteReserve + net);
        return `${Number(formatUnits(out, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${st.symbol}`;
      } else {
        const inTok = parseEther(amount);
        const gross = (st.quoteReserve * inTok) / (st.tokenReserve + inTok);
        const out = (gross * (10000n - feeBps)) / 10000n;
        return `${Number(formatUnits(out, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC`;
      }
    } catch {
      return null;
    }
  })();

  async function trade() {
    if (!authenticated) {
      login();
      return;
    }
    if (!st || !amount || Number(amount) <= 0) return;
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) {
        setToast("No wallet available. Sign in again.");
        setBusy(false);
        return;
      }
      const { client, account: acct } = wc;
      if (side === "buy") {
        const inWei = parseEther(amount);
        setToast("Confirm buy…");
        const hash = await client.writeContract({
          account: acct,
          chain: arcTestnet,
          address: st.curve,
          abi: curveAbi,
          functionName: "buy",
          args: [inWei, 0n, acct],
          value: inWei,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setToast("Bought ✓");
      } else {
        const inTok = parseEther(amount);
        setToast("Approve…");
        const ah = await client.writeContract({
          account: acct,
          chain: arcTestnet,
          address: token,
          abi: tokenAbi,
          functionName: "approve",
          args: [st.curve, inTok],
        });
        await publicClient.waitForTransactionReceipt({ hash: ah });
        setToast("Confirm sell…");
        const hash = await client.writeContract({
          account: acct,
          chain: arcTestnet,
          address: st.curve,
          abi: curveAbi,
          functionName: "sell",
          args: [inTok, 0n, acct],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        setToast("Sold ✓");
      }
      setAmount("");
      await load();
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? "Trade failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!st) {
    return (
      <>
        <Nav />
        <main className="wrap" style={{ padding: 60 }}>
          <div className="empty">Loading token…</div>
        </main>
      </>
    );
  }

  const pct = st.graduationThreshold > 0n
    ? Math.min(100, Number((st.trackedQuote * 10000n) / st.graduationThreshold) / 100)
    : 0;
  const price = st.tokenReserve > 0n
    ? Number(formatUnits(st.quoteReserve, 18)) / Number(formatUnits(st.tokenReserve, 18))
    : 0;

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "40px 24px 0" }}>
        <Link href="/#explore" style={{ color: "var(--fg-faint)", fontSize: 14 }}>← All launches</Link>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 28, marginTop: 20, alignItems: "start" }} className="detail-grid">
          <div>
            <div className="card-top" style={{ gap: 16 }}>
              <div className="avatar" style={{ width: 64, height: 64, fontSize: 24 }}>
                {st.logo && /^https?:\/\//.test(st.logo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={st.logo} alt={st.symbol} />
                ) : (
                  st.symbol.slice(0, 2).toUpperCase()
                )}
              </div>
              <div>
                <h1 style={{ fontSize: 28 }}>{st.name}</h1>
                <div style={{ color: "var(--fg-faint)" }}>${st.symbol}</div>
              </div>
              <span className={`badge ${st.graduated ? "badge-grad" : "badge-live"}`} style={{ marginLeft: "auto" }}>
                {st.graduated ? "Graduated" : "Live on curve"}
              </span>
            </div>

            <p style={{ color: "var(--fg-dim)", marginTop: 18 }}>{st.description || "A token launched on Radian."}</p>

            <div className="panel" style={{ marginTop: 22 }}>
              <div className="prog-row"><span>Bonding progress</span><span>{pct.toFixed(1)}%</span></div>
              <div className="prog"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
              <div className="prog-row" style={{ marginTop: 8, marginBottom: 0 }}>
                <span>{Number(formatUnits(st.trackedQuote, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC in curve</span>
                <span>goal {Number(formatUnits(st.graduationThreshold, 18)).toLocaleString()} USDC</span>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <div className="kv"><span>Spot price</span><span className="v">{price.toExponential(3)} USDC</span></div>
              <div className="kv"><span>Curve reserve</span><span className="v">{Number(formatUnits(st.quoteReserve, 18)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</span></div>
              <div className="kv"><span>Sellable supply</span><span className="v">{Number(formatUnits(st.sellable, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
              <div className="kv"><span>Token</span><a className="v mono" href={explorer.address(token)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{token.slice(0, 8)}…{token.slice(-6)}</a></div>
              <div className="kv"><span>Curve</span><a className="v mono" href={explorer.address(st.curve)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{st.curve.slice(0, 8)}…{st.curve.slice(-6)}</a></div>
            </div>

            <TradePanel token={token} symbol={st.symbol} />
          </div>

          <div className="panel" style={{ position: "sticky", top: 84 }}>
            {st.graduated ? (
              <div style={{ textAlign: "center", padding: "14px 0" }}>
                <div className="badge badge-grad" style={{ display: "inline-block" }}>Graduated</div>
                <p style={{ color: "var(--fg-dim)", fontSize: 14, marginTop: 14 }}>
                  This token has graduated into a locked Uniswap V4 pool. Curve trading is closed;
                  trade it on the V4 market.
                </p>
              </div>
            ) : (
              <>
                <div className="seg" style={{ marginBottom: 16 }}>
                  <button className={side === "buy" ? "on-buy" : ""} onClick={() => setSide("buy")}>Buy</button>
                  <button className={side === "sell" ? "on-sell" : ""} onClick={() => setSide("sell")}>Sell</button>
                </div>
                <div className="field">
                  <label>{side === "buy" ? "You pay (USDC)" : `You sell (${st.symbol})`}</label>
                  <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
                  {side === "sell" && (
                    <p className="hint">Balance: {Number(formatUnits(myTokens, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {st.symbol}</p>
                  )}
                </div>
                {preview && (
                  <div className="kv" style={{ marginBottom: 12 }}>
                    <span>You receive ≈</span>
                    <span className="v">{preview}</span>
                  </div>
                )}
                <button
                  className={`btn ${side === "buy" ? "btn-primary" : "btn-ghost"}`}
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={trade}
                  disabled={busy}
                >
                  {busy ? <span className="spinner" /> : !authenticated ? "Sign in to trade" : side === "buy" ? "Buy" : "Sell"}
                </button>
                <p className="hint" style={{ textAlign: "center" }}>1% fee · slippage unguarded on testnet</p>
              </>
            )}
          </div>
        </div>
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
