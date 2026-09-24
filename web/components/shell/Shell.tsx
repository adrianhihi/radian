"use client";

// The site shell: sticky top bar (brand + nav + network / language / wallet),
// a crumb bar with the chain badge, the centred content column, and a fixed
// bottom tab bar on phones. `Chrome` is the bars alone, which the legacy pages
// mount through components/Nav until they are rebuilt on `Shell`.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MORE_NAME, NAV, activeNav, routeNameOf } from "@/lib/routes";
import { useLang, useT, useTDynamic } from "@/components/LangProvider";
import { isTestnet, useNetwork } from "@/lib/networks";
import { BrandMark } from "./BrandMark";
import { NavIcon } from "./NavIcon";
import { NavMore } from "./NavMore";
import { NavPortfolioValue } from "./NavPortfolioValue";
import { NetworkPill } from "./NetworkPill";
import { dismissStorageWarning, useStorageFailed, writeLS } from "@/lib/ui/storage";
import { WalletPill } from "./WalletPill";

export function Shell({ children, crumbSuffix }: { children: React.ReactNode; crumbSuffix?: string }) {
  return (
    <>
      <Chrome crumbSuffix={crumbSuffix} />
      <main className="mx-auto max-w-[1000px] px-[18px] pb-[120px] pt-[22px] nav:px-10 nav:pb-16 nav:pt-[34px]">{children}</main>
    </>
  );
}

export function Chrome({ crumbSuffix }: { crumbSuffix?: string }) {
  const pathname = usePathname();
  const t = useT();
  const td = useTDynamic();
  const net = useNetwork();
  const active = activeNav(pathname);
  const routeName = routeNameOf(pathname);
  const crumb = routeName === "token" ? (crumbSuffix ? td("crumb.tokenWith", { name: crumbSuffix }) : td("crumb.token")) : td(`crumb.${routeName}`);
  const live = net.live && !isTestnet(net);

  return (
    <>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-stroke bg-[color-mix(in_srgb,var(--ground)_78%,transparent)] px-[18px] py-3 font-sans backdrop-blur-xl backdrop-saturate-[1.3] nav:flex-nowrap nav:gap-6 nav:px-10 nav:py-3.5">
        <Link href="/" className="flex flex-none items-center gap-[11px]" aria-label={t("shell.brandAria")}>
          <BrandMark size={28} />
          <span className="text-xl font-bold leading-none tracking-[.02em] text-ink">Radian</span>
        </Link>

        {/* No overflow on this nav: a scroll container would clip the MORE dropdown. */}
        <nav className="order-3 flex w-full flex-1 flex-wrap justify-start gap-0.5 max-md:hidden nav:order-none nav:w-auto nav:justify-center nav:gap-1" aria-label={t("shell.navAria")}>
          {NAV.map((n) => (
            <Link
              key={n.name}
              href={n.href}
              id={`nav-${n.name}`}
              className={`flex items-baseline gap-2 whitespace-nowrap rounded-[9px] px-[15px] py-2.5 text-base transition-colors ${
                n.name === active ? "grad-fill" : "text-ink-2 hover:bg-glass-2 hover:text-ink"
              }`}
            >
              {td(`nav.${n.name}`)}
              {n.name === "portfolio" && <NavPortfolioValue />}
            </Link>
          ))}
          <NavMore active={active === MORE_NAME} />
        </nav>

        {/* wraps on tiny phones instead of pushing the bar wider than the screen */}
        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 min-[400px]:gap-2.5 nav:ml-0 nav:gap-3.5">
          <NetworkPill />
          <LangToggle />
          <ThemeButton />
          <WalletPill />
        </div>
      </header>

      <StorageBanner />

      <div className="flex items-center justify-between gap-3 border-b border-stroke px-[18px] py-[9px] font-sans nav:px-10 nav:py-[11px]">
        <span className="mono-label text-[11px] uppercase tracking-[.14em] text-ink-2">{crumb}</span>
        <span className="mono-label hidden items-center gap-2 text-xs text-muted nav:flex">
          <i className={`size-2 rotate-45 border-2 ${live ? "border-pos" : "border-signal"}`} />
          {live ? t("shell.chainLive", { chain: net.chainName }) : t("shell.chainTest", { chain: net.chainName })}
        </span>
      </div>

      <TabBar active={active} />
    </>
  );
}

