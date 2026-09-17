"use client";
import { useState } from "react";

// One rolling hero word: the chain's mark (when public/chains/<x>.png exists)
// followed by its gradient name. A missing or failed image simply disappears,
// so the hero never shows a broken-image icon; a failure is remembered for the
// page's lifetime so the beat does not re-request a missing file every turn.
const MISSING = new Set<string>();

export function ChainWord({ name, logo, suffix = "," }: { name: string; logo: string; suffix?: string }) {
  const [broken, setBroken] = useState(() => MISSING.has(logo));
  return (
    <>
      {!broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="chain-logo"
          src={logo}
          alt=""
          onError={() => {
            MISSING.add(logo);
            setBroken(true);
          }}
        />
      )}
      <span className="grad">
        {name}
        {suffix}
      </span>
    </>
  );
}
