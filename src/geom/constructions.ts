// Pure geometry. Every function returns `null` for degenerate input instead of NaN/Infinity.
// The conventions (orientation, order of the two intersection points) follow
// tkz-euclide 5.06c; see docs/assumptions.md.

import { add, cross, dist, dot, EPS, isFiniteVec, len, rot90, scale, sub, type Vec } from './vec';

const ok = (p: Vec): Vec | null => (isFiniteVec(p) ? p : null);

/** A ≈ B relative to the figure size. */
function same(a: Vec, b: Vec): boolean {
  const s = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  return dist(a, b) <= EPS * s;
}

export function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Foot of the perpendicular from P onto line AB. */
export function projection(p: Vec, a: Vec, b: Vec): Vec | null {
  if (same(a, b)) return null;
  const d = sub(b, a);
  const t = dot(sub(p, a), d) / dot(d, d);
  return ok(add(a, scale(d, t)));
}

/**
 * \tkzDefLine[orthogonal=through C](A,B): C + rot90(B − A).
 * (tkz-euclide: \tkzDefPointWith(A,B) → A + (−Δy, Δx), then translated to C.)
 */
export function orthogonalThrough(c: Vec, a: Vec, b: Vec): Vec | null {
  if (same(a, b)) return null;
  return ok(add(c, rot90(sub(b, a))));
}

/** \tkzDefLine[parallel=through C](A,B): C + (B − A). */
export function parallelThrough(c: Vec, a: Vec, b: Vec): Vec | null {
  if (same(a, b)) return null;
  return ok(add(c, sub(b, a)));
}

/** Intersection of lines AB and CD; null if parallel or a line is degenerate. */
export function interLL(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  if (same(a, b) || same(c, d)) return null;
  const r = sub(b, a);
  const s = sub(d, c);
  const denom = cross(r, s);
  if (Math.abs(denom) <= EPS * len(r) * len(s)) return null; // parallel (or identical)
  const t = cross(sub(c, a), s) / denom;
  return ok(add(a, scale(r, t)));
}

/**
 * \tkzInterLC(A,B)(O,C): line AB ∩ circle (centre O through C).
 *
 * Order (tkz-euclide 5.06c, no options): the first point F is the one for which
 * the centre O lies to the LEFT of the directed segment F→S (S = second point).
 * Equivalently: if O is left of A→B, F comes first along A→B, otherwise last.
 * If the line goes through the centre, tkz-euclide yields
 * F = O − r·û, S = O + r·û with û = (B−A)/|B−A|.
 * Tangent: both points coincide. No intersection: null.
 */
export function interLC(a: Vec, b: Vec, o: Vec, c: Vec): [Vec, Vec] | null {
  if (same(a, b)) return null;
  const r = dist(o, c);
  if (r <= 0) return null;
  const d = sub(b, a);
  const u = scale(d, 1 / len(d));
  const h = add(a, scale(u, dot(sub(o, a), u))); // foot from O
  const off = cross(u, sub(o, a)); // signed distance of O from the line (>0: left)
  const tol = EPS * Math.max(1, r);
  if (Math.abs(off) > r + tol) return null;
  // tkz-euclide's own threshold for "line through the centre" is 0.05pt ≈ 0.00176 cm
  let res: [Vec, Vec];
  if (Math.abs(off) < (0.05 / 72.27) * 2.54) {
    res = [sub(o, scale(u, r)), add(o, scale(u, r))];
  } else {
    const half = Math.sqrt(Math.max(0, r * r - off * off));
    const p = sub(h, scale(u, half)); // earlier along A→B
    const q = add(h, scale(u, half)); // later along A→B
    res = off > 0 ? [p, q] : [q, p];
  }
  return isFiniteVec(res[0]) && isFiniteVec(res[1]) ? res : null;
}

/**
 * \tkzInterCC(O1,A)(O2,B): circle (O1 through A) ∩ circle (O2 through B).
 * Order (tkz-euclide 5.06c): the first point lies to the LEFT of the directed line O1→O2.
 * Concentric / disjoint / nested circles: null. Tangent: both points coincide.
 */
export function interCC(o1: Vec, a: Vec, o2: Vec, b: Vec): [Vec, Vec] | null {
  const r1 = dist(o1, a);
  const r2 = dist(o2, b);
  const d = dist(o1, o2);
  const tol = EPS * Math.max(1, r1 + r2);
  if (r1 <= 0 || r2 <= 0 || d <= tol) return null;
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return null;
  const along = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, r1 * r1 - along * along));
  const e = scale(sub(o2, o1), 1 / d);
  const m = add(o1, scale(e, along));
  const n = rot90(e);
  const res: [Vec, Vec] = [add(m, scale(n, hh)), sub(m, scale(n, hh))];
  return isFiniteVec(res[0]) && isFiniteVec(res[1]) ? res : null;
}

/** Twice the signed area of ABC; ~0 for collinear points. */
function collinear(a: Vec, b: Vec, c: Vec): boolean {
  const area2 = cross(sub(b, a), sub(c, a));
  const s = Math.max(dist(a, b), dist(b, c), dist(c, a));
  return s === 0 || Math.abs(area2) <= EPS * s * s;
}

export function circumcenter(a: Vec, b: Vec, c: Vec): Vec | null {
  if (collinear(a, b, c)) return null;
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return ok({
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  });
}

export function incenter(a: Vec, b: Vec, c: Vec): Vec | null {
  if (collinear(a, b, c)) return null;
  const la = dist(b, c);
  const lb = dist(c, a);
  const lc = dist(a, b);
  const p = la + lb + lc;
  return ok({ x: (la * a.x + lb * b.x + lc * c.x) / p, y: (la * a.y + lb * b.y + lc * c.y) / p });
}

export function centroid(a: Vec, b: Vec, c: Vec): Vec {
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

export function orthocenter(a: Vec, b: Vec, c: Vec): Vec | null {
  const o = circumcenter(a, b, c);
  if (!o) return null;
  // H = A + B + C − 2·O (Euler)
  return ok({ x: a.x + b.x + c.x - 2 * o.x, y: a.y + b.y + c.y - 2 * o.y });
}
