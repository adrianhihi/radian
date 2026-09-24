// A treemap whose tiles are readable rather than strictly proportional (baskvia's weight
// layout): squarified placement, and a display floor that rises one point at a time until
// every tile is at least minW × minH — falling back to equal tiles, which always fit.

export interface WeightTile {
  /** index into the input array */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_TILE_W = 62;
export const MIN_TILE_H = 48;

/** panel height: taller on narrow screens, else 6–8 items cannot get wide enough tiles */
export const panelHeight = (width: number): number => (width < 560 ? 400 : 340);

interface Item {
  index: number;
  area: number;
}

function squarify(items: Item[], W: number, H: number): WeightTile[] {
  const out: WeightTile[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  let row: Item[] = [];
  const worst = (r: Item[], side: number) => {
    const s = r.reduce((n, it) => n + it.area, 0);
    const mx = Math.max(...r.map((it) => it.area));
    const mn = Math.min(...r.map((it) => it.area));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = () => {
    const s = row.reduce((n, it) => n + it.area, 0);
    if (w >= h) {
      const cw = s / h;
      let cy = y;
      for (const it of row) {
        const ch = it.area / cw;
        out.push({ index: it.index, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let cx = x;
      for (const it of row) {
        const cw = it.area / rh;
        out.push({ index: it.index, x: cx, y, w: cw, h: rh });
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };
  const rest = [...items];
  while (rest.length) {
    const side = Math.min(w, h);
    const c = rest[0];
    if (!row.length || worst([...row, c], side) <= worst(row, side)) {
      row.push(c);
      rest.shift();
    } else {
      place();
    }
  }
  if (row.length) place();
  return out;
}

function layoutWithFloor(weights: number[], W: number, H: number, floor: number): WeightTile[] {
  const shown = weights.map((v) => Math.max(v, floor));
  const sum = shown.reduce((n, v) => n + v, 0) || 1;
  const items = shown.map((v, index) => ({ index, area: (v / sum) * W * H })).sort((a, b) => b.area - a.area || a.index - b.index);
  return squarify(items, W, H);
}

/** weights in percent (need not sum to 100); px coordinates for a W × H panel. */
export function weightLayout(weights: number[], W: number, H: number, minW: number = MIN_TILE_W, minH: number = MIN_TILE_H): WeightTile[] {
  const n = weights.length;
  if (!n || W <= 0 || H <= 0) return [];
  const equal = 100 / n;
  const fits = (t: WeightTile[]) => t.every((r) => r.w >= minW - 0.5 && r.h >= minH - 0.5);
  for (let floor = 5; floor < equal; floor += 1) {
    const t = layoutWithFloor(weights, W, H, floor);
    if (fits(t)) return t;
  }
  return layoutWithFloor(weights, W, H, equal);
}
