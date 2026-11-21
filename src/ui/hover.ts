import type { Graph } from '../graph/types';
import type { Span } from '../parser/ast';

/** What is hovered (on the canvas or in the code): a construction step or a drawing, by id. */
export type HoverTarget = { kind: 'step'; id: string } | { kind: 'drawing'; id: string } | null;

/** Which step / drawing a source offset belongs to (innermost = smallest span). */
export function targetAt(g: Graph, offset: number): HoverTarget {
  let best: { t: HoverTarget; size: number } | null = null;
  const consider = (t: HoverTarget, span: Span | null) => {
    if (!span || offset < span.from || offset > span.to) return;
    const size = span.to - span.from;
    if (!best || size < best.size) best = { t, size };
  };
  for (const s of g.steps) consider({ kind: 'step', id: s.id }, s.span);
  for (const d of g.drawings) consider({ kind: 'drawing', id: d.id }, d.span);
  return (best as { t: HoverTarget } | null)?.t ?? null;
}
