"use client";

// Compatibility shim for the pages that predate the design system: `<Nav />`
// now renders the new chrome (top bar, crumb bar, phone tab bar). Rebuilt pages
// use `Shell` from components/shell directly; delete this file with the last
// legacy page.
import { Chrome } from "@/components/shell/Shell";

export { BrandMark } from "@/components/shell/BrandMark";

export function Nav() {
  return <Chrome />;
}
