// Project links for launches. On-chain `socials` are the source of truth; this
// map fills in for launches whose socials were empty at launch (the field is
// immutable) — e.g. the platform's own flagship. Keyed by token address.
export const PROJECT_LINKS: Record<string, { website?: string; twitter?: string }> = {
  "0x5a8b01d1d7bfe524f1969494528a64971897c535": { website: "https://radian-wall.vercel.app" }, // The Wall v2
  "0xf8ab1b64598d7d422baba415b10ec34ca6f0096d": { website: "https://radian-wall.vercel.app" }, // The Wall v1 (sunset)
};

export const projectLinks = (token: string) => PROJECT_LINKS[token.toLowerCase()];

// Only http(s) URLs ever become hrefs — creator-supplied strings can be anything.
export const safeHttpUrl = (u?: string) => (u && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : undefined);

// Accepts "@handle", "handle", or a full x.com/twitter.com URL.
export const xUrl = (v?: string) => {
  if (!v) return undefined;
  const s = v.trim();
  if (/^https?:\/\/(x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/?$/i.test(s)) return s;
  const h = s.replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? `https://x.com/${h}` : undefined;
};
