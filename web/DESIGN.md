# Radian web — design system and page conventions

Decided 2026-09-24 (with the owner): the interface is rebuilt on baskvia's UX skeleton and design
system — same information architecture (Portfolio / Explore / Swap / Learn + More), same shell,
same components, same landing choreography — in the **Ember** skin so the two products read as one
family without being mistaken for each other. Business logic (launches, trades, referral tags,
The Pound claims, delegated buys, identity checks) is ours and stays; only the presentation moves.
Plan and page map: the artifact "The Pound 界面重构" (2026-09-24) and HANDOFF.md §5.

## Tokens (app/globals.css)

Three layers, as in baskvia: `@theme inline` registers Tailwind utilities that emit `var(--…)`,
`:root` holds the dark values (default), `:root[data-theme="light"]` overrides the same names.

| Utility | Meaning |
|---|---|
| `text-ink` / `ink-2` / `ink-3` / `muted` | text, secondary, tertiary, notes |
| `brand` / `brand-2` / `brand-3` | ember amber: buttons, active nav, links, the mark |
| `signal` / `signal-2` | the ONE cold colour on the warm ground: pending, testnet, "graduated", warnings |
| `pos` / `neg` | up / down — never the brand |
| `bg` (`--ground`), `bg-2`, `surface`, `night`, `glass`, `glass-2`, `glass-hi` | grounds and glass layers |
| `stroke` / `stroke-2` / `line` | borders |
| `rounded-panel` (20px), `rounded-lg` (24px) | radii |
| `nav:` (900px) | the nav wraps, hero columns stack; `md` (768px) drives the phone tab bar |
| `glass-panel`, `grad-fill`, `grad-soft-fill`, `mono-label`, `tnum` | composite utilities |

Fonts: Sora (everything) + JetBrains Mono (labels, codes, numbers), self-hosted via next/font/local;
the variables live on `<html>`.

Legacy: the old pages still read `--bg/--panel/--fg/--radian/--up/--down/--grad…`; those names are
aliased to the Ember palette at the end of `:root` and the old stylesheet sits under the LEGACY
banner. Each rebuilt page drops its legacy rules; do not add to that section.

## Shell (components/shell)

`Shell` = top bar (brand, 4 nav items + More dropdown, network pill, EN/中, wallet pill) + crumb bar
with the chain badge + centred `<main>` (max 1000px) + fixed phone tab bar. Legacy pages mount only
the bars through `components/Nav` until they are rebuilt. Routes, crumbs and active highlighting all
derive from `lib/routes.ts` — add a page there first, never hand-write an href elsewhere.

## Rules for every rebuilt page

1. Wrap the page in `<Shell>` and give the body `screen-in`.
2. All copy through `t()` / `tDynamic()`; a missing key is a compile error (`lib/i18n/dict.ts`).
   Both languages ship together.
3. Semantic tokens only; no literal colours in JSX except inside SVG gradients.
4. Every data view covers loading, empty, failure, stale and partial. A number we cannot read is
   "—", never 0. Nothing that is not on chain gets a working-looking button.
5. No `dangerouslySetInnerHTML`; the four emphasis tags go through `RichText`.
6. Amounts in tabular figures (`tnum`); addresses through `shortAddr`.
7. Acceptance per page: same-viewport screenshot against baskvia, 1440 / 768 / 390 widths,
   keyboard focus, reduced motion, and the real flow on the testnet and on mainnet.

## Phases

0 foundation (done 2026-09-24) · 1 landing + explore (done 2026-09-24: `/` is the landing —
components/landing, the cave sequence under public/cave; `/explore` on baskvia's explore skeleton
with the shared trade path lib/useTrade.ts and the indexer's spark / 24h fields) · 2 token page + swap (done 2026-09-24:
`/token/[address]` on the basket-detail skeleton — components/token/{DetailHead,DetailBody}; `/swap` console with
components/swap/TokenAside; one trade form components/trade/SwapForm on useTrade for both; Swap in the main nav,
Launch under More) · 3 create wizard,
creators, my launches, creator profile · 4 portfolio, fees, earn, activity feed, learn, integrate,
verify, rules, risk.
