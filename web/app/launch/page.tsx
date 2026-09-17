"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatUnits, parseEther, parseUnits, decodeEventLog } from "viem";
import { Nav } from "@/components/Nav";
import { StockTag, StockRef } from "@/components/StockRef";
import { useReveal } from "@/lib/useReveal";
import { useNetwork } from "@/lib/networks";
import { factoryStateAbi } from "@/lib/factory";
import { publicClient, RADIAN, factoryAbi, routerAbi, hasLaunchRouter, curveAbi, erc20Abi, arcTestnet, activeNetwork, QUOTE_ASSETS, type QuoteAsset } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { addLocalLaunch } from "@/lib/registry";
import { INDEXER_URL, hasIndexer } from "@/lib/indexer";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import {
  WALL_DEFAULTS, WALL_BOUNDS, POF_DEFAULTS, POF_BOUNDS, buildWallConfig, buildPoFConfig,
  type WallConfigInput, type PoFConfigInput,
} from "@/lib/templates";

// Display default until the factory's current launchFee() is read on mount —
// the owner can change the fee, and a hardcoded value would make every launch revert.
const DEFAULT_LAUNCH_FEE = parseEther("1");
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// Launch templates. Standard keeps the fee-mode choice; the other two route
// the creator-fee share into a per-launch contract through the router, which
// forces creator-fee mode with that contract as recipient.
type TemplateId = "standard" | "wall" | "pof";
const TEMPLATES: { id: TemplateId; icon: string; title: string; desc: string }[] = [
  { id: "standard", icon: "◆", title: "Standard", desc: "Fees follow the fee mode you pick below: buyback & lock, or straight to a wallet you choose." },
  { id: "wall", icon: "🧱", title: "Stock Treasury — The Wall", desc: "Creator fees build a pile of the stock that is never sold. Part of each claim streams to stakers; the rest keeps a standing bid under book value on the curve. Needs a stock as the paired market." },
  { id: "pof", icon: "⚙️", title: "Proof-of-Fee", desc: "Creator fees buy the token back. Each round, the buyback is paid to the traders whose fees funded it, by share of quote spent through the official router. Nothing is minted." },
];

// The new token + curve from the TokenLaunched event in a receipt.
function decodeLaunch(logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[]) {
  for (const log of logs) {
    try {
      const parsed = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (parsed.eventName === "TokenLaunched") {
        const a = parsed.args as any;
        return { token: a.token as `0x${string}`, curve: a.curve as `0x${string}`, gthr: (a.graduationThreshold as bigint).toString() };
      }
    } catch {}
  }
  return null;
}

