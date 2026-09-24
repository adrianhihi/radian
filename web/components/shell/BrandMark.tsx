// The mark: three flat-top hexagons in a 品 arrangement leaving a true
// (transparent) downward triangle in the centre. Same geometry as baskvia's
// mark — the two products are one family — in the Ember palette so they are
// not mistaken for each other.
//
// Geometry (viewBox 120, centre 60,60): outer radius R = 28, centre distance
// d = 1.13R placed at 90° / 210° / 330°. d/R must stay within (0.866, 1.1547)
// for the centre triangle to exist and be closed. Rounded corners come from a
// same-colour 5px stroke with round joins.
import type { CSSProperties } from "react";

export interface BrandPalette {
  top: string;
  left: string;
  right: string;
}

/** Follows the theme tokens. */
export const THEME_PALETTE: BrandPalette = {
  top: "var(--brand-3)",
  left: "var(--brand)",
  right: "var(--brand-2)",
};

/** Fixed dark-skin values for surfaces that never change theme (the landing stage). */
export const DARK_PALETTE: BrandPalette = {
  top: "#f6c489",
  left: "#e8944c",
  right: "#cf6d45",
};

const SHAPES = [
  "M 85.50 28.36 L 72.75 6.28 L 47.25 6.28 L 34.50 28.36 L 47.25 50.44 L 72.75 50.44 Z",
  "M 58.10 75.82 L 45.35 53.74 L 19.85 53.74 L 7.10 75.82 L 19.85 97.90 L 45.35 97.90 Z",
  "M 112.90 75.82 L 100.15 53.74 L 74.65 53.74 L 61.90 75.82 L 74.65 97.90 L 100.15 97.90 Z",
] as const;

export function BrandMark({
  size = 28,
  palette = THEME_PALETTE,
  className,
  style,
}: {
  size?: number;
  palette?: BrandPalette;
  className?: string;
  style?: CSSProperties;
}) {
  const colors = [palette.top, palette.left, palette.right];
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={className} style={style} aria-hidden="true" focusable="false">
      <g transform="translate(0 7.9)">
        {SHAPES.map((d, i) => (
          <path key={d} d={d} fill={colors[i]} stroke={colors[i]} strokeWidth="5" strokeLinejoin="round" />
        ))}
      </g>
    </svg>
  );
}
