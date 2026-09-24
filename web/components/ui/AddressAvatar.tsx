// A pixel person derived from an address (12×12 grid), the same one for the
// same address everywhere — so "who launched this" matches the creator page
// at a glance. Skin, hair, glasses, beard and shirt come from the address's
// hash; the background from the warm asset palette. The earlier version drew
// the address's first hex character in a circle, which read as a count badge.
import { assetColor } from "@/lib/ui/tokens";

const SKIN = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#a8e6cf", "#c9b8ff"];
const HAIR = ["#1f1a17", "#4a2c1a", "#a0522d", "#d4a017", "#e8e8e8", "#c0392b", "#5b6cff", "#2ecc71"];
const SHIRT = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

/** FNV-1a → mulberry32: an address → a reproducible pseudo-random sequence. */
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Px = [x: number, y: number, color: string];

/** Every pixel of the person (pure: the same address always gives the same result). */
export function pixelAvatar(address: string): { bg: string; px: Px[] } {
  const a = String(address || "").toLowerCase();
  const r = rng(a);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const shirt = pick(SHIRT);
  const hairStyle = Math.floor(r() * 5); // 0 short 1 mohawk 2 long 3 cap 4 bald
  const glasses = r() < 0.3;
  const beard = r() < 0.25;
  const smile = r() < 0.6;
  const earring = r() < 0.2;
  const px: Px[] = [];
  const put = (x: number, y: number, c: string) => px.push([x, y, c]);
  const row = (y: number, x0: number, x1: number, c: string) => {
    for (let x = x0; x <= x1; x++) put(x, y, c);
  };
  const col = (x: number, y0: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) put(x, y, c);
  };
  const MOUTH = "#7a2e2e";

  row(11, 2, 9, shirt);
  row(10, 3, 8, shirt);
  row(10, 5, 6, skin);
  for (let y = 3; y <= 9; y++) row(y, 3, 8, skin);
  put(2, 6, skin);
  put(9, 6, skin);
  if (hairStyle === 0 || hairStyle === 2) {
    row(2, 3, 8, hair);
    row(3, 3, 8, hair);
  }
  if (hairStyle === 1) {
    col(5, 0, 3, hair);
    col(6, 0, 3, hair);
  }
  if (hairStyle === 2) {
    col(2, 3, 8, hair);
    col(9, 3, 8, hair);
  }
  if (hairStyle === 3) {
    row(1, 3, 8, shirt);
    row(2, 3, 8, shirt);
    row(3, 2, 9, shirt);
  }
  if (glasses) {
    row(5, 3, 8, "#111");
    put(4, 6, "#7dd3fc");
    put(7, 6, "#7dd3fc");
  } else {
    put(4, 6, "#111");
    put(7, 6, "#111");
  }
  if (beard) {
    row(8, 4, 7, hair);
    row(9, 4, 7, hair);
  }
  if (smile) {
    put(4, 8, MOUTH);
    row(9, 5, 6, MOUTH);
    put(7, 8, MOUTH);
  } else row(8, 5, 6, MOUTH);
  if (earring) put(9, 7, "#facc15");

  return { bg: assetColor(a.slice(2, 10)), px };
}

export function AddressAvatar({ address, size = 40 }: { address: string; size?: number }) {
  const { bg, px } = pixelAvatar(address);
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" className="block flex-none overflow-hidden rounded-full border border-stroke-2" style={{ background: bg }}>
      {px.map(([x, y, c], i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={c} />
      ))}
    </svg>
  );
}