export default function LaunchPage() {
  useReveal();
  const router = useRouter();
  // SSR-safe: testnet on the server and the first client render, the real choice after mount —
  // so the quote-asset list never differs between server HTML and hydration.
  const net = useNetwork();
  const { authenticated, login, getWalletClient, address } = useRadianWallet();
  // Launches can be closed on a network (factory.launchEnabled = false) while a few
  // wallets stay whitelisted; the button then says so instead of reverting.
  const [gate, setGate] = useState<{ enabled: boolean | null; can: boolean | null }>({ enabled: null, can: null });
  useEffect(() => {
    let alive = true;
    if (!activeNetwork.live) return;
    (async () => {
      try {
        const enabled = await publicClient.readContract({ address: RADIAN.factory, abi: factoryStateAbi, functionName: "launchEnabled" });
        let can: boolean | null = enabled;
        if (!enabled && address) {
          can = await publicClient.readContract({ address: RADIAN.factory, abi: factoryStateAbi, functionName: "canLaunch", args: [address as `0x${string}`] });
        }
        if (alive) setGate({ enabled, can });
      } catch {
        /* unreadable: leave the gate open, the transaction itself decides */
      }
    })();
    return () => {
      alive = false;
    };
  }, [address]);
  const launchesClosed = gate.enabled === false && gate.can !== true;
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
  const [template, setTemplate] = useState<TemplateId>("standard");
  const [wallCfg, setWallCfg] = useState<WallConfigInput>(WALL_DEFAULTS);
  const [pofCfg, setPofCfg] = useState<PoFConfigInput>(POF_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [launchFee, setLaunchFee] = useState<bigint>(DEFAULT_LAUNCH_FEE);
  const identity = useIdentity();
  const [pendingHash, setPendingHash] = useState<`0x${string}` | null>(null);
  // A launch whose receipt this tab lost (timeout, closed tab) is resolved from
  // chain here and registered locally. It is never resent.
  usePendingResume(["launch"], (p, receipt) => {
    const found = decodeLaunch(receipt.logs);
    if (!found) return;
    addLocalLaunch({
      token: found.token, curve: found.curve,
      deployer: (p.meta?.account ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
      graduationThreshold: found.gthr,
    });
    setPendingHash(null);
    setToast(`Your earlier launch ${p.meta?.symbol ?? ""} confirmed ✓`);
  });

  useEffect(() => {
    if (!activeNetwork.live) return;
    let alive = true;
    publicClient
      .readContract({ address: RADIAN.factory, abi: factoryAbi, functionName: "launchFee" })
      .then((v) => alive && setLaunchFee(v as bigint))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // When the network resolves after mount, make sure the selected quote asset belongs to it.
  useEffect(() => {
    setQuote((q) => net.quoteAssets.find((a) => a.key === q.key) ?? net.quoteAssets.find((a) => a.featured) ?? net.quoteAssets[0]);
  }, [net.key]);

  // Templates go through the router; The Wall also needs a stock quote asset.
  // Rendered from the SSR-safe network hook so server and first client render agree.
  const routerLive = net.contracts.router !== ZERO_ADDR;
  const templatesLive = routerLive && (net.features?.templates ?? true);
  useEffect(() => {
    if (template === "wall" && !quote.stock) setTemplate("standard");
    if (template !== "standard" && !templatesLive) setTemplate("standard");
  }, [quote.stock, templatesLive, template]);

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
      setToast("This network is not live yet. Switch network to launch.");
      return;
    }
    if (launchesClosed) {
      setToast(`Launches on ${activeNetwork.label} are not open yet.`);
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
    if (identity.checked && !identity.ok) {
      setToast("Launching is disabled: a platform contract's live code does not match its pinned hash.");
      return;
    }
    // Template config is validated here against the same bounds the router enforces,
    // so a bad value is a toast, not a reverted launch.
    const viaTemplate = template !== "standard";
    if (viaTemplate && !hasLaunchRouter) {
      setToast("Templates need the launch router, which is not deployed on this network.");
      return;
    }
    if (template === "wall" && !quote.stock) {
      setToast("The Wall needs a stock as the paired market.");
      return;
    }
    const wallBuilt = template === "wall" ? buildWallConfig(wallCfg, quote.decimals) : null;
    if (wallBuilt?.error) {
      setToast(wallBuilt.error);
      return;
    }
    const pofBuilt = template === "pof" ? buildPoFConfig(pofCfg, quote.decimals) : null;
    if (pofBuilt?.error) {
      setToast(pofBuilt.error);
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

      const params = {
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        logo: logo.trim(),
        description: description.trim(),
        socials: { twitter: twitter.trim(), telegram: "", discord: "", website: website.trim(), farcaster: "" },
        // Templates: the router overwrites recipient + buyback mode (fees must reach the
        // treasury / vault), so these are sent as-is and the creator tax stays 0.
        creatorFeeRecipient: (!viaTemplate && feeMode === "creator" && /^0x[a-fA-F0-9]{40}$/.test(feeRecipient.trim())
          ? feeRecipient.trim()
          : account) as `0x${string}`,
        creatorTaxBps: !viaTemplate && feeMode === "creator" ? Math.round(Math.min(10, Math.max(0, Number(creatorTax) || 0)) * 100) : 0,
        buybackEnabled: !viaTemplate && feeMode === "buyback",
        expectedEconomics: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        salt,
      };
      const buyAmt = Number(devBuy) > 0 ? parseUnits(devBuy, quote.decimals) : 0n;
      // With the launch router, launch + first buy is ONE transaction: the factory
      // still attributes the launch to the user (creator fees, snipe-tax exemption)
      // and the opening buy settles in the same block, before anyone else can see
      // the curve. Without a router (mainnet until deployed) fall back to two txs.
      // Templates always go through the router, with or without a first buy.
      const viaRouter = hasLaunchRouter && (buyAmt > 0n || viaTemplate);
      let hash: `0x${string}`;
      if (viaRouter) {
        if (!quote.native && buyAmt > 0n) {
          const allowance = (await publicClient.readContract({
            address: quote.address, abi: erc20Abi, functionName: "allowance", args: [account, RADIAN.router],
          })) as bigint;
          if (allowance < buyAmt) {
            setToast(`Approve ${quote.symbol}…`);
            const ah = await client.writeContract({
              account, chain: arcTestnet, address: quote.address, abi: erc20Abi,
              functionName: "approve", args: [RADIAN.router, buyAmt],
            });
            await waitReceipt(ah, "approve");
            // The wallet may have edited the amount: re-read before spending on it.
            const after = (await publicClient.readContract({
              address: quote.address, abi: erc20Abi, functionName: "allowance", args: [account, RADIAN.router],
            })) as bigint;
            if (after < buyAmt) throw new Error("Your wallet approved a smaller amount, so nothing was launched. Approve the full amount to continue.");
          }
        }
        setToast(buyAmt > 0n ? "Confirm the launch + first buy in your wallet…" : "Confirm the launch in your wallet…");
        // minTokensOut 0 is safe: the buy is atomic with the launch, so the opening
        // price is fixed by the curve config and nothing can trade ahead of it.
        const value = launchFee + (quote.native ? buyAmt : 0n);
        if (wallBuilt?.cfg) {
          hash = await client.writeContract({
            account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchWall",
            args: [params, 0n, quote.address, buyAmt, 0n, [], wallBuilt.cfg],
            value,
          });
        } else if (pofBuilt?.cfg) {
          hash = await client.writeContract({
            account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchPoF",
            args: [params, 0n, quote.address, buyAmt, 0n, [], pofBuilt.cfg],
            value,
          });
        } else {
          hash = await client.writeContract({
            account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchAndBuy",
            args: [params, 0n, quote.address, buyAmt, 0n, []],
            value,
          });
        }
      } else {
        setToast("Confirm the launch in your wallet…");
        hash = await client.writeContract({
          account, chain: arcTestnet, address: RADIAN.factory, abi: factoryAbi, functionName: "launchToken",
          args: [params, 0n, quote.address],
          value: launchFee,
        });
      }

      setToast("Launching… waiting for confirmation.");
      const receipt = await waitReceipt(hash, "launch", { symbol: params.symbol, account });
      const found = decodeLaunch(receipt.logs);
      const tokenAddr: string | null = found?.token ?? null;
      const curveAddr: string | null = found?.curve ?? null;
      // Fallback if the TokenLaunched log can't be decoded: the goal for the chosen
      // quote asset in its own decimals (the indexer overrides this once it has seen the launch).
      const gthr = found?.gthr ?? parseUnits(String(quote.gradGoal), quote.decimals).toString();
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
      if (!viaRouter && curveAddr && buyAmt > 0n) {
        if (quote.native) {
          setToast("Confirm your first buy…");
          const bh = await client.writeContract({
            account, chain: arcTestnet, address: curveAddr as `0x${string}`, abi: curveAbi,
            functionName: "buy", args: [buyAmt, 0n, account], value: buyAmt,
          });
          await waitReceipt(bh, "buy", { token: tokenAddr ?? "" });
        } else {
          setToast(`Approve ${quote.symbol}…`);
          const ah = await client.writeContract({
            account, chain: arcTestnet, address: quote.address, abi: erc20Abi,
            functionName: "approve", args: [curveAddr as `0x${string}`, buyAmt],
          });
          await waitReceipt(ah, "approve");
          setToast("Confirm your first buy…");
          const bh = await client.writeContract({
            account, chain: arcTestnet, address: curveAddr as `0x${string}`, abi: curveAbi,
            functionName: "buy", args: [buyAmt, 0n, account],
          });
          await waitReceipt(bh, "buy", { token: tokenAddr ?? "" });
        }
      }

      setToast("Launched! Redirecting…");
      if (tokenAddr) router.push(`/token/${tokenAddr}`);
      else router.push("/#explore");
    } catch (e: any) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast("Submitted, but not confirmed yet. This page keeps checking and never resends.");
      } else {
        setToast(e?.shortMessage ?? e?.message ?? "Launch failed.");
      }
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
            One transaction. Fixed 1B supply, {quote.stock ? <>priced in <strong>{quote.stock.refSymbol} shares</strong></> : `priced in ${quote.symbol}`}, liquidity locked forever.
            Launch fee {formatUnits(launchFee, 18)} {net.nativeSymbol ?? "USDC"}.
          </p>
        </div>

        <div style={{ marginTop: 20 }}>
          <IdentityBanner identity={identity} />
          <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />
        </div>
        <div className="panel reveal" data-reveal-delay={100} style={{ marginTop: 8 }}>
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
              {net.quoteAssets.map((qa) => {
                const on = quote.key === qa.key;
                return (
                  <button
                    key={qa.key}
                    type="button"
                    onClick={() => setQuote(qa)}
                    className={`feemode-card${on ? " on" : ""}`}
                  >
                    <span className="fm-title">
                      {qa.symbol}
                      {qa.stock && <StockTag standIn={qa.stock.standIn} />}
                    </span>
                    <span className="fm-desc">{qa.blurb}</span>
                  </button>
                );
              })}
            </div>
            {quote.stock && (
              <div style={{ marginTop: 14 }}>
                <StockRef asset={quote} />
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 18px" }} />

          <div className="field">
            <label>Template</label>
            <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
              What the creator-fee share does. Fixed at launch; the treasury or vault is a contract nobody can redirect.
            </p>
            <div className="feemode-grid" style={{ gridTemplateColumns: "1fr" }}>
              {TEMPLATES.map((t) => {
                const on = template === t.id;
                const needsStock = t.id === "wall" && !quote.stock;
                const off = t.id !== "standard" && (!templatesLive || needsStock);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={off}
                    onClick={() => !off && setTemplate(t.id)}
                    className={`feemode-card${on ? " on" : ""}${off ? " soon" : ""}`}
                  >
                    <span style={{ fontSize: 18 }}>{t.icon}</span>
                    <span className="fm-title">
                      {t.title}
                      {off && <span className="fm-soon">{!templatesLive ? "Not on this network yet" : "Pick a stock above"}</span>}
                    </span>
                    <span className="fm-desc">{t.desc}</span>
                  </button>
                );
              })}
            </div>
            {template === "wall" && (
              <div style={{ marginTop: 14 }}>
                <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                  The pile is {quote.symbol}{quote.stock?.standIn ? " (a testnet stand-in)" : ""}. The wall is a standing bid funded by fees — it is not a guarantee, and it only bids while the token is on its curve.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12 }}>Margin % <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≤ {WALL_BOUNDS.marginBpsMax / 100}</span></label>
                    <input className="input" type="number" min="0" max={WALL_BOUNDS.marginBpsMax / 100} step="0.5" value={wallCfg.marginPct} onChange={(e) => setWallCfg({ ...wallCfg, marginPct: e.target.value })} />
                    <p className="hint">Defend when spot is under book value × (1 + margin).</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Daily budget % <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≤ {WALL_BOUNDS.epochBudgetBpsMax / 100}</span></label>
                    <input className="input" type="number" min="0" max={WALL_BOUNDS.epochBudgetBpsMax / 100} step="1" value={wallCfg.budgetPct} onChange={(e) => setWallCfg({ ...wallCfg, budgetPct: e.target.value })} />
                    <p className="hint">Max share of the pile spent per 24h.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Stream to stakers % <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≤ {WALL_BOUNDS.streamBpsMax / 100}</span></label>
                    <input className="input" type="number" min="0" max={WALL_BOUNDS.streamBpsMax / 100} step="1" value={wallCfg.streamPct} onChange={(e) => setWallCfg({ ...wallCfg, streamPct: e.target.value })} />
                    <p className="hint">Share of every fee claim paid to stakers in {quote.symbol}, over 7 days.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Max slippage % <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≤ {WALL_BOUNDS.maxSlippageBpsMax / 100}</span></label>
                    <input className="input" type="number" min="0" max={WALL_BOUNDS.maxSlippageBpsMax / 100} step="0.5" value={wallCfg.slippagePct} onChange={(e) => setWallCfg({ ...wallCfg, slippagePct: e.target.value })} />
                    <p className="hint">Floor on the keeper&apos;s minimum output vs. spot.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Min interval (minutes) <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≥ {WALL_BOUNDS.minIntervalMin / 60}</span></label>
                    <input className="input" type="number" min={WALL_BOUNDS.minIntervalMin / 60} step="1" value={wallCfg.minIntervalMin} onChange={(e) => setWallCfg({ ...wallCfg, minIntervalMin: e.target.value })} />
                    <p className="hint">Between two defends.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Keeper bounty ({quote.symbol})</label>
                    <input className="input" type="number" min="0" step="0.001" value={wallCfg.keeperBounty} onChange={(e) => setWallCfg({ ...wallCfg, keeperBounty: e.target.value })} />
                    <p className="hint">Per successful defend; capped on-chain at 1% of the pile.</p>
                  </div>
                </div>
              </div>
            )}
            {template === "pof" && (
              <div style={{ marginTop: 14 }}>
                <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
                  Only buys through the official PoF router earn Work; direct curve buys and sells earn nothing. Rewards can never exceed what fees actually bought back.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12 }}>Round length (minutes) <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>1–1440</span></label>
                    <input className="input" type="number" min={POF_BOUNDS.roundSecondsMin / 60} max={POF_BOUNDS.roundSecondsMax / 60} step="1" value={pofCfg.roundMin} onChange={(e) => setPofCfg({ ...pofCfg, roundMin: e.target.value })} />
                    <p className="hint">Rounds settle lazily after they end.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Target work per round ({quote.symbol})</label>
                    <input className="input" type="number" min="0" step="0.1" value={pofCfg.targetWork} onChange={(e) => setPofCfg({ ...pofCfg, targetWork: e.target.value })} />
                    <p className="hint">Below this much quote spent in a round, the payout is pro-rated and the rest rolls over.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Buyback cap % of curve reserve <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≤ {POF_BOUNDS.maxBuybackReserveBpsMax / 100}</span></label>
                    <input className="input" type="number" min="0" max={POF_BOUNDS.maxBuybackReserveBpsMax / 100} step="0.5" value={pofCfg.buybackCapPct} onChange={(e) => setPofCfg({ ...pofCfg, buybackCapPct: e.target.value })} />
                    <p className="hint">Per buyback.</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 12 }}>Min interval (minutes) <span style={{ color: "var(--fg-faint)", fontWeight: 400 }}>≥ {POF_BOUNDS.minIntervalMin / 60}</span></label>
                    <input className="input" type="number" min={POF_BOUNDS.minIntervalMin / 60} step="1" value={pofCfg.minIntervalMin} onChange={(e) => setPofCfg({ ...pofCfg, minIntervalMin: e.target.value })} />
                    <p className="hint">Between two buybacks.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 18px" }} />

          {template !== "standard" ? (
            <div className="field">
              <label>Fee mode</label>
              <p className="hint" style={{ marginTop: 0 }}>
                Set by the template: creator-fee mode with the {template === "wall" ? "treasury" : "vault"} as the only recipient. The router
                writes this on-chain at launch; no wallet can be substituted later.
              </p>
            </div>
          ) : (
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
          )}

          <div style={{ borderTop: "1px solid var(--border-soft)", margin: "6px 0 16px" }} />
          <div className="kv"><span>Template</span><span className="v">{TEMPLATES.find((t) => t.id === template)?.title ?? "Standard"}</span></div>
          <div className="kv"><span>Quote asset</span><span className="v">{quote.native ? "Native USDC" : quote.symbol}</span></div>
          <div className="kv"><span>Supply</span><span className="v">1,000,000,000</span></div>
          <div className="kv"><span>Graduation goal</span><span className="v">{quote.gradGoal} {quote.symbol} in curve</span></div>
          <div className="kv"><span>First buy</span><span className="v">{devBuy && Number(devBuy) > 0 ? `${devBuy} ${quote.symbol}` : "—"}</span></div>
          <div className="kv"><span>Trade fee</span><span className="v">
            {template === "wall" ? "1% (70% to the treasury · 30% protocol)"
              : template === "pof" ? "1% (70% to the vault · 30% protocol)"
              : feeMode === "buyback" ? "1% (35% to you · 35% buyback · 30% protocol)" : "1% (70% to you · 30% protocol)"}
          </span></div>

          {launchesClosed && (
            <p className="hint" style={{ marginTop: 16, color: "var(--fg-dim)" }}>
              Launches on {net.label} are not open yet. Trading existing tokens works; new launches open when the protocol multisig enables them.
            </p>
          )}
          <button className="btn btn-primary" style={{ width: "100%", marginTop: 20, justifyContent: "center" }} onClick={launch} disabled={busy || launchesClosed || (identity.checked && !identity.ok)}>
            {busy ? <span className="spinner" /> : authenticated ? `Launch for ${formatUnits(launchFee, 18)} ${net.nativeSymbol ?? "USDC"}` : "Sign in to launch"}
          </button>
          {net.key === "testnet" && (
            <p className="hint" style={{ textAlign: "center" }}>
              Need testnet USDC?{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
                Circle faucet →
              </a>
            </p>
          )}
          {net.key === "robinhood-testnet" && (
            <p className="hint" style={{ textAlign: "center" }}>
              Need testnet ETH?{" "}
              <a href="https://faucet.quicknode.com/robinhood/testnet" target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
                QuickNode faucet →
              </a>{" "}
              USDGx and the stock stand-ins are mintable test tokens.
            </p>
          )}
        </div>
      </main>
      {toast && <div className="toast" onClick={() => setToast(null)}>{toast}</div>}
    </>
  );
}
