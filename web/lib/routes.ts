// The route table. Navigation, crumbs, active highlighting and the "no dead
// link" rule all derive from this one place.
//
// Information architecture follows the Spectrum / baskvia shape: four main
// items + a MORE dropdown, main flow and tools on separate levels. During the
// rebuild the hrefs point at whichever page currently serves that role; each
// phase moves them (Explore → /explore with the landing at /, Launch → /create,
// Learn → /learn, Builders → /integrate).

export interface NavItem {
  name: string;
  href: string;
}

export const NAV: NavItem[] = [
  { name: "portfolio", href: "/portfolio" },
  { name: "explore", href: "/explore" },
  { name: "swap", href: "/swap" },
  { name: "learn", href: "/docs" },
];

export const NAV_MORE: NavItem[] = [
  { name: "create", href: "/create" },
  { name: "creators", href: "/creators" },
  { name: "earn", href: "/earn" },
  { name: "builders", href: "/builders" },
  { name: "apiDocs", href: "/api-docs" },
  { name: "factory", href: "/factory" },
  { name: "verify", href: "/verify" },
  { name: "live", href: "/live" },
  { name: "stats", href: "/stats" },
];

export const NAV_FOOTER: NavItem[] = [
  { name: "learn", href: "/docs" },
  { name: "builders", href: "/builders" },
  { name: "apiDocs", href: "/api-docs" },
  { name: "earn", href: "/earn" },
  { name: "verify", href: "/verify" },
  { name: "terms", href: "/terms" },
  { name: "privacy", href: "/privacy" },
  { name: "risk", href: "/risk" },
];

export const MORE_NAME = "more";

/** Routes that are not nav items → the top-level item to highlight ("none" = nothing). */
const SUB: Record<string, string> = {
  token: "explore",
  activity: "portfolio",
  tx: "portfolio",
  r: "explore",
  live: "explore",
  stats: "explore",
  docs: "learn",
  profile: "explore",
  create: MORE_NAME,
  creators: MORE_NAME,
  launch: MORE_NAME,
  earn: MORE_NAME,
  builders: MORE_NAME,
  "api-docs": MORE_NAME, // the developer docs page (routeNameOf maps it to "apiDocs"; /docs is Learn)
  factory: MORE_NAME,
  verify: MORE_NAME,
  terms: MORE_NAME,
  privacy: MORE_NAME,
  risk: MORE_NAME,
  more: MORE_NAME,
};

const NAV_NAMES = new Set([...NAV.map((n) => n.name), MORE_NAME]);

/** First path segment → route name used for crumbs. "/" is the explore page during phase 0. */
export function routeNameOf(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return "home"; // the landing: no Shell, no crumb, nothing highlighted
  if (seg === "docs") return "learn";
  if (seg === "api-docs") return "apiDocs"; // dictionary keys are camelCase (nav.apiDocs, crumb.apiDocs)
  // Object.hasOwn, not `in`: `in` walks the prototype chain (/constructor, /toString…)
  return NAV_NAMES.has(seg) || Object.hasOwn(SUB, seg) ? seg : "explore";
}

/** Which top-level nav item to highlight for a path. */
export function activeNav(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return "home";
  if (NAV_NAMES.has(seg)) return seg;
  return SUB[seg] ?? "explore";
}
