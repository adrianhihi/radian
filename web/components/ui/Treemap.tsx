"use client";

// Weighted treemap: slice-and-dice layout, each cell coloured by its own share
// (absolute ramp, so 30% looks the same in every split) or by a given colour,
// with label and percentage. Used for fee splits and holdings composition.
import { svgId } from "@/lib/ui/format";
import { monogram, onColor, weightColor } from "@/lib/ui/tokens";

export interface TreemapItem {
  sym: string;
  pct: number;
  color?: string;
  /** optional image (logo) drawn in big cells */
  logo?: string | null;
}

export interface TreemapCell extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TREEMAP_W = 160;
export const TREEMAP_W_WIDE = 270;

export function treemapLayout(items: TreemapItem[], vw: number = TREEMAP_W): TreemapCell[] {
  const rects: TreemapCell[] = [];
  const split = (list: TreemapItem[], x: number, y: number, w: number, h: number, horiz: boolean): void => {
    if (list.length === 1) {
      rects.push({ ...list[0], x, y, w, h });
      return;
    }
    const sub = list.reduce((s, i) => s + Math.max(0.01, i.pct), 0);
    const frac = Math.max(0.01, list[0].pct) / sub;
    if (horiz) {
      const w1 = w * frac;
      rects.push({ ...list[0], x, y, w: w1, h });
      split(list.slice(1), x + w1, y, w - w1, h, false);
    } else {
      const h1 = h * frac;
      rects.push({ ...list[0], x, y, w, h: h1 });
      split(list.slice(1), x, y + h1, w, h - h1, true);
    }
  };
  split(items, 0, 0, vw, 100, true);
  return rects;
}

export function Treemap({ id, items, label, vw = TREEMAP_W }: { id: string; items: TreemapItem[]; label: string; vw?: number }) {
  if (!items.length) return null;
  const rects = treemapLayout(items, vw);
  const base = `tm${svgId(id)}`;
  return (
    <svg viewBox={`0 0 ${vw} 100`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={label} className="block w-full rounded-xl bg-glass-2" style={{ aspectRatio: `${vw} / 100` }}>
      <defs>
        {rects.map((r) => (
          <clipPath key={r.sym} id={`${base}-c-${svgId(r.sym)}`}>
            <rect x={(r.x + 4).toFixed(2)} y={(r.y + 4).toFixed(2)} width="11" height="11" rx="3" />
          </clipPath>
        ))}
      </defs>
      {rects.map((r) => {
        const big = r.w > 38 && r.h > 26;
        const fill = r.color ?? weightColor(r.pct);
        const ink = onColor(fill);
        const pctText = `${Math.round(r.pct * 10) / 10}%`;
        return (
          <g key={r.sym}>
            <rect className="[transition:filter_.18s,stroke-opacity_.18s] hover:brightness-110 hover:[stroke-opacity:.55]" x={(r.x + 0.5).toFixed(2)} y={(r.y + 0.5).toFixed(2)} width={(r.w - 1).toFixed(2)} height={(r.h - 1).toFixed(2)} rx="3" fill={fill} stroke="#fff" strokeOpacity=".15" />
            {big ? (
              <>
                {r.logo && (
                  <>
                    <rect x={(r.x + 4).toFixed(2)} y={(r.y + 4).toFixed(2)} width="11" height="11" rx="3" fill="#fff" />
                    <image href={r.logo} x={(r.x + 4).toFixed(2)} y={(r.y + 4).toFixed(2)} width="11" height="11" preserveAspectRatio="xMidYMid meet" clipPath={`url(#${base}-c-${svgId(r.sym)})`} />
                  </>
                )}
                <text x={(r.x + (r.logo ? 18 : 5)).toFixed(2)} y={(r.y + 12.6).toFixed(2)} fontSize="5.4" fontWeight="650" fill={ink}>
                  {r.sym}
                </text>
                <text x={(r.x + r.w - 4).toFixed(2)} y={(r.y + r.h - 4).toFixed(2)} textAnchor="end" fontSize="8.5" fontWeight="650" fill={ink}>
                  {pctText}
                </text>
              </>
            ) : (
              <>
                <text x={(r.x + r.w / 2).toFixed(2)} y={(r.y + r.h / 2 - 1).toFixed(2)} textAnchor="middle" fontSize="5" fontWeight="600" fill={ink}>
                  {r.w > 14 ? r.sym : monogram(r.sym)}
                </text>
                <text x={(r.x + r.w / 2).toFixed(2)} y={(r.y + r.h / 2 + 6).toFixed(2)} textAnchor="middle" fontSize="4.6" fill={ink} fillOpacity=".85">
                  {pctText}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
