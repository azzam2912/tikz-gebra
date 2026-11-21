// In-place editing of a dragged free point: only its numbers in the source change, so comments,
// formatting and everything else stay exactly as written.

import { fmt } from '../codegen/codegen';
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
  if (x === 0 && y === 0) return null;
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
