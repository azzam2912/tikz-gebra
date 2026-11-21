import type { Construction, DrawingSpec, Literal, PointId, SourceLang, Span } from '../parser/ast';

export type { Construction, DrawingSpec, Literal, PointId, Span };

export interface Step {
  /** Stable id: the defined point name(s) joined by "+". */
  id: string;
  c: Construction;
  /** Source span of the statement, or null if the step was not produced by the parser. */
  span: Span | null;
  /** Free points: where their numbers are written (dragging edits them in place). */
  lit?: Literal;
}

export interface Drawing {
  id: string;
  d: DrawingSpec;
  span: Span | null;
}

export interface Graph {
  /** Topologically ordered (stable w.r.t. source order). */
  steps: Step[];
  /** point name → id of the step that defines it */
  producer: Map<PointId, string>;
  drawings: Drawing[];
  /** Language of the source this graph was built from. */
  lang?: SourceLang;
  /** Named colours from the source (\definecolor / Asymptote pens), name → CSS colour. */
  colors?: Record<string, string>;
}

export const stepId = (c: Construction): string => c.out.join('+');

export const isFree = (c: Construction): c is Extract<Construction, { op: 'free' }> => c.op === 'free';

/** Structural view of a graph (no spans / ids), used for equality checks. */
export function structure(g: Graph): { steps: Construction[]; drawings: DrawingSpec[] } {
  return { steps: g.steps.map((s) => s.c), drawings: g.drawings.map((d) => d.d) };
}

/** Return a copy of the graph with free point `name` moved to (x, y). */
export function moveFreePoint(g: Graph, name: PointId, x: number, y: number): Graph {
  return {
    ...g,
    steps: g.steps.map((s) =>
      s.c.op === 'free' && s.c.out[0] === name ? { ...s, c: { ...s.c, x, y } } : s,
    ),
  };
}
