"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUnits, parseEther, parseUnits, decodeEventLog } from "viem";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { publicClient, RADIAN, factoryAbi, curveAbi, erc20Abi, arcTestnet, activeNetwork, QUOTE_ASSETS, type QuoteAsset } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { addLocalLaunch } from "@/lib/registry";
import { INDEXER_URL, hasIndexer } from "@/lib/indexer";

const LAUNCH_FEE = parseEther("1"); // 1 USDC

export default function LaunchPage() {
  useReveal();
  const router = useRouter();
  const { authenticated, login, getWalletClient } = useRadianWallet();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [logo, setLogo] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [devBuy, setDevBuy] = useState("");
  const [quote, setQuote] = useState<QuoteAsset>(QUOTE_ASSETS[0]);
  const [feeMode, setFeeMode] = useState<"buyback" | "creator">("buyback");
  const [creatorTax, setCreatorTax] = useState("0");
  const [feeRecipient, setFeeRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const FEE_MODES = [
    { id: "buyback", icon: "🔥", title: "Buyback & Lock", desc: "Route the fee's buyback share into buying the token back and locking it in the 5-year vault.", live: true },
    { id: "creator", icon: "👤", title: "Creator Fees", desc: "Send the creator fee (plus an optional creator tax) to a wallet you choose.", live: true },
    { id: "holder", icon: "👥", title: "Holder Rewards", desc: "Distribute quote fees to holders automatically. Needs a contract upgrade.", live: false },
    { id: "sharing", icon: "🤝", title: "Fee Sharing", desc: "Split quote fees across up to five wallets. Needs a contract upgrade.", live: false },
  ] as const;

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!hasIndexer()) {
      setToast("Image upload needs the indexer; paste a URL instead.");
      return;
    }
    if (file.size > 2_000_000) {
      setToast("Image too large (max 2MB).");
      return;
    }
    setUploading(true);
    try {
      const r = await fetch(`${INDEXER_URL}/upload`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const j = await r.json();
      if (j.url) setLogo(j.url);
      else setToast(j.error ?? "Upload failed.");
    } catch {
      setToast("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function launch() {
    if (!activeNetwork.live) {
      setToast("Radian mainnet launches September 16. Switch to Testnet to launch now.");
      return;
    }
    if (!authenticated) {
      login();
      return;
    }
    if (!name.trim() || !symbol.trim()) {
      setToast("Name and symbol are required.");
      return;
    }
    setBusy(true);
    try {
      const wc = await getWalletClient();
      if (!wc) {
        setToast("No wallet available. Sign in again.");
        setBusy(false);
        return;
      }
      const { client, account } = wc;
      const salt = ("0x" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")) as `0x${string}`;

      setToast("Confirm the launch in your wallet…");
      const hash = await client.writeContract({
        account,
        chain: arcTestnet,
        address: RADIAN.factory,
        abi: factoryAbi,
        functionName: "launchToken",
        args: [
          {
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            logo: logo.trim(),
            description: description.trim(),
            socials: {
              twitter: twitter.trim(),
              telegram: "",
              discord: "",
              website: website.trim(),
              farcaster: "",
            },
            creatorFeeRecipient: (feeMode === "creator" && /^0x[a-fA-F0-9]{40}$/.test(feeRecipient.trim())
              ? feeRecipient.trim()
              : account) as `0x${string}`,
            creatorTaxBps: feeMode === "creator" ? Math.round(Math.min(10, Math.max(0, Number(creatorTax) || 0)) * 100) : 0,
            buybackEnabled: feeMode === "buyback",
            expectedEconomics: "0x0000000000000000000000000000000000000000000000000000000000000000",
            salt,
          },
          0n,
          quote.address,
        ],
        value: LAUNCH_FEE,
      });

      setToast("Launching… waiting for confirmation.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // find the new token + curve from the TokenLaunched event in our own receipt
      let tokenAddr: string | null = null;
      let curveAddr: string | null = null;
      let gthr = "20000000000000000000";
      for (const log of receipt.logs) {
        try {
          const parsed = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (parsed.eventName === "TokenLaunched") {
            const a = parsed.args as any;
            tokenAddr = a.token;
            curveAddr = a.curve;
            gthr = (a.graduationThreshold as bigint).toString();
            break;
          }
        } catch {}
      }
      // Save to the in-browser registry so it shows up immediately (Arc's
      // getLogs is unreliable; an indexer replaces this in Phase 4b).
      if (tokenAddr && curveAddr) {
        addLocalLaunch({
          token: tokenAddr as `0x${string}`,
          curve: curveAddr as `0x${string}`,
          deployer: account,
          graduationThreshold: gthr,
        });
      }

      // Optional dev buy: creator seeds the first buy on the new curve. The
      // creator is snipe-tax-exempt, so this settles untaxed. For a native-USDC
      // curve the amount rides msg.value; for an ERC-20 quote (EURC) we approve
      // the curve to pull it, then buy with no value.
      const dev = Number(devBuy);
      if (curveAddr && dev > 0) {
        const buyAmt = parseUnits(devBuy, quote.decimals);
        if (quote.native) {
          setToast("Confirm your first buy…");
          const bh = await client.writeContract({
            account, chain: arcTestnet, address: curveAddr as `0x${string}`, abi: curveAbi,
            functionName: "buy", args: [buyAmt, 0n, account], value: buyAmt,
          });
          await publicClient.waitForTransactionReceipt({ hash: bh });
        } else {
          setToast(`Approve ${quote.symbol}…`);
          const ah = await client.writeContract({
            account, chain: arcTestnet, address: quote.address, abi: erc20Abi,
            functionName: "approve", args: [curveAddr as `0x${string}`, buyAmt],
          });
          await publicClient.waitForTransactionReceipt({ hash: ah });
          setToast("Confirm your first buy…");
          const bh = await client.writeContract({
            account, chain: arcTestnet, address: curveAddr as `0x${string}`, abi: curveAbi,
            functionName: "buy", args: [buyAmt, 0n, account],
          });
          await publicClient.waitForTransactionReceipt({ hash: bh });
        }
      }

      setToast("Launched! Redirecting…");
      if (tokenAddr) router.push(`/token/${tokenAddr}`);
      else router.push("/#explore");
    } catch (e: any) {
      setToast(e?.shortMessage ?? e?.message ?? "Launch failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: "48px 24px 0", maxWidth: 640 }}>
        <div className="reveal">
          <h1 style={{ fontSize: 34 }}>Launch a token</h1>
          <p style={{ color: "var(--fg-dim)", marginTop: 10 }}>
            One transaction. Fixed 1B supply, priced in native USDC, liquidity locked forever.
            Launch fee {formatUnits(LAUNCH_FEE, 18)} USDC.
          </p>
        </div>

        <div className="panel reveal" data-reveal-delay={100} style={{ marginTop: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="field">
              <label>Name *</label>
              <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Arc Doge" />
            </div>
            <div className="field">
              <label>Symbol *</label>
              <input className="input" value={symbol} maxLength={10} onChange={(e) => setSymbol(e.target.value)} placeholder="ADOGE" />
            </div>
          </div>
          <div className="field">
            <label>Token image <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>.png .jpeg .webp .gif</span></label>
            <label className="filepick" style={{ cursor: uploading ? "wait" : "pointer" }}>
              <span className="filepick-box">
                {logo && /^https?:\/\//.test(logo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="logo" />
                ) : uploading ? (
                  <span className="spinner" />
                ) : (
                  "+"
                )}
              </span>
              <span className="filepick-label">
                {uploading ? "Uploading…" : logo ? "Change file…" : "Choose file…"}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={(e) => onPickImage(e.target.files?.[0])}
              />
            </label>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea className="textarea" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} placeholder="What's the story?" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div className="field">
              <label>Website</label>
              <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
            <div className="field">
              <label>Twitter / X</label>
              <input className="input" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="@handle" />
            </div>
          </div>

          <div className="field">
            <label>First buy (optional)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.1"
              value={devBuy}
              onChange={(e) => setDevBuy(e.target.value)}
              placeholder="0"
            />
            <p className="hint">
              Buy your own token right after launch, in the same flow (untaxed — you&apos;re the
              creator). Sets the opening price and shows conviction. Amount in {quote.symbol}.
            </p>
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 18px" }} />

          <div className="field">
            <label>Paired market</label>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              The asset your token is priced and traded in. Graduation seeds a locked pool paired
              with it.
            </p>
            <div className="feemode-grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
              {QUOTE_ASSETS.map((qa) => {
                const on = quote.key === qa.key;
                return (
                  <button
                    key={qa.key}
                    type="button"
                    onClick={() => setQuote(qa)}
                    className={`feemode-card${on ? " on" : ""}`}
                  >
                    <span className="fm-title">{qa.symbol}</span>
                    <span className="fm-desc">{qa.blurb}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 18px" }} />

          <div className="field">
            <label>Fee mode</label>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              How the quote-asset fee is used. Snapshotted on-chain at launch.
            </p>
            <div className="feemode-grid">
              {FEE_MODES.map((m) => {
                const on = feeMode === (m.id as any);
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.live}
                    onClick={() => m.live && setFeeMode(m.id as "buyback" | "creator")}
                    className={`feemode-card${on ? " on" : ""}${!m.live ? " soon" : ""}`}
                  >
                    <span style={{ fontSize: 18 }}>{m.icon}</span>
                    <span className="fm-title">
                      {m.title}
                      {!m.live && <span className="fm-soon">Soon</span>}
                    </span>
                    <span className="fm-desc">{m.desc}</span>
                  </button>
                );
              })}
            </div>
            {feeMode === "creator" && (
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12 }}>Creator tax %</label>
                  <input className="input" type="number" min="0" max="10" step="0.5" value={creatorTax} onChange={(e) => setCreatorTax(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 12 }}>Fee recipient (optional)</label>
                  <input className="input mono" style={{ fontSize: 12 }} value={feeRecipient} onChange={(e) => setFeeRecipient(e.target.value)} placeholder="0x… (defaults to you)" />
                </div>
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 16px" }} />
          <div className="kv"><span>Quote asset</span><span className="v">{quote.native ? "Native USDC" : quote.symbol}</span></div>
          <div className="kv"><span>Supply</span><span className="v">1,000,000,000</span></div>
          <div className="kv"><span>Graduation goal</span><span className="v">20 {quote.symbol} in curve</span></div>
          <div className="kv"><span>First buy</span><span className="v">{devBuy && Number(devBuy) > 0 ? `${devBuy} ${quote.symbol}` : "—"}</span></div>
          <div className="kv"><span>Trade fee</span><span className="v">1% (50% to you)</span></div>

          <button className="btn btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "center" }} onClick={launch} disabled={busy}>
            {busy ? <span className="spinner" /> : authenticated ? "Launch for 1 USDC" : "Sign in to launch"}
          </button>
          <p className="hint" style={{ textAlign: "center" }}>
            Need testnet USDC?{" "}
            <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
              Circle faucet →
            </a>
          </p>
        </div>
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
