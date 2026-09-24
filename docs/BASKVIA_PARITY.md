# baskvia → Radian: the port plan

baskvia (`/Users/haimo/Projects/baskvia`, read in full at commit `f93e288` on 2026-09-24: every file under
`web/src`, every document, the four contracts) is the owner's sibling product and the UX reference for
Radian. This is the consolidated list of what it does that Radian does not, in the order it gets ported,
with the baskvia source for each item so nothing is guessed. The six raw reading reports (per slice, with
line numbers) were produced the same day; this file keeps what survives them.

Decisions that frame the list (owner, 2026-09-24):

- **Architecture is not ported.** baskvia runs Next 16 + OpenNext on Cloudflare Workers with D1, a
  one-minute cron indexer, the Cache API and KV. Radian keeps Next 15 on Vercel and the Express indexer
  on Railway, because the indexer also runs the keeper (a private key, scheduled transactions, receipts
  scanning on Arc) and must be a long-lived process. Every Cloudflare mechanism below has an Express
  equivalent noted.
- **Basket contracts and their product core are not ported.** NAV, mint/redeem in kind, weights, Ondo
  RFQ quotes, the four fee pots, versions, reshape, LP positions, issuer risk have no counterpart in a
  bonding-curve launchpad. Where a basket concept has a Radian analogue it is named.
- **Radian keeps what it does better**: lost-receipt resume (`lib/pendingTx.ts` + `PendingBar`),
  timestamped logo signatures, the network switcher instead of Demo mode, the phone tab bar with More,
  the wallet menu, the persisted slippage selector, dictionary-only copy, the "not found" address guard.
- Next 16 and Privy 3 upgrades wait until after mainnet launches open.

Effort: S ≤ half a day, M one to two days, L more. Status column is kept current in commits.

## Principles carried over (from baskvia's docs)

1. A demo/placeholder label is removed exactly when the thing it describes is wired for real; never on a
   schedule. Keep a sunset note for any placeholder copy.
2. No unsolicited hint text or banners; risk facts are page content (Learn / Terms), not toasts.
3. Live shows real data or an honest empty state. Never 0 for unknown, never a plausible fake. A read
   failure is a 5xx or an "unreadable" row with a reason, never an empty list or a zero balance.
4. One source of truth per number: computed once (indexer or one pure function), read by every page.
5. Ownership by signature only, verified server-side against on-chain facts (deployer, live balance,
   factory owner). Never trust a self-reported address.
6. Error codes live in the data layer, copy in the view; never mask upstream error text.
7. Unknown receipt: point to the explorer, never resend (Radian already resumes instead).
8. Four-width sweep 1440 / 768 / 390 / 360 with overflow measurement *and* real screenshots at 360.
9. EN/中 key parity is a test; language switch keeps input and scroll; no glyphs inside dictionary strings.
10. Every new external host goes into the CSP `connect-src` deliberately (`web/middleware.ts`).

