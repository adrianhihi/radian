// Downloads the chain marks used in the hero into public/chains/ ONCE, so the
// site never calls Logo.dev at runtime and no key ships in the bundle. Run when
// the brand list in lib/chainBrands.ts changes:
//   LOGO_DEV_TOKEN=pk_... npm run logos
// The token is a Logo.dev PUBLISHABLE key (pk_...). Never put a secret key here,
// and never commit the key: only the PNGs are committed. Keep the "Logos by
// Logo.dev" credit in the footer unless your Logo.dev plan waives attribution.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BRANDS = {
  arc: "arc.network",
  robinhood: "robinhood.com",
};

const token = process.env.LOGO_DEV_TOKEN;
if (!token || !token.startsWith("pk_")) {
  console.error("Set LOGO_DEV_TOKEN to a Logo.dev publishable key (pk_...).");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public", "chains");
await mkdir(dir, { recursive: true });

for (const [key, domain] of Object.entries(BRANDS)) {
  const url = `https://img.logo.dev/${domain}?token=${token}&size=256&format=png`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${domain}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Only a real PNG is written; an error page must never land in public/.
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) throw new Error(`${domain}: not a PNG`);
  await writeFile(join(dir, `${key}.png`), bytes);
  console.log(`${key.padEnd(10)} ${domain.padEnd(16)} ${bytes.length} bytes`);
}
console.log("\nWritten to public/chains/. Commit the PNGs; the hero picks them up on the next deploy.");
