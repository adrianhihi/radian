"use client";
import type { IdentityResult } from "@/lib/identity";
import { useNetwork } from "@/lib/networks";

// Shown above any action panel. A proven code-hash mismatch is a hard stop;
// "unverified" only informs.
export function IdentityBanner({ identity }: { identity: IdentityResult }) {
  if (identity.checked && identity.ok) return null;
  if (!identity.checked && !identity.error) return null; // nothing pinned yet (e.g. mainnet pre-deploy)
  const bad = identity.checked && !identity.ok;
  return (
    <div
      role="alert"
      className="panel"
      style={{
        marginBottom: 16,
        borderColor: bad ? "var(--down)" : "var(--border)",
        background: bad ? "color-mix(in srgb, var(--down) 10%, transparent)" : undefined,
      }}
    >
      {bad ? (
        <>
          <strong style={{ color: "var(--down)" }}>Contract identity changed. Launching and trading are disabled.</strong>
          <p className="hint" style={{ marginTop: 6 }}>
            The live code of {identity.results.filter((r) => !r.ok).map((r) => r.name).join(", ")} does not match the hash this site
            was built with. Do not sign anything until the team explains why. <a href="/verify" style={{ color: "var(--radian-2)" }}>Details →</a>
          </p>
        </>
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          Contract identity could not be verified right now ({identity.error}). Reads and quotes still work; verify manually on{" "}
          <a href="/verify" style={{ color: "var(--radian-2)" }}>the verify page</a> before signing.
        </p>
      )}
    </div>
  );
}

// A transaction whose receipt we could not get: recorded, still being checked, never resent.
export function PendingBar({ hash, onClose }: { hash: `0x${string}` | null; onClose: () => void }) {
  const net = useNetwork();
  if (!hash) return null;
  return (
    <div className="panel" style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span className="spinner" />
      <span style={{ flex: 1, minWidth: 220 }}>
        Submitted, waiting for confirmation. This page keeps checking and will <strong>never resend</strong> it.{" "}
        <a href={`${net.explorer}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ color: "var(--radian-2)" }}>
          View on explorer →
        </a>
      </span>
      <button className="btn btn-ghost" onClick={onClose}>Hide</button>
    </div>
  );
}
