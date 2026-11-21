// Syntax-level description of a tkz-euclide document (the supported subset).

/** Half-open character range [from, to) into the source text. */
export interface Span {
  from: number;
  to: number;
}

/** A point name exactly as written in TeX (A, O', M_1 ...). */
export type PointId = string;

export type CenterKind = 'circum' | 'in' | 'centroid' | 'ortho';

/**
 * One construction step. `args` are the referenced points, `out` the defined ones.
 * Argument order always follows the order in which the points appear in the TeX command.
 */
export type Construction =
  | { op: 'free'; args: []; out: [PointId]; x: number; y: number }
  /** \tkzDefMidPoint(A,B) */
  | { op: 'midpoint'; args: [PointId, PointId]; out: [PointId] }
  /** \tkzDefPointBy[projection=onto A--B](P)  → args [P, A, B] */
  | { op: 'projection'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefLine[orthogonal=through C](A,B) → args [C, A, B] */
  | { op: 'orthLine'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefLine[parallel=through C](A,B) → args [C, A, B] */
  | { op: 'parLine'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzInterLL(A,B)(C,D) */
  | { op: 'interLL'; args: [PointId, PointId, PointId, PointId]; out: [PointId] }
  /** \tkzInterLC(A,B)(O,C) → line AB, circle centre O through C */
  | { op: 'interLC'; args: [PointId, PointId, PointId, PointId]; out: [PointId, PointId] }
  /** \tkzInterCC(O,A)(O',B) */
  | { op: 'interCC'; args: [PointId, PointId, PointId, PointId]; out: [PointId, PointId] }
  /** \tkzDefTriangleCenter[kind](A,B,C) */
  | { op: 'center'; kind: CenterKind; args: [PointId, PointId, PointId]; out: [PointId] };

export type Op = Construction['op'];

export type DrawCmd =
  | 'tkzDrawSegment'
  | 'tkzDrawSegments'
  | 'tkzDrawLine'
  | 'tkzDrawPolygon'
  | 'tkzDrawCircle'
  | 'tkzDrawPoints'
  | 'tkzLabelPoints';

/**
 * A drawing command. `groups` holds the referenced points:
 *  - tkzDrawSegments: one group per pair  [[A,B],[B,C]]
 *  - everything else: exactly one group   [[A,B,C]]
 * `options` is the raw text inside [...] (kept verbatim), or null when absent.
 */
export interface DrawingSpec {
  cmd: DrawCmd;
  options: string | null;
  groups: PointId[][];
}

export interface DefStatement {
  type: 'def';
  c: Construction;
  /** Whole statement, from the \tkzDef... command through its \tkzGetPoint(s). */
  span: Span;
  /** One span per entry of c.args. */
  argSpans: Span[];
  /** One span per entry of c.out. */
  outSpans: Span[];
}

export interface DrawStatement {
  type: 'draw';
  d: DrawingSpec;
  span: Span;
  /** Mirrors d.groups. */
  refSpans: Span[][];
}

export type Statement = DefStatement | DrawStatement;

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  severity: Severity;
  message: string;
  from: number;
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** Machine-readable kind, for diagnostics the UI reacts to. */
  code?: 'forward-ref';
}

export interface ParseResult {
  statements: Statement[];
  diagnostics: Diagnostic[];
}
