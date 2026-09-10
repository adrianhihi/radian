"use client";
import { useEffect, useRef, useState } from "react";
import { NETWORKS, getActiveNetworkKey, setActiveNetwork, type NetworkKey } from "@/lib/networks";

export function NetworkSwitcher() {
  const [active, setActive] = useState<NetworkKey>("testnet");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(getActiveNetworkKey()), []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const cur = NETWORKS[active];

  return (
    <div className="netsw" ref={ref}>
      <button className="netsw-btn" onClick={() => setOpen((o) => !o)} title="Switch network">
        <span className={`netsw-dot ${cur.live ? "on" : "off"}`} />
        {cur.label}
        <span className="netsw-caret">▾</span>
      </button>
      {open && (
        <div className="netsw-menu">
          {(Object.keys(NETWORKS) as NetworkKey[])
            .filter((k) => !NETWORKS[k].hidden || k === active)
            .map((k) => {
            const n = NETWORKS[k];
            return (
              <button
                key={k}
                className={`netsw-item${k === active ? " active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (k !== active) setActiveNetwork(k);
                }}
              >
                <span className={`netsw-dot ${n.live ? "on" : "off"}`} />
                <span style={{ flex: 1, textAlign: "left" }}>
                  {n.chainName}
                  <span className="netsw-sub">{n.live ? `chain ${n.chainId}` : "Sept 16"}</span>
                </span>
                {k === active && <span style={{ color: "var(--radian-2)" }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
