export interface Vec {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
/** z-component of a × b (positive when b is counter-clockwise from a). */
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
/** Rotate by +90° (counter-clockwise). */
export const rot90 = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Relative tolerance used for degeneracy tests. */
export const EPS = 1e-9;

export const isFiniteVec = (p: Vec): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Points closer than this (relative to the scale of the figure) are considered equal. */
export function nearlyEqual(a: Vec, b: Vec, scaleHint = 1): boolean {
  return dist(a, b) <= EPS * Math.max(1, scaleHint);
}