## Wave 1 — trust and data plane

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Signed **profiles**: name ≤ 32, bio ≤ 160, X ≤ 15 (no `@`), `<>`/control chars rejected, code-point lengths, 10-min TTL, `verifyMessage` (EOA + ERC-1271); module-level client cache, one fetch per address site-wide; editor on your own profile; name shown wherever a creator address appears | `domain/profile.ts`, `server/profile.ts`, `api/profile`, `lib/profile.ts`, `profile/[addr]/_components/ProfileEditor.tsx` | `indexer/src/meta.ts` (`GET/POST /profile/:addr`), `store.ts` (`profiles`), `web/lib/profile.ts`, `components/profile/ProfileEditor.tsx`, `app/profile/[addr]`, `DetailHead`, `CreatorChip`, `CreatorBoard`, `HolderWall` | M | |
| 1.2 | **Wall moderation**: signed hide message, `hidden` flag, re-post un-hides; moderator = factory owner (read live) or an env list; red "Hide" for moderators | `domain/basket-meta.ts:21-23`, `server/basket-meta.ts:122-146`, `DetailBody.tsx:408-417` | `indexer/src/meta.ts` (`POST /token/:addr/wall/hide`), `store.ts`, `web/lib/wall.ts`, `HolderWall.tsx` | M | |
| 1.3 | Wall text rules: trim, reject control chars, count code points, serve newest 50, show `held {balance}` per entry, copy for `bad-input`/`expired`/`too-large`/`rate` | `server/basket-meta.ts:84-85,113`, `DetailBody.tsx:407,445` | `meta.ts`, `HolderWall.tsx`, `dict.ts` | S | |
| 1.4 | **Holder counts** from token `Transfer` accumulation (dead, curve, locker, vault excluded), idempotent on rescans; `holders` on launch rows; Explore "Holders" sort + column with the honest "no holder counts yet" note; token page stat | `server/indexer.ts:129-170`, `server/baskvia.ts:41-53`, `view-helpers.ts:48,83`, `BasketList.tsx:111-117` | `indexer/src/scanner.ts`, `store.ts`, `server.ts`, `web/lib/explore.ts`, `components/explore/TokenList.tsx`, `DetailBody` | M | |
| 1.5 | **Factory-change detection** (persisted factory vs env → wipe index, keep wall/logos/profiles/auths) and a **confirmation lag** (`head − N`) | `indexer.ts:190-202` | `scanner.ts`, `store.ts` | S | |
| 1.6 | **Cache headers + memo**: `Cache-Control` on every public GET, `no-store` on per-user/write, in-process memo of `launchView()` (it recomputes trade stats per request), `x-cache` header; web public fetches use `revalidate` instead of `no-store` | `edge-cache.ts`, every `route.ts` | `server.ts`, `web/lib/indexer.ts` | M | |
| 1.7 | Public-GET address validation → `400 {error:"address"}`; `413` mapped to `{ok:false,error:"too-large"}` | `activity/route.ts:11`, `logo/route.ts:18` | `server.ts`, `meta.ts` | S | |
| 1.8 | `{through, backfillDone}` on list responses so a cold index says "still indexing", not "no launches" | `activity/route.ts:13,22` | `server.ts`, `web` empty states | S | |
| 1.9 | `GET /tx/:hash` server-side status decoding the launched token from the receipt (agents and other tabs resolve without an RPC) | `baskvia.ts:747-766` | `server.ts` | S | later |
| 1.10 | **Reconciliation**: indexed events ≤ cursor + live tail vs one multicall at block `through`; per launch reserves vs Σ trades, escrow claimable vs Σ accrued − claimed, PoundVault totals vs Σ settle; `≤` for lagging claims; Verify panel "All N checks pass / As of block N" | `server/reconcile.ts`, `verify/_components/Reconciliation.tsx` | `indexer/src/reconcile.ts`, `GET /reconcile`, `app/verify` | L | later |

