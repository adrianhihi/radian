"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUnits, parseEther, decodeEventLog } from "viem";
import { Nav } from "@/components/Nav";
import { useReveal } from "@/lib/useReveal";
import { publicClient, RADIAN, factoryAbi, curveAbi, arcTestnet } from "@/lib/radian";
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
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

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
            creatorFeeRecipient: account,
            creatorTaxBps: 0,
            buybackEnabled: true,
            expectedEconomics: "0x0000000000000000000000000000000000000000000000000000000000000000",
            salt,
          },
          0n,
          "0x0000000000000000000000000000000000000000",
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
      // creator is snipe-tax-exempt, so this settles untaxed.
      const dev = Number(devBuy);
      if (curveAddr && dev > 0) {
        setToast("Confirm your first buy…");
        const buyWei = parseEther(devBuy);
        const bh = await client.writeContract({
          account,
          chain: arcTestnet,
          address: curveAddr as `0x${string}`,
          abi: curveAbi,
          functionName: "buy",
          args: [buyWei, 0n, account],
          value: buyWei,
        });
        await publicClient.waitForTransactionReceipt({ hash: bh });
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
            <label>Logo</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label
                className="btn btn-ghost"
                style={{ cursor: uploading ? "wait" : "pointer", flexShrink: 0 }}
              >
                {uploading ? <span className="spinner" /> : logo ? "Change image" : "Upload image"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: "none" }}
                  onChange={(e) => onPickImage(e.target.files?.[0])}
                />
              </label>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="logo" style={{ width: 46, height: 46, borderRadius: 11, objectFit: "cover", border: "1px solid var(--border)" }} />
              ) : (
                <input
                  className="input"
                  value={logo}
                  onChange={(e) => setLogo(e.target.value)}
                  placeholder="…or paste an image URL"
                />
              )}
            </div>
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
              creator). Sets the opening price and shows conviction. Amount in USDC.
            </p>
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 16px" }} />
          <div className="kv"><span>Quote asset</span><span className="v">Native USDC</span></div>
          <div className="kv"><span>Supply</span><span className="v">1,000,000,000</span></div>
          <div className="kv"><span>Graduation goal</span><span className="v">20 USDC in curve</span></div>
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
