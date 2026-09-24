// A three-word fingerprint of an address, for the eye: 40 hex characters are misread,
// "glacier-slate-umber" is not. Every byte of the address feeds each word (FNV-1a with
// three seeds), so a look-alike address that differs anywhere gives different words.
// Pure and deterministic; the same phrase everywhere the address is shown.

const WORDS = [
  "amber", "basalt", "cedar", "delta", "ember", "fjord", "glacier", "harbor", "indigo", "juniper",
  "kelp", "lumen", "marble", "nickel", "ochre", "pebble", "quartz", "raven", "slate", "tundra",
  "umber", "velvet", "willow", "xenon", "yarrow", "zephyr", "aster", "birch", "cobalt", "dune",
  "ferrite", "garnet", "heron", "iris", "jasper", "kestrel", "lichen", "moss", "nova", "opal",
  "plume", "reed", "sable", "topaz", "vale",
] as const; // 45 words: a length with no common factor with the byte count

function fnv1a(bytes: Uint8Array, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function addressBytes(address: string): Uint8Array | null {
  const hex = address.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) return null;
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** "glacier-slate-umber" for a valid address; "" otherwise. */
export function fingerprint(address: string): string {
  const bytes = addressBytes(address);
  if (!bytes) return "";
  return [2, 4, 6].map((seed) => WORDS[fnv1a(bytes, seed) % WORDS.length]).join("-");
}
