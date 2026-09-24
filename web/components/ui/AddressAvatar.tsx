// Avatar derived from an address: a two-colour gradient seeded from the head
// and tail of the address, plus its first hex character. The same address
// gets the same face everywhere, so "who launched this" matches the creator page.
import { assetColor } from "@/lib/ui/tokens";

export function AddressAvatar({ address, size = 40 }: { address: string; size?: number }) {
  const a = String(address || "").toLowerCase();
  const c1 = assetColor(a.slice(2, 10));
  const c2 = assetColor(a.slice(-8));
  const letter = (a.replace(/^0x/, "")[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full border border-stroke-2 font-semibold text-night"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, ${c1}, ${c2})` }}
    >
      {letter}
    </span>
  );
}
