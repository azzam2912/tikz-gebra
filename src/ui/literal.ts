// In-place editing of a dragged free point: only its numbers in the source change, so comments,
// formatting and everything else stay exactly as written.

import { fmt, fmtK } from '../codegen/codegen';
import type { Evaluated } from '../geom/evaluate';
import { dist, sub, type Vec } from '../geom/vec';
import type { Construction, Graph, PointId } from '../graph/types';
import type { Literal, Span } from '../parser/ast';
import { roundCoord } from './rounding';

export interface Edit {
  span: Span;
  text: string;
}

/**
 * Edits that move a free point with literal `lit` to (x, y).
 * Cartesian points get rounded coordinates; polar points (75:1), dir(75) keep their radius
 * and only the angle changes (rounded to 0.01°, or to 5° when snapping).
 * Returns the new position too (for "did it change" checks), or null if nothing changes.
 */
export function moveEdits(lit: Literal, x: number, y: number, snap: boolean): { edits: Edit[]; at: { x: number; y: number } } | null {
  if (lit.kind === 'xy') {
    const nx = roundCoord(x, snap);
    const ny = roundCoord(y, snap);
    return {
      edits: [...lit.xs.map((span) => ({ span, text: fmt(nx) })), ...lit.ys.map((span) => ({ span, text: fmt(ny) }))],
      at: { x: nx, y: ny },
    };
  }
  if (lit.kind === 'param' || (x === 0 && y === 0)) return null;
  let a = (Math.atan2(y, x) * 180) / Math.PI;
  a = snap ? Math.round(a / 5) * 5 : Math.round(a * 100) / 100;
  if (Object.is(a, -0)) a = 0;
  const t = (a * Math.PI) / 180;
  return { edits: lit.spans.map((span) => ({ span, text: fmt(a) })), at: { x: lit.r * Math.cos(t), y: lit.r * Math.sin(t) } };
}

/** Apply non-overlapping edits to a text (any order). */
export function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.span.from - a.span.from);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.span.from) + e.text + out.slice(e.span.to);
  return out;
}

// ------------------------------------------------------------------ gliders

const deg = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** Is AB drawn only as a segment (or polygon side), so a point on it should stay between A and B? */
export function segmentOnly(g: Graph, a: PointId, b: PointId): boolean {
  let seg = false;
  for (const { d } of g.drawings) {
    const pairs: [PointId, PointId][] = [];
    if (d.cmd === 'tkzDrawPolygon' || d.cmd === 'tkzFillPolygon' || d.cmd === 'tkzDrawPolySeg') {
      const v = d.groups[0]!;
      for (let i = 0; i + 1 < v.length; i++) pairs.push([v[i]!, v[i + 1]!]);
      if (d.cmd !== 'tkzDrawPolySeg' && v.length > 2) pairs.push([v[v.length - 1]!, v[0]!]);
    } else if (['tkzDrawSegment', 'tkzDrawSegments', 'tkzDrawLine', 'tkzDrawLines'].includes(d.cmd)) {
      for (const grp of d.groups) pairs.push([grp[0]!, grp[1]!]);
    } else continue;
    for (const [p, q] of pairs) {
      if (!((p === a && q === b) || (p === b && q === a))) continue;
      if (d.cmd === 'tkzDrawLine' || d.cmd === 'tkzDrawLines') return false;
      seg = true;
    }
  }
  return seg;
}

/**
 * Edits that move a derived point with a `param` literal towards the mouse position m:
 * \tkzDefPointOnLine / interp → the position t, homothety → the ratio, rotation → the angle.
 * The point slides along its line or circle. `clamp` keeps t in [0, 1].
 */
export function paramEdits(c: Construction, lit: Literal, pos: Evaluated, m: Vec, snap: boolean, clamp = false): { edits: Edit[]; value: number } | null {
  if (lit.kind !== 'param') return null;
  const P = c.args.map((n) => pos.get(n) ?? null);
  if (P.some((p) => !p)) return null;
  let value: number;
  if (c.op === 'onLine' || c.op === 'homothety') {
    // onLine: A + t(B − A);  homothety (args [P, C]): C + k(P − C)
    const [from, to] = c.op === 'onLine' ? [P[0]!, P[1]!] : [P[1]!, P[0]!];
    const d = sub(to, from);
    const l2 = d.x * d.x + d.y * d.y;
    if (l2 === 0) return null;
    value = ((m.x - from.x) * d.x + (m.y - from.y) * d.y) / l2;
    if (clamp) value = Math.max(0, Math.min(1, value));
    value = snap ? Math.round(value / 0.05) * 0.05 : Math.round(value * 1000) / 1000;
  } else if (c.op === 'rotation') {
    const [p, o] = [P[0]!, P[1]!];
    if (dist(p, o) === 0 || dist(m, o) === 0) return null;
    // stay next to the current angle (no jump from 179° to −179°)
    let a = deg(sub(m, o)) - deg(sub(p, o));
    a = c.angle + ((((a - c.angle) % 360) + 540) % 360) - 180;
    value = snap ? Math.round(a / 5) * 5 : Math.round(a * 10) / 10;
  } else return null;
  if (Object.is(value, -0)) value = 0;
  return { edits: lit.spans.map((span) => ({ span, text: fmtK(value) })), value };
}
