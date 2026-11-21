// Math (y up, 1 unit = 1 cm in TikZ) ↔ screen (y down, px) mapping.

import type { Vec } from '../geom/vec';

export interface Viewport {
  /** Math coordinates shown at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per unit. */
  scale: number;
  /** Canvas size in px. */
  width: number;
  height: number;
}

export const MIN_SCALE = 5;
export const MAX_SCALE = 2000;

export function toScreen(vp: Viewport, p: Vec): Vec {
  return { x: vp.width / 2 + (p.x - vp.cx) * vp.scale, y: vp.height / 2 - (p.y - vp.cy) * vp.scale };
}

export function toMath(vp: Viewport, s: Vec): Vec {
  return { x: vp.cx + (s.x - vp.width / 2) / vp.scale, y: vp.cy - (s.y - vp.height / 2) / vp.scale };
}

/** Zoom by `factor` keeping the math point under screen position `s` fixed. */
export function zoomAt(vp: Viewport, s: Vec, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor));
  const m = toMath(vp, s);
  return {
    ...vp,
    scale,
    cx: m.x - (s.x - vp.width / 2) / scale,
    cy: m.y + (s.y - vp.height / 2) / scale,
  };
}

/** Pan by a screen-space delta. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, cx: vp.cx - dx / vp.scale, cy: vp.cy + dy / vp.scale };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Fit a bounding box into the viewport with some padding (px). */
export function fitBox(vp: Viewport, box: BBox | null, padding = 60): Viewport {
  if (!box) return { ...vp, cx: 0, cy: 0, scale: 50 };
  const w = Math.max(box.maxX - box.minX, 1);
  const h = Math.max(box.maxY - box.minY, 1);
  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.min((vp.width - 2 * padding) / w, (vp.height - 2 * padding) / h)),
  );
  return { ...vp, cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
}

/** Grid step (in units) so that grid lines are at least `minPx` apart. */
export function gridStep(scale: number, minPx = 24): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  return steps.find((s) => s * scale >= minPx) ?? 1000;
}
