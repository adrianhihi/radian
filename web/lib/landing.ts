// Landing scroll choreography (pure functions, no DOM / WebGL).
//
// The first screen is a sticky stage inside a container taller than the
// viewport; scroll progress 0→1 drives three things at once — the copy stages
// entering and leaving, the glass cards, and which frame of the image sequence
// is shown. One numeric progress feeds both CSS and the WebGL uniform, and the
// stage windows overlap, which is why this is not an IntersectionObserver.

export interface StageWindow {
  /** [starts appearing, fully visible] */
  enter?: readonly [number, number];
  /** [starts leaving, fully gone] */
  exit?: readonly [number, number];
}

export const STAGES = {
  hero: { exit: [0.16, 0.28] },
  mid: { enter: [0.38, 0.46], exit: [0.58, 0.68] },
  cards: { enter: [0.76, 0.84] },
  final: { enter: [0.82, 0.9] },
} as const satisfies Record<string, StageWindow>;

export type StageName = keyof typeof STAGES;

/** Total scroll height of the scene (vh). 380vh → 280vh of travel over 120 frames ≈ 2.33vh per frame. */
export const SCENE_HEIGHT_VH = 380;

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : clamp((v - a) / (b - a)));
export const smooth = (t: number) => t * t * (3 - 2 * t);

export interface StageStyle {
  opacity: number;
  y: number;
  /** false → visibility:hidden (opacity 0 alone still swallows pointer events) */
  visible: boolean;
}

/** A stage's presentation at a given progress. Enter is checked before exit so overlapping windows never flicker. */
export function stageStyle(progress: number, w: StageWindow): StageStyle {
  if (w.enter && progress < w.enter[1]) {
    const t = smooth(invLerp(w.enter[0], w.enter[1], progress));
    return { opacity: t, y: lerp(24, 0, t), visible: t > 0.002 };
  }
  if (w.exit && progress > w.exit[0]) {
    const t = smooth(invLerp(w.exit[0], w.exit[1], progress));
    const opacity = 1 - t;
    return { opacity, y: lerp(0, -16, t), visible: opacity > 0.002 };
  }
  return { opacity: 1, y: 0, visible: true };
}

/** Word-by-word reveal within a stage's enter window; words are staggered, the body follows. */
export function wordReveal(progress: number, w: StageWindow, index: number, total: number): number {
  if (!w.enter) return 1;
  const t = invLerp(w.enter[0], w.enter[1], progress);
  const stagger = (index / Math.max(total, 1)) * 0.58;
  return clamp((t - stagger) / 0.34);
}

export function bodyReveal(progress: number, w: StageWindow): number {
  if (!w.enter) return 1;
  const t = invLerp(w.enter[0], w.enter[1], progress);
  return clamp((t - 0.62) / 0.38);
}

/** Scroll progress → frame index. round, not floor: progress 1.0 must reach the last frame. */
export function frameIndex(progress: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.round(clamp(progress) * (frameCount - 1));
}
