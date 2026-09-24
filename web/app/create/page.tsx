"use client";

// The launch wizard, on baskvia's create skeleton: three steps (NAME · MARKET &
// FEES · LAUNCH) with a step bar, a draft that survives a refresh, per-step
// gates, and one transaction at the end. The transaction path is the one the
// old form used: launch + first buy through the router where it exists (the
// templates always do), the factory alone otherwise; a lost receipt is
// resolved from chain, never resent.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { decodeEventLog, parseUnits, type Address, type Hex } from "viem";
import { Shell } from "@/components/shell/Shell";
import { useT } from "@/components/LangProvider";
import { Footer, OutlineButton, PageHead, PrimaryButton } from "@/components/ui/primitives";
import { IdentityBanner, PendingBar } from "@/components/TrustBanners";
import { Stepper, STEPS } from "@/components/create/Stepper";
import { NameStep } from "@/components/create/NameStep";
import { MarketStep } from "@/components/create/MarketStep";
import { LaunchStep, type LaunchCheck } from "@/components/create/LaunchStep";
import { emptyDraft, loadDraft, nameDone, recipientOk, saveDraft, taxOk, amountOk, useHydrated, type FeeMode, type LaunchDraft, type TemplateId } from "@/lib/draft";
import { factoryStateAbi, useFactoryState } from "@/lib/factory";
import { useNetwork } from "@/lib/networks";
import { getReferrer } from "@/lib/referral";
import { publicClient, RADIAN, factoryAbi, routerAbi, hasLaunchRouter, curveAbi, erc20Abi, arcTestnet, activeNetwork, hasPound, type QuoteAsset } from "@/lib/radian";
import { useRadianWallet } from "@/lib/useRadianWallet";
import { addLocalLaunch } from "@/lib/registry";
import { INDEXER_URL, hasIndexer } from "@/lib/indexer";
import { useIdentity } from "@/lib/identity";
import { waitReceipt, ReceiptTimeout, usePendingResume } from "@/lib/pendingTx";
import { buildWallConfig, buildPoFConfig, type PoFConfigInput, type WallConfigInput } from "@/lib/templates";
import { recordTx } from "@/lib/txLog";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
// Display default until the factory's current launchFee() is read — the owner
// can change the fee, and a hardcoded value would make every launch revert.
const DEFAULT_LAUNCH_FEE = 10n ** 18n;

// The new token + curve from the TokenLaunched event in a receipt.
function decodeLaunch(logs: readonly { data: Hex; topics: readonly Hex[] }[]) {
  for (const log of logs) {
    try {
      const parsed = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (parsed.eventName === "TokenLaunched") {
        const a = parsed.args as { token: Address; curve: Address; graduationThreshold: bigint };
        return { token: a.token, curve: a.curve, gthr: a.graduationThreshold.toString() };
      }
    } catch {}
  }
  return null;
}

