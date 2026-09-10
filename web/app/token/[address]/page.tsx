"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatUnits, isAddress, parseEther, type Address } from "viem";
import { Nav } from "@/components/Nav";
import { TradePanel } from "@/components/TradePanel";
import { StockRef } from "@/components/StockRef";
import { publicClient, curveAbi, tokenAbi, erc20Abi, explorer, arcTestnet, quoteByAddress, type QuoteAsset } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { findCurve } from "@/lib/registry";
import { fetchTokenMeta, hasIndexer, type Sunset } from "@/lib/indexer";
import { projectLinks, safeHttpUrl, xUrl } from "@/lib/projects";
import { parseUnits } from "viem";

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
  quoteDecimals: number;
  quoteSymbol: string;
  pairToken: Address;
  native: boolean;
  quoteAsset: QuoteAsset;
  // fee policy frozen at launch — mirrored here so the preview matches the contract
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxSeconds: bigint;
  // on-chain socials (creator-supplied; only rendered after URL validation)
  website?: string;
  twitter?: string;
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const BPS = 10000n;
const SLIPPAGE_KEY = "radian.slippageBps";
const SLIPPAGE_OPTIONS = [50, 100, 300] as const;

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
  const [notFound, setNotFound] = useState(false);
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [snipeBps, setSnipeBps] = useState<bigint>(0n);
  const [sunset, setSunset] = useState<Sunset | null>(null);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    // Curve address comes from the local registry (getLogs is unreliable on
    // Arc). If this token wasn't launched in this browser, fall back to the
    // indexer so any token visible on Explore also opens here.
    if (!isAddress(token)) {
      setNotFound(true);
      return;
    }
    let curve = (findCurve(token)?.curve ?? null) as Address | null;
    if (hasIndexer()) {
      // The indexer also knows whether this launch was retired for a successor.
      const meta = await fetchTokenMeta(token);
      if (!curve) curve = meta?.curve ?? null;
      if (meta) setSunset(meta.sunset ?? null);
    }
    if (!curve) {
      // Only declare "not found" if we have never loaded this token; a transient
      // indexer failure must not hide a token that was already on screen.
      if (!loadedRef.current) setNotFound(true);
      return;
    }
    // one Multicall3 batch instead of 10 separate RPC reads (poll-friendly)
    const mc = await publicClient.multicall({
      allowFailure: true,
      contracts: [
        { address: token, abi: tokenAbi, functionName: "name" },
        { address: token, abi: tokenAbi, functionName: "symbol" },
        { address: token, abi: tokenAbi, functionName: "logo" },
        { address: token, abi: tokenAbi, functionName: "description" },
        { address: curve, abi: curveAbi, functionName: "getReserves" },
        { address: curve, abi: curveAbi, functionName: "trackedQuote" },
        { address: curve, abi: curveAbi, functionName: "graduationThreshold" },
        { address: curve, abi: curveAbi, functionName: "graduated" },
        { address: curve, abi: curveAbi, functionName: "sellableTokens" },
        { address: curve, abi: curveAbi, functionName: "pairToken" },
        { address: curve, abi: curveAbi, functionName: "feeBps" },
        { address: curve, abi: curveAbi, functionName: "creatorTaxBps" },
        { address: curve, abi: curveAbi, functionName: "snipeTaxSeconds" },
        { address: token, abi: tokenAbi, functionName: "socials" },
      ],
    });
    const name = mc[0].result as string | undefined;
    const symbol = mc[1].result as string | undefined;
    if (!name || !symbol) {
      if (!loadedRef.current) setNotFound(true);
      return;
    }
    const logo = (mc[2].result as string) ?? "";
    const description = (mc[3].result as string) ?? "";
    const tracked = (mc[5].result as bigint | undefined) ?? 0n;
    const gthr = (mc[6].result as bigint | undefined) ?? 0n;
    const grad = (mc[7].result as boolean | undefined) ?? false;
    const sellable = (mc[8].result as bigint | undefined) ?? 0n;
    const pair = (mc[9].result as Address | undefined) ?? ("0x0000000000000000000000000000000000000000" as Address);
    const r = (mc[4].result as [bigint, bigint] | undefined) ?? [0n, 0n];
    const qa = quoteByAddress(pair as string);
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
      quoteDecimals: qa.decimals,
      quoteSymbol: qa.symbol,
      pairToken: pair as Address,
      native: qa.native,
      quoteAsset: qa,
      feeBps: (mc[10].result as bigint | undefined) ?? 100n,
      creatorTaxBps: (mc[11].result as bigint | undefined) ?? 0n,
      snipeTaxSeconds: (mc[12].result as bigint | undefined) ?? 0n,
      // socials() → [twitter, telegram, discord, website, farcaster]
      website: (mc[13].result as readonly string[] | undefined)?.[3] || undefined,
      twitter: (mc[13].result as readonly string[] | undefined)?.[0] || undefined,
    });
    loadedRef.current = true;
    setNotFound(false);
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

  // Slippage tolerance is a per-viewer preference.
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(SLIPPAGE_KEY));
      if (Number.isFinite(v) && v >= 10 && v <= 5000) setSlippageBps(v);
    } catch {}
  }, []);
  const pickSlippage = (bps: number) => {
    setSlippageBps(bps);
    try {
      window.localStorage.setItem(SLIPPAGE_KEY, String(bps));
    } catch {}
  };

  // The snipe tax (99% at launch, decaying to 0 within `snipeTaxSeconds`) is
  // per-recipient and time-based, so poll it while the curve is live.
  useEffect(() => {
    if (!st || st.graduated) return;
    const curve = st.curve;
    const who = (account ?? ZERO_ADDR) as Address;
    let alive = true;
    const read = async () => {
      try {
        const v = (await publicClient.readContract({
          address: curve, abi: curveAbi, functionName: "currentSnipeTaxBps", args: [who],
        })) as bigint;
        if (alive) setSnipeBps(v);
      } catch {}
    };
    read();
    const t = setInterval(read, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [st?.curve, st?.graduated, account]);

  // Mirrors PonsV2BondingCurve.buy/sell exactly: the base fee, creator tax and
  // (buy only) snipe tax all come off the quote leg before the constant-product
  // swap; a buy is clamped to the sellable allocation. `minOut` is what we hand
  // the contract, which enforces it on-chain (as a price bound on buys).
  const quoteTrade = () => {
    if (!st || !amount || Number(amount) <= 0) return null;
    try {
      if (side === "buy") {
        const inWei = parseUnits(amount, st.quoteDecimals);
        if (inWei <= 0n) return null;
        let snipe = snipeBps;
        if (snipe > 0n) {
          const maxSnipe = BPS - st.feeBps - st.creatorTaxBps - 100n;
          if (snipe > maxSnipe) snipe = maxSnipe;
        }
        const fee = (inWei * st.feeBps) / BPS;
        const tax = (inWei * st.creatorTaxBps) / BPS;
        const snipeTax = (inWei * snipe) / BPS;
        const net = inWei - fee - tax - snipeTax;
        if (net <= 0n) return null;
        let out = (st.tokenReserve * net) / (st.quoteReserve + net);
        if (out > st.sellable) out = st.sellable;
        const minOut = (out * (BPS - BigInt(slippageBps))) / BPS;
        return { out, minOut, fee, tax, snipeTax, snipeBps: snipe, inWei };
      }
      const inTok = parseEther(amount);
      if (inTok <= 0n) return null;
      const gross = (st.quoteReserve * inTok) / (st.tokenReserve + inTok);
      const fee = (gross * st.feeBps) / BPS;
      const tax = (gross * st.creatorTaxBps) / BPS;
      const out = gross - fee - tax;
      const minOut = (out * (BPS - BigInt(slippageBps))) / BPS;
      return { out, minOut, fee, tax, snipeTax: 0n, snipeBps: 0n, inWei: inTok };
    } catch {
      return null;
    }
  };
  const q = quoteTrade();
  const fmtOut = (v: bigint) =>
    side === "buy"
      ? `${Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${st?.symbol ?? ""}`
      : `${Number(formatUnits(v, st?.quoteDecimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${st?.quoteSymbol ?? ""}`;
  const pctOf = (bps: bigint) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 === 0 ? 0 : 2)}%`;

  async function trade() {
    if (!authenticated) {
      login();
      return;
    }
    if (!st || !q) return;
    const minOut = q.minOut;
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
        const inWei = parseUnits(amount, st.quoteDecimals);
        if (st.native) {
          setToast("Confirm buy…");
          const hash = await client.writeContract({
            account: acct, chain: arcTestnet, address: st.curve, abi: curveAbi,
            functionName: "buy", args: [inWei, minOut, acct], value: inWei,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        } else {
          setToast(`Approve ${st.quoteSymbol}…`);
          const ah = await client.writeContract({
            account: acct, chain: arcTestnet, address: st.pairToken, abi: erc20Abi,
            functionName: "approve", args: [st.curve, inWei],
          });
          await publicClient.waitForTransactionReceipt({ hash: ah });
          setToast("Confirm buy…");
          const hash = await client.writeContract({
            account: acct, chain: arcTestnet, address: st.curve, abi: curveAbi,
            functionName: "buy", args: [inWei, minOut, acct],
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }
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
          args: [inTok, minOut, acct],
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
          {notFound ? (
            <div className="empty">
              <div style={{ fontSize: 18, fontWeight: 600 }}>Token not found</div>
              <p style={{ color: "var(--fg-dim)", marginTop: 8 }}>
                {isAddress(token)
                  ? "This address isn't a Radian launch on the current network, or the indexer hasn't seen it yet."
                  : "That isn't a valid token address."}
              </p>
              <Link href="/#explore" className="btn btn-ghost btn-sm" style={{ marginTop: 16, display: "inline-flex" }}>
                Browse launches
              </Link>
            </div>
          ) : (
            <div className="empty">Loading token…</div>
          )}
        </main>
      </>
    );
  }

  const pct = st.graduationThreshold > 0n
    ? Math.min(100, Number((st.trackedQuote * 10000n) / st.graduationThreshold) / 100)
    : 0;
  const price = st.tokenReserve > 0n
    ? Number(formatUnits(st.quoteReserve, st.quoteDecimals)) / Number(formatUnits(st.tokenReserve, 18))
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
                <div style={{ color: "var(--fg-faint)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span>${st.symbol}</span>
                  {(() => {
                    // On-chain socials first (validated to http(s)), then the curated map.
                    const curated = projectLinks(token);
                    const site = safeHttpUrl(st.website) ?? safeHttpUrl(curated?.website);
                    const x = xUrl(st.twitter) ?? xUrl(curated?.twitter);
                    return (
                      <>
                        {site && (
                          <a href={site} target="_blank" rel="noreferrer noopener" style={{ color: "var(--radian-2)", fontSize: 13 }}>
                            Project site ↗
                          </a>
                        )}
                        {x && (
                          <a href={x} target="_blank" rel="noreferrer noopener" style={{ color: "var(--radian-2)", fontSize: 13 }}>
                            X ↗
                          </a>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              <span className={`badge ${sunset ? "badge-soon" : st.graduated ? "badge-grad" : "badge-live"}`} style={{ marginLeft: "auto" }}>
                {sunset ? "Retired" : st.graduated ? "Graduated" : "Live on curve"}
              </span>
            </div>

            {sunset && (
              <div
                role="note"
                style={{
                  marginTop: 18, padding: "12px 14px", borderRadius: 12, fontSize: 14,
                  background: "rgba(111,155,255,0.08)", border: "1px solid rgba(111,155,255,0.3)",
                }}
              >
                <strong>This launch was retired.</strong> {sunset.reason}{" "}
                <Link href={`/token/${sunset.successor}`} style={{ color: "var(--radian-2)", fontWeight: 600 }}>
                  Go to the current version →
                </Link>
              </div>
            )}

            <p style={{ color: "var(--fg-dim)", marginTop: 18 }}>{st.description || "A token launched on Radian."}</p>

            <div className="panel" style={{ marginTop: 22 }}>
              <div className="prog-row"><span>Bonding progress</span><span>{pct.toFixed(1)}%</span></div>
              <div className="prog"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
              <div className="prog-row" style={{ marginTop: 8, marginBottom: 0 }}>
                <span>{Number(formatUnits(st.trackedQuote, st.quoteDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {st.quoteSymbol} in curve</span>
                <span>goal {Number(formatUnits(st.graduationThreshold, st.quoteDecimals)).toLocaleString()} {st.quoteSymbol}</span>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 16 }}>
              <div className="kv"><span>Spot price</span><span className="v">{price.toExponential(3)} {st.quoteSymbol}</span></div>
              <div className="kv"><span>Curve reserve</span><span className="v">{Number(formatUnits(st.quoteReserve, st.quoteDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })} {st.quoteSymbol}</span></div>
              <div className="kv"><span>Sellable supply</span><span className="v">{Number(formatUnits(st.sellable, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
              <div className="kv"><span>Token</span><a className="v mono" href={explorer.address(token)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{token.slice(0, 8)}…{token.slice(-6)}</a></div>
              <div className="kv"><span>Curve</span><a className="v mono" href={explorer.address(st.curve)} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>{st.curve.slice(0, 8)}…{st.curve.slice(-6)}</a></div>
            </div>

            {st.quoteAsset.stock && (
              <div className="panel" style={{ marginTop: 16 }}>
                <StockRef asset={st.quoteAsset} />
              </div>
            )}

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
                  <label>{side === "buy" ? `You pay (${st.quoteSymbol})` : `You sell (${st.symbol})`}</label>
                  <input className="input" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
                  {side === "sell" && (
                    <p className="hint">Balance: {Number(formatUnits(myTokens, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 })} {st.symbol}</p>
                  )}
                </div>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12 }}>Slippage tolerance</label>
                  <div className="seg">
                    {SLIPPAGE_OPTIONS.map((bps) => (
                      <button
                        key={bps}
                        type="button"
                        className={slippageBps === bps ? (side === "buy" ? "on-buy" : "on-sell") : ""}
                        onClick={() => pickSlippage(bps)}
                      >
                        {bps / 100}%
                      </button>
                    ))}
                  </div>
                </div>
                {side === "buy" && snipeBps > 0n && (
                  <div
                    role="alert"
                    style={{
                      background: "rgba(251,113,133,0.1)", border: "1px solid rgba(251,113,133,0.35)",
                      borderRadius: 12, padding: "10px 12px", fontSize: 13, marginBottom: 12,
                    }}
                  >
                    <strong style={{ color: "var(--down)" }}>Snipe tax: {pctOf(q?.snipeBps ?? snipeBps)} right now.</strong>{" "}
                    Buys in the first {st.snipeTaxSeconds.toString()}s after launch pay a tax that decays to 0. Wait a moment, or
                    buy anyway — the estimate below already includes it.
                  </div>
                )}
                {q && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="kv">
                      <span>You receive ≈</span>
                      <span className="v">{fmtOut(q.out)}</span>
                    </div>
                    <div className="kv">
                      <span>Min. received ({slippageBps / 100}% slippage)</span>
                      <span className="v">{fmtOut(q.minOut)}</span>
                    </div>
                    <div className="kv" style={{ fontSize: 12.5 }}>
                      <span>Fees</span>
                      <span className="v" style={{ fontWeight: 500 }}>
                        {pctOf(st.feeBps)} fee
                        {st.creatorTaxBps > 0n ? ` + ${pctOf(st.creatorTaxBps)} creator tax` : ""}
                        {q.snipeTax > 0n ? ` + ${pctOf(q.snipeBps)} snipe tax` : ""}
                      </span>
                    </div>
                  </div>
                )}
                <button
                  className={`btn ${side === "buy" ? "btn-primary" : "btn-ghost"}`}
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={trade}
                  disabled={busy || (authenticated && !q)}
                >
                  {busy ? (
                    <span className="spinner" />
                  ) : !authenticated ? (
                    "Sign in to trade"
                  ) : side === "buy" ? (
                    snipeBps > 0n ? `Buy anyway (${pctOf(q?.snipeBps ?? snipeBps)} snipe tax)` : "Buy"
                  ) : (
                    "Sell"
                  )}
                </button>
                <p className="hint" style={{ textAlign: "center" }}>
                  Min. received is enforced on-chain — the trade reverts instead of filling below it.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
