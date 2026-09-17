// Chain marks shown in the hero ("Launch a token on <mark> Arc,"). The PNGs are
// fetched ONCE from Logo.dev by scripts/fetch-chain-logos.mjs into public/chains/
// so visitors never call a third party and no key ships in the bundle. When a
// file is missing the hero shows the name alone (ChainWord hides a broken img).
export type ChainBrandKey = "arc" | "robinhood";
export const CHAIN_BRANDS: Record<ChainBrandKey, { name: string; domain: string; logo: string }> = {
  arc: { name: "Arc", domain: "arc.network", logo: "/chains/arc.png" },
  robinhood: { name: "Robinhood", domain: "robinhood.com", logo: "/chains/robinhood.png" },
};