export default function CreatePage() {
  const t = useT();
  const router = useRouter();
  const net = useNetwork();
  const { authenticated, login, getWalletClient, address } = useRadianWallet();
  const identity = useIdentity();
  const { state: factory } = useFactoryState();
  const hydrated = useHydrated();

  // draft: what the person edited this visit, else what this browser remembers
  const restored = useMemo(() => (hydrated ? loadDraft() : null) ?? emptyDraft(), [hydrated]);
  const [edited, setEdited] = useState<LaunchDraft | null>(null);
  const draft = edited ?? restored;
  const commit = useCallback((next: LaunchDraft) => {
    setEdited(next);
    saveDraft(next);
  }, []);

  const [step, setStep] = useState(1);
  const [touched, setTouched] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);

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
        if (!enabled && address) can = await publicClient.readContract({ address: RADIAN.factory, abi: factoryStateAbi, functionName: "canLaunch", args: [address as Address] });
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
  const launchFee = factory?.launchFee ?? DEFAULT_LAUNCH_FEE;
  const protocolShareBps = factory?.hook.protocolFeeShareBps ?? null;
  const maxTaxPct = (factory?.maxCreatorTaxBps ?? 1000) / 100;

  // A launch whose receipt this tab lost is resolved from chain here and registered locally.
  usePendingResume(["launch"], (p, receipt) => {
    const found = decodeLaunch(receipt.logs);
    if (!found) return;
    addLocalLaunch({ token: found.token, curve: found.curve, deployer: (p.meta?.account ?? ZERO_ADDR) as Address, graduationThreshold: found.gthr });
    setPendingHash(null);
    setToast(t("create.resumed", { sym: p.meta?.symbol ?? "" }));
  });

  // the quote asset: the draft's choice on this network, else the featured one
  const quote: QuoteAsset = useMemo(
    () => net.quoteAssets.find((q) => q.key === draft.quoteKey) ?? net.quoteAssets.find((q) => q.featured) ?? net.quoteAssets[0],
    [net.quoteAssets, draft.quoteKey],
  );
  const routerLive = net.contracts.router !== ZERO_ADDR;
  const templatesLive = routerLive && (net.features?.templates ?? true);
  // a template the network or the market cannot carry falls back to Standard
  const template: TemplateId = draft.template !== "standard" && (!templatesLive || (draft.template === "wall" && !quote.stock)) ? "standard" : draft.template;
  const effective: LaunchDraft = template === draft.template ? draft : { ...draft, template };

  const wallBuilt = template === "wall" ? buildWallConfig(draft.wall, quote.decimals) : null;
  const pofBuilt = template === "pof" ? buildPoFConfig(draft.pof, quote.decimals) : null;
  const templateError = wallBuilt?.error ?? pofBuilt?.error ?? null;
  const marketDone = !templateError && (template !== "standard" || draft.feeMode !== "creator" || (taxOk(draft.creatorTax, maxTaxPct) && recipientOk(draft.feeRecipient)));
  const identityBad = identity.checked && !identity.ok;

  const checks: LaunchCheck[] = [
    { key: "create.chkName", ok: nameDone(draft) },
    { key: "create.chkMarket", ok: !!quote },
    { key: "create.chkTemplate", ok: marketDone },
    { key: "create.chkNetwork", ok: net.live && !launchesClosed },
    { key: "create.chkWallet", ok: authenticated },
    { key: "create.chkIdentity", ok: !identityBad },
  ];

  const reachable = (n: number) => n === 1 || (n === 2 && nameDone(draft)) || (n === 3 && nameDone(draft) && marketDone);
  const canForward = step === 1 ? nameDone(draft) : step === 2 ? marketDone : false;
  const forward = () => {
    if (!canForward) {
      setTouched(true);
      return;
    }
    setTouched(false);
    setStep(step + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goto = (n: number) => {
    if (!reachable(n)) return;
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onField = (key: keyof LaunchDraft, value: string) => commit({ ...draft, [key]: value });
  const onWall = (patch: Partial<WallConfigInput>) => commit({ ...draft, wall: { ...draft.wall, ...patch } });
  const onPof = (patch: Partial<PoFConfigInput>) => commit({ ...draft, pof: { ...draft.pof, ...patch } });
  const onTemplate = (id: TemplateId) => commit({ ...draft, template: id });
  const onFeeMode = (m: FeeMode) => commit({ ...draft, feeMode: m });
  const onQuote = (q: QuoteAsset) => commit({ ...draft, quoteKey: q.key });
  const reset = () => {
    commit(emptyDraft());
    setAck(false);
    setTouched(false);
    setStep(1);
  };

  async function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!hasIndexer()) {
      setToast(t("create.imageNeedsIndexer"));
      return;
    }
    if (file.size > 2_000_000) {
      setToast(t("create.imageTooLarge"));
      return;
    }
    setUploading(true);
    try {
      const r = await fetch(`${INDEXER_URL}/upload`, { method: "POST", headers: { "content-type": file.type }, body: file });
      const j = (await r.json()) as { url?: string; error?: string };
      if (j.url) commit({ ...draft, logo: j.url });
      else setToast(j.error ?? t("create.imageFailed"));
    } catch {
      setToast(t("create.imageFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function launch() {
    if (!activeNetwork.live) {
      setToast(t("create.notLive"));
      return;
    }
    if (launchesClosed) {
      setToast(t("create.closed", { chain: activeNetwork.label }));
      return;
    }
    if (!authenticated) {
      login();
      return;
    }
    if (!nameDone(draft)) {
      setToast(t("create.nameSymbolRequired"));
      setStep(1);
      setTouched(true);
      return;
    }
    if (identityBad) {
      setToast(t("create.identityBlocked"));
      return;
    }
    if (!amountOk(draft.firstBuy)) {
      setToast(t("create.firstBuyErr"));
      return;
    }
    // Template config is validated against the same bounds the router enforces,
    // so a bad value is a message, not a reverted launch.
    const viaTemplate = template !== "standard";
    if (viaTemplate && !hasLaunchRouter) {
      setToast(t("create.needsRouter"));
      return;
    }
    if (template === "wall" && !quote.stock) {
      setToast(t("create.wallNeedsStock"));
      return;
    }
    if (templateError) {
      setToast(templateError);
      setStep(2);
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const wc = await getWalletClient();
      if (!wc) {
        setToast(t("create.noWallet"));
        setBusy(false);
        return;
      }
      const { client, account } = wc;
      const salt = ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
      const creatorMode = !viaTemplate && draft.feeMode === "creator";
      const params = {
        name: draft.name.trim(),
        symbol: draft.symbol,
        logo: draft.logo.trim(),
        description: draft.description.trim(),
        socials: { twitter: draft.twitter.trim(), telegram: "", discord: "", website: draft.website.trim(), farcaster: "" },
        // Templates: the router overwrites recipient + buyback mode (fees must reach the
        // treasury / vault), so these are sent as-is and the creator tax stays 0.
        creatorFeeRecipient: (creatorMode && /^0x[a-fA-F0-9]{40}$/.test(draft.feeRecipient.trim()) ? draft.feeRecipient.trim() : account) as Address,
        creatorTaxBps: creatorMode ? Math.round(Math.min(maxTaxPct, Math.max(0, Number(draft.creatorTax) || 0)) * 100) : 0,
        buybackEnabled: !viaTemplate && draft.feeMode === "buyback",
        expectedEconomics: ZERO_HASH,
        salt,
      };
      const buyAmt = Number(draft.firstBuy) > 0 ? parseUnits(draft.firstBuy, quote.decimals) : 0n;
      // With the launch router, launch + first buy is ONE transaction; the
      // templates always go through the router. Without a router: two txs.
      const viaRouter = hasLaunchRouter && (buyAmt > 0n || viaTemplate);
      let hash: Hex;
      if (viaRouter) {
        if (!quote.native && buyAmt > 0n) {
          const allowance = (await publicClient.readContract({ address: quote.address, abi: erc20Abi, functionName: "allowance", args: [account, RADIAN.router] })) as bigint;
          if (allowance < buyAmt) {
            setStatus(t("create.approve", { sym: quote.symbol }));
            const ah = await client.writeContract({ account, chain: arcTestnet, address: quote.address, abi: erc20Abi, functionName: "approve", args: [RADIAN.router, buyAmt] });
            await waitReceipt(ah, "approve");
            // The wallet may have edited the amount: re-read before spending on it.
            const after = (await publicClient.readContract({ address: quote.address, abi: erc20Abi, functionName: "allowance", args: [account, RADIAN.router] })) as bigint;
            if (after < buyAmt) throw new Error(t("create.approveShort"));
          }
        }
        setStatus(buyAmt > 0n ? t("create.confirmLaunchBuy") : t("create.confirmLaunch"));
        // minTokensOut 0 is safe: the buy is atomic with the launch, so the opening
        // price is fixed by the curve config and nothing can trade ahead of it.
        const value = launchFee + (quote.native ? buyAmt : 0n);
        if (wallBuilt?.cfg) {
          hash = await client.writeContract({ account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchWall", args: [params, 0n, quote.address, buyAmt, 0n, [], wallBuilt.cfg], value });
        } else if (pofBuilt?.cfg) {
          hash = await client.writeContract({ account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchPoF", args: [params, 0n, quote.address, buyAmt, 0n, [], pofBuilt.cfg], value });
        } else {
          hash = await client.writeContract({
            account, chain: arcTestnet, address: RADIAN.router, abi: routerAbi, functionName: "launchAndBuy",
            args: [params, 0n, quote.address, buyAmt, 0n, [], hasPound ? getReferrer() : ZERO_ADDR], value,
          });
        }
      } else {
        setStatus(t("create.confirmLaunch"));
        hash = await client.writeContract({ account, chain: arcTestnet, address: RADIAN.factory, abi: factoryAbi, functionName: "launchToken", args: [params, 0n, quote.address], value: launchFee });
      }

      setStatus(t("create.waiting"));
      const receipt = await waitReceipt(hash, "launch", { symbol: params.symbol, account });
      const found = decodeLaunch(receipt.logs);
      const tokenAddr = found?.token ?? null;
      const curveAddr = found?.curve ?? null;
      const gthr = found?.gthr ?? parseUnits(String(quote.gradGoal), quote.decimals).toString();
      if (tokenAddr && curveAddr) addLocalLaunch({ token: tokenAddr, curve: curveAddr, deployer: account, graduationThreshold: gthr });
      recordTx(account, { hash, kind: "launch", token: tokenAddr ?? undefined, time: Date.now() });

      // No router: the creator's first buy is a second transaction on the new curve
      // (untaxed — the creator is snipe-tax-exempt).
      if (!viaRouter && curveAddr && buyAmt > 0n) {
        if (quote.native) {
          setStatus(t("create.confirmFirstBuy"));
          const bh = await client.writeContract({ account, chain: arcTestnet, address: curveAddr, abi: curveAbi, functionName: "buy", args: [buyAmt, 0n, account], value: buyAmt });
          await waitReceipt(bh, "buy", { token: tokenAddr ?? "" });
        } else {
          setStatus(t("create.approve", { sym: quote.symbol }));
          const ah = await client.writeContract({ account, chain: arcTestnet, address: quote.address, abi: erc20Abi, functionName: "approve", args: [curveAddr, buyAmt] });
          await waitReceipt(ah, "approve");
          setStatus(t("create.confirmFirstBuy"));
          const bh = await client.writeContract({ account, chain: arcTestnet, address: curveAddr, abi: curveAbi, functionName: "buy", args: [buyAmt, 0n, account] });
          await waitReceipt(bh, "buy", { token: tokenAddr ?? "" });
        }
      }

      setStatus(t("create.launched"));
      saveDraft(emptyDraft()); // the launch is on chain; the draft has done its job
      router.push(tokenAddr ? `/token/${tokenAddr}` : "/explore");
    } catch (e: unknown) {
      if (e instanceof ReceiptTimeout) {
        setPendingHash(e.hash);
        setToast(t("create.pending"));
      } else {
        const err = e as { shortMessage?: string; message?: string };
        setToast(err?.shortMessage ?? err?.message ?? t("create.failed"));
      }
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <Shell>
      <div className="screen-in">
        <PageHead eyebrow={t("create.eyebrow")} title={t("create.title")} sub={t("create.sub")} aside={<OutlineButton type="button" onClick={reset}>{t("create.reset")}</OutlineButton>} />
        <IdentityBanner identity={identity} />
        <PendingBar hash={pendingHash} onClose={() => setPendingHash(null)} />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Stepper current={step} reachable={reachable} onGoto={goto} />
          {hydrated && (draft.name || draft.symbol) && <span className="mono-label text-[10px] tracking-[.12em] text-ink-3">{t("create.draftSaved")}</span>}
        </div>

        {step === 1 && <NameStep draft={draft} onField={onField} onPickImage={onPickImage} uploading={uploading} touched={touched} />}
        {step === 2 && (
          <MarketStep
            draft={effective}
            quote={quote}
            net={net}
            templatesLive={templatesLive}
            protocolShareBps={protocolShareBps}
            maxTaxPct={maxTaxPct}
            pound={!!net.pound}
            onQuote={onQuote}
            onTemplate={onTemplate}
            onFeeMode={onFeeMode}
            onField={onField}
            onWall={onWall}
            onPof={onPof}
            templateError={templateError}
          />
        )}
        {step === 3 && (
          <LaunchStep
            draft={effective}
            quote={quote}
            net={net}
            checks={checks}
            launchFee={launchFee}
            protocolShareBps={protocolShareBps}
            pound={!!net.pound}
            ack={ack}
            onAck={setAck}
            onFirstBuy={(v) => onField("firstBuy", v)}
            onLaunch={launch}
            busy={busy}
            status={status}
            authenticated={authenticated}
            launchesClosed={launchesClosed}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {step > 1 ? (
            <OutlineButton type="button" onClick={() => goto(step - 1)}>
              {t("create.back")}
            </OutlineButton>
          ) : (
            <span />
          )}
          {step < STEPS.length && (
            <PrimaryButton type="button" onClick={forward} className="max-w-[260px]" aria-disabled={!canForward}>
              {canForward ? t("create.next") : t("create.nextOff")}
            </PrimaryButton>
          )}
        </div>

        <Footer />
      </div>
      {toast && (
        <button type="button" onClick={() => setToast(null)} className="fixed bottom-[88px] left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xl border border-stroke bg-night px-4 py-3 text-left text-sm text-ink shadow-[var(--shadow)] nav:bottom-6">
          {toast}
        </button>
      )}
    </Shell>
  );
}