## Wave 2 — trade form and token page

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 2.1 | **Buy / Sell segmented tabs** above the pay card (brand for buy, `bg-neg` for sell), in addition to the flip button; side switch clears the amount | `ChainSwapForm.tsx:206-227` | `components/trade/SwapForm.tsx` | S | |
| 2.2 | **Explorer link + check icon in the result banner**, on success and on failure/timeout | `ChainSwapForm.tsx:326-347` | `SwapForm.tsx`, `QuickBuy.tsx`, create | S | |
| 2.3 | **Wallet/RPC error → copy** helper: rejected / insufficient funds → gas hint with the address / reverted / timeout / network; never raw `shortMessage` | `ChainSwapForm.tsx:44-50`, `chain-ui.ts:32-43` | new `lib/txError.ts`, `SwapForm`, `QuickBuy`, `app/create`, `CreatorTools`, `PoundEarn` | M | |
| 2.4 | Low-gas warning with a **threshold** and the address, not only at exactly 0 | `ChainSwapForm.tsx:100,140` | `SwapForm.tsx` | S | |
| 2.5 | "≈" before the estimate, "(est.)" in the receive label; phase line under the form keeps the button label | `ChainSwapForm.tsx:88,244,306-325` | `SwapForm.tsx` | S | |
| 2.6 | Chart placeholder: spinner while loading, "no history yet" once resolved; `Launched Nd ago` from a mount-time `now`; 7D return chip | `DetailBody.tsx:215-221,313,330-339` | `components/token/DetailBody.tsx` | S | |
| 2.7 | Share feedback in the button label (2 s, timer cleanup) instead of a toast that never dismisses | `DetailHead.tsx:62-85` | `app/token/[address]/page.tsx`, `DetailHead.tsx` | S | |
| 2.8 | **"Use as template"** on the token page: pre-fill the create draft (quote, template, fee mode, creator tax; name/symbol cleared) and go to `/create` | `DetailHead.tsx:93-113` | `DetailHead.tsx`, `lib/draft.ts` | M | |
| 2.9 | **"$100 since launch → today"** card from real numbers (launch spot from the curve's phantom reserves), green ≥ $100 else red | `DetailBody.tsx:136-153` | `DetailBody.tsx`, indexer row `launchPrice` | M | |
| 2.10 | Explore: search matches quote symbol; persistent "Full console →" beside quick buy; list-row avatar links to `/profile`; card `aria-label` "Open {name}" | `view-helpers.ts:74`, `explore/page.tsx:234`, `BasketList.tsx:148`, `BasketCards.tsx:283` | `lib/explore.ts`, `components/explore/*` | S | |
| 2.11 | Logo resize JPEG-0.85 fallback over the byte cap; `refresh` after upload; picker thumbnail preview + Remove | `lib/basket-meta.ts:10-32`, `LogoPicker.tsx` | `lib/wall.ts`, `CreatorTools.tsx` | S | |

## Wave 3 — shell and foundation

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 3.1 | **Light theme reachable**: nonce'd pre-paint `THEME_INIT` script, `suppressHydrationWarning`, `ThemeButton` with dual icon (CSS already exists) | `layout.tsx:66-93`, `Shell.tsx:149-209` | `app/layout.tsx`, `components/shell/Shell.tsx` | M | |
| 3.2 | **Privy as its own chunk** (`dynamic(import, {ssr:false})`) behind a Privy-free wallet context; no hard-coded fallback app id; embedded wallet preferred deterministically | `state/privy-boundary.tsx`, `privy-provider.tsx:107`, `wallet-context.tsx` | `components/Providers.tsx`, `lib/useRadianWallet.ts` | M | |
| 3.3 | **404** as a server component: bilingual hard-coded copy, 7×18 pixel "404" with one glowing brand cell, CTAs to `/explore` and `/verify`, metadata | `not-found.tsx` | `app/not-found.tsx` | S | |
| 3.4 | Tab icon + OG/Twitter cards + `metadataBase`; `poweredByHeader: false` | `layout.tsx:31-55`, `next.config.ts:11` | `app/layout.tsx`, `next.config.mjs` | S | |
| 3.5 | Header right group wraps on tiny phones; distinct `tabbarAria`; `Spinner` with `label → role="status"`; `Treemap` ids with `useId()`; landing hint fades with progress; `.l-line` wraps at all widths; remove the double bottom padding and dead CSS aliases | `Shell.tsx:67`, `dict.ts:36`, `primitives.tsx:298`, `Treemap.tsx:94`, `Landing.tsx:152`, `landing.css:187` | `Shell.tsx`, `dict.ts`, `rows.tsx`, `Treemap.tsx`, `Landing.tsx`, `landing.css`, `globals.css` | S | |
| 3.6 | **Address fingerprint** phrase (FNV-1a over all bytes, 3 words) beside contract addresses on Verify and the token contracts panel | `lib/fingerprint.ts`, `verify/page.tsx:207-218` | `lib/ui/fingerprint.ts`, `app/verify`, `DetailBody` | S | |
| 3.7 | Storage-write-failed banner (session-dismissable) fed by the localStorage writers | `Shell.tsx:212-236` | `Shell.tsx`, `lib/draft.ts`, `txLog.ts`, `pendingTx.ts` | S | later |

## Wave 4 — portfolio and activity

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 4.1 | **Phase model** (wallet-loading / disconnected / loading / error+retry / ready) with previous data kept while reloading; **Unreadable** and **Not priced** panels ("does not mean zero") instead of silent 0n | `LivePortfolio.tsx:48-159`, `live-portfolio.ts:80-107` | `app/portfolio/page.tsx`, new `lib/usePortfolio.ts` | M | |
| 4.2 | **Hide-amounts** preference (fixed mask `$ ••••`, `storage` cross-tab, eye in the address chip) and the **nav portfolio value** on the Portfolio item | `lib/hide-amounts.ts`, `NavPortfolioValue.tsx`, `Overview.tsx:100-108` | `lib/ui/hideAmounts.ts`, `Shell.tsx`, portfolio | M | |
| 4.3 | Freshness pill ("Read just now / N min ago", 30 s tick, click = force refresh); `Info` (i) tooltip primitive with methodology copy | `Overview.tsx:21-28,134-141`, `Info.tsx` | `components/ui/Info.tsx`, portfolio | S | |
| 4.4 | Positions: `%` column, colour dot, group proportion line, spotlight dim (opacity, not filter), small-position fold, share PNG (percentages only), CSV export, `pctText`/`amountText`, `money()` pinned to en-US | `Positions.tsx`, `shared.ts`, `shareImage.ts` | `app/portfolio/page.tsx`, `lib/ui/format.ts`, `lib/shareImage.ts` | M | |
| 4.5 | **Approvals** panel with Revoke (`approve(spender,0)`), unlimited flagged, R03 rule (read failure ≠ none), refresh at 6 s and 15 s | `Approvals.tsx`, `live-portfolio.ts:159-162` | `components/portfolio/Approvals.tsx` | M | |
| 4.6 | Insights cards (dust, top-two, quote assets spanned; weeks/together/bets when daily series exist), 6 shown + "+N more" | `Insights.tsx`, `insightsMath.ts` | `components/portfolio/Insights.tsx`, `lib/insightsMath.ts` | M | later |
| 4.7 | **Per-wallet activity** from the indexer merged with the local tx log ("indexing…" badge, "indexed through block N"), `amount` on `TxRecord`, lang-aware time | `LiveActivity.tsx`, `api/activity`, `tx-log.ts` | `server.ts` `GET /address/:addr/activity`, `app/activity`, `lib/txLog.ts` | L | |
| 4.8 | Claims: spinner in the clicked button, `role="status"` result line; "Claim all" sequential runner "{i}/{n}" | `Claims.tsx`, `fees/page.tsx:86-103` | portfolio, `PoundEarn.tsx` | S | |

## Wave 5 — create, creators, earn

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Split preview with **two denominators** ("of the fee" / "of a trade"), "= x% of every trade" under the share control, one-line summary, per-role notes, `title` on segments | `PublishStep.tsx:155-219`, `Wizard.tsx:443-469` | `components/create/FeeSplitPreview.tsx` | S | |
| 5.2 | Creator tax as a **slider** with a big live number and min/max captions | `Wizard.tsx:480-509` | `MarketStep.tsx` | S | |
| 5.3 | Recipient box: distinct empty-vs-malformed messages, trim on change, **"Use my address"** | `Wizard.tsx:525-545` | `MarketStep.tsx` | S | |
| 5.4 | Live validation status line on the last step; resume on the **first incomplete step**; two-press discard; in-bar Back; step-bar `aria-label`s; ✓ in the step heading; `sr-only` Done/To do; first-buy input mask; creator identity block | `create/page.tsx:316-323`, `wizard-model.ts:45-49`, `Wizard.tsx:121-176,678-734` | `app/create/page.tsx`, `Stepper.tsx`, `LaunchStep.tsx`, `NameStep.tsx`, `QuickStart.tsx` | M | |
| 5.5 | Name/description disallowed-character filters; ack copy asserts creator responsibility and "software, not advice" | `validate.ts:22-24`, `dict.ts:361` | `lib/draft.ts`, `dict.ts` | S | |
| 5.6 | Post-launch extras (logo, first buy) never block navigation; failures append to "Launched" | `creators/page.tsx:131-144` | `app/create/page.tsx` | S | |
| 5.7 | Earn: "creator fee starts with a launch · create one →", three feature cards, `Tip` tooltip on cells | `earn/page.tsx:86-146`, `fees/page.tsx:47-58` | `PoundEarn.tsx` | S | |
| 5.8 | Creator tools: thumbnail preview, full `meta.*` copy table, `role="status"` results, gating copy "Connect the wallet you launched with…" | `LogoPicker.tsx`, `chain-ui.ts:58-67`, `LiveCreator.tsx:38-49` | `CreatorTools.tsx`, `dict.ts` | S | |

## Wave 6 — information pages and tests

| # | Item | baskvia source | Radian target | Effort | Status |
| --- | --- | --- | --- | --- | --- |
| 6.1 | `LegalPage` component; **Privacy** page (exact localStorage keys, third parties: Privy, Railway indexer, RPC, logo.dev, Yahoo via our API) and **Risk** page split from Terms; "See also" line; footer links | `components/LegalPage.tsx`, `content/legal.ts` | `components/LegalPage.tsx`, `lib/content/legal.ts`, `app/privacy`, `app/risk` | M | |
| 6.2 | Verify grouped by purpose, deployer/owner panel (Safe + deployer with fingerprints) | `verify/page.tsx:150-264` | `app/verify/page.tsx` | S | |
| 6.3 | Learn: fee numbers filled from constants with a test that no `{placeholder}` survives; Q&A anchor `aria-label` distinct from the toggle | `help/page.tsx:22-29,308` | `lib/content/learn.ts`, `app/docs` | S | |
| 6.4 | Developer docs page: ⌘K search, sticky numbered TOC, p/note/code/table blocks, API table with cache seconds and limits, addresses from constants, gotchas | `docs/page.tsx`, `content/docs.ts` | `app/api-docs` | M | later |
| 6.5 | Test harness: vitest + jsdom; EN/中 key parity; `routeNameOf` prototype guard; landing and pixel pure functions; legal content shape; secret-isolation guard | `package.json`, `*.test.ts(x)` | `web/package.json`, `web/**/*.test.ts` | L | |

## Not ported (basket-only or by decision)

Demo/Live mode and `LiveEmpty`; NAV/TVL maths and the valuation engine; holdings composition, treemap
weights, reshape/rebalance, mint/redeem in kind, LP positions, add-token-by-address, linked wallets
book; versions/follow/publish; Ondo minimum trade and the 14-second quote auto-retry; the four fee pots
console and holder fee accrual (`/fees`, `/rights`); the six-step wizard structure (Radian's three-step
wizard stays); Cloudflare D1/KV/Cache API/cron/rate-limit bindings; `dev/fork-send`; `/create → /creators`
redirect; noindex; the Chinese `error` strings on public routes.

baskvia bugs not to copy: `WalletPill` literal `#1c130c` menu background; `**bold**` in `create.splitNote`
that nothing parses; `preserveDrawingBuffer` leftover; a phone tab bar that cannot reach `/more`; the wallet
menu without an Escape handler; the Verify deployer panel showing the fee address.