function LangToggle() {
  const { lang, setLang } = useLang();
  const t = useT();
  const cls = (on: boolean) =>
    `rounded-md px-[9px] py-[5px] text-xs font-semibold leading-none transition-colors ${on ? "bg-glass-hi text-ink" : "text-muted hover:text-ink"}`;
  return (
    <div className="inline-flex flex-none gap-0.5 rounded-[9px] border border-stroke bg-glass-2 p-[3px]" role="group" aria-label={t("shell.langAria")}>
      <button type="button" lang="en" aria-pressed={lang === "en"} className={cls(lang === "en")} onClick={() => setLang("en")}>
        EN
      </button>
      <button type="button" lang="zh-CN" aria-pressed={lang === "zh"} className={cls(lang === "zh")} onClick={() => setLang("zh")}>
        中
      </button>
    </div>
  );
}

/**
 * Light / dark. No React state: the source of truth is `<html data-theme>`, set by the
 * pre-paint script in app/layout.tsx; both icons are in the DOM and globals.css shows the
 * one for the current theme, so the first frame is never wrong.
 */
function ThemeButton() {
  const t = useT();
  const toggle = () => {
    const root = document.documentElement;
    const toLight = root.getAttribute("data-theme") !== "light";
    if (toLight) root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    writeLS("radian.theme", toLight ? "light" : "dark"); // refused (private mode): this session only, and the banner says so
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("shell.themeAria")}
      title={t("shell.themeAria")}
      className="theme-btn grid size-[34px] flex-none place-items-center rounded-[10px] border border-stroke-2 bg-glass-2 text-ink-2 backdrop-blur-[10px] transition hover:-translate-y-px hover:border-brand hover:text-brand"
    >
      <svg className="theme-icon-dark" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" />
      </svg>
      <svg className="theme-icon-light" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" />
      </svg>
    </button>
  );
}

/**
 * Under the top bar once a localStorage write was refused (private window, quota full,
 * storage disabled): the modules carry on in memory, so the person is told what will not
 * survive a reload. The status region is always in the DOM (a live region announces only
 * changes inside it) and is empty with no padding or border until then, so the layout of
 * a page never shifts. Dismissed for this page load; a new failure shows it again.
 */
function StorageBanner() {
  const t = useT();
  const { failed } = useStorageFailed();
  return (
    <div
      role="status"
      className={failed ? "flex items-center justify-between gap-3 border-b border-stroke bg-glass px-[18px] py-2.5 font-sans text-[13px] leading-[1.6] text-ink-2 backdrop-blur-xl nav:px-10" : undefined}
    >
      {failed && (
        <>
          <span className="flex items-start gap-2.5">
            <i className="mt-[7px] size-2 flex-none rotate-45 border-2 border-signal" aria-hidden="true" />
            {t("shell.storageFailed")}
          </span>
          <button
            type="button"
            onClick={dismissStorageWarning}
            className="flex-none rounded-md border border-stroke-2 bg-glass-2 px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:border-brand hover:text-brand"
          >
            {t("shell.storageDismiss")}
          </button>
        </>
      )}
    </div>
  );
}

/** Phone tab bar: the four main items plus More (below 768px the top nav is hidden). */
function TabBar({ active }: { active: string }) {
  const t = useT();
  const td = useTDynamic();
  const items = [...NAV, { name: MORE_NAME, href: "/more" }];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex gap-0.5 border-t border-stroke bg-glass px-1 pt-1.5 font-sans backdrop-blur-xl md:hidden"
      style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom, 0px))" }}
      aria-label={t("shell.tabbarAria")}
    >
      {items.map((n) => (
        <Link
          key={n.name}
          href={n.href}
          aria-label={td(`nav.${n.name}`)}
          className={`flex min-w-0 flex-1 flex-col items-center gap-[3px] rounded-[10px] px-0.5 py-1.5 text-[10px] tracking-[.02em] transition-colors ${
            n.name === active ? "text-brand" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          <NavIcon name={n.name} />
          <span>{td(`nav.${n.name}`)}</span>
        </Link>
      ))}
    </nav>
  );
}
