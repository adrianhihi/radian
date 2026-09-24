"use client";

// Tables on the design system: mono-label head, hairline rows, horizontal
// scroll on phones. Cells take the TD / TD_NUM / TD_MONO classes.
export const TD = "px-3 py-2.5 align-top text-ink-2";
export const TD_NUM = "tnum whitespace-nowrap px-3 py-2.5 text-right align-top text-ink";
export const TD_MONO = "px-3 py-2.5 align-top font-mono text-[12px] text-ink-2 [overflow-wrap:anywhere]";

export function DataTable({ head, children, className = "", align = [] }: { head: React.ReactNode[]; children: React.ReactNode; className?: string; align?: ("left" | "right")[] }) {
  return (
    <div className={`overflow-x-auto rounded-[12px] border border-stroke ${className}`}>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={`mono-label whitespace-nowrap border-b border-stroke bg-glass-2 px-3 py-2 text-[10px] font-normal tracking-[.14em] text-ink-3 ${align[i] === "right" ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stroke">{children}</tbody>
      </table>
    </div>
  );
}

/** A live status dot for feeds. */
export function LiveDot() {
  return <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-pos shadow-[0_0_0_4px_rgba(108,199,154,.18)]" />;
}
