// Language-neutral description of a figure: construction steps + drawing commands.
//
// The model is "tkz-euclide shaped": every construction and drawing has a tkz-euclide
// counterpart (codegen/codegen.ts), and the other front ends (plain TikZ, Asymptote) map
// onto it. Asymptote expressions without such a counterpart become `expr` steps.

/** Half-open character range [from, to) into the source text. */
export interface Span {
  from: number;
  to: number;
}

/** A point name exactly as written in TeX (A, O', M_1 ...). Internal helper points start with "~". */
export type PointId = string;

export type CenterKind = 'circum' | 'in' | 'ex' | 'centroid' | 'ortho' | 'euler';

/** How a pair of intersection points is ordered. */
export type InterOrder =
  /** tkz-euclide 5.06c rules (\tkzInterLC / \tkzInterCC), see docs/assumptions.md */
  | 'tkz'
  /** tkz-euclide [common=X]: the second point is X (args[4]), the first one the other point */
  | 'common'
  /** tkz-euclide [near] (\tkzInterLC): the first point is the one nearer to A */
  | 'near'
  /** Asymptote geometry module (line/circle objects): ascending y, ascending x for a horizontal line */
  | 'asy-y'
  /** Asymptote path intersections, first path a circle: by angle around it, from 0° counter-clockwise
   *  (interLC: the circle (O,C); interCC: the first circle) */
  | 'asy-path1'
  /** Asymptote path intersections, first path the segment/line: along A→B (interLC only) */
  | 'asy-path2';

/** Asymptote expression (see asy/ast.ts); kept opaque here. */
export interface ExprNode {
  readonly k: string;
}

/**
 * One construction step. `args` are the referenced points, `out` the defined ones.
 * Argument order always follows the order in which the points appear in the TeX command.
 */
export type Construction =
  /** Free point. `polar`: written as (angle:radius); dragging then keeps the radius. */
  | { op: 'free'; args: []; out: [PointId]; x: number; y: number; polar?: true }
  /** \tkzDefMidPoint(A,B) */
  | { op: 'midpoint'; args: [PointId, PointId]; out: [PointId] }
  /** \tkzDefPointOnLine[pos=t](A,B) → A + t(B − A) (Asymptote: interp(A,B,t)) */
  | { op: 'onLine'; args: [PointId, PointId]; out: [PointId]; t: number }
  /** \tkzDefPointBy[projection=onto A--B](P)  → args [P, A, B] */
  | { op: 'projection'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefPointBy[reflection=over A--B](P)  → args [P, A, B] */
  | { op: 'reflection'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefPointBy[symmetry=center C](P) → args [P, C]  (2C − P) */
  | { op: 'symmetry'; args: [PointId, PointId]; out: [PointId] }
  /** \tkzDefPointBy[homothety=center C ratio k](P) → args [P, C] */
  | { op: 'homothety'; args: [PointId, PointId]; out: [PointId]; k: number }
  /** \tkzDefPointBy[rotation=center C angle a](P) → args [P, C], degrees, counter-clockwise */
  | { op: 'rotation'; args: [PointId, PointId]; out: [PointId]; angle: number }
  /** \tkzDefPointBy[translation=from A to B](P) → args [P, A, B]  (P + B − A) */
  | { op: 'translation'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefShiftPoint[A](dx,dy){P} or [A](angle:r) */
  | { op: 'shift'; args: [PointId]; out: [PointId]; dx: number; dy: number; polar?: true }
  /** \tkzDefLine[orthogonal=through C](A,B) → args [C, A, B] */
  | { op: 'orthLine'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefLine[parallel=through C](A,B) → args [C, A, B] */
  | { op: 'parLine'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzDefLine[tangent at=C](O) → args [C, O] */
  | { op: 'tangentAt'; args: [PointId, PointId]; out: [PointId] }
  /** \tkzDefMidArc(O,A,B) */
  | { op: 'midArc'; args: [PointId, PointId, PointId]; out: [PointId] }
  /** \tkzInterLL(A,B)(C,D) */
  | { op: 'interLL'; args: [PointId, PointId, PointId, PointId]; out: [PointId] }
  /** \tkzInterLC(A,B)(O,C) → line AB, circle centre O through C (args[4]: the common point, order 'common').
   *  `seg` (Asymptote paths): AB is a segment; intersection points outside it don't exist. */
  | { op: 'interLC'; args: InterArgs; out: [PointId, PointId]; order?: InterOrder; seg?: true }
  /** \tkzInterCC(O,A)(O',B) */
  | { op: 'interCC'; args: InterArgs; out: [PointId, PointId]; order?: InterOrder }
  /** \tkzDefTriangleCenter[kind](A,B,C) */
  | { op: 'center'; kind: CenterKind; args: [PointId, PointId, PointId]; out: [PointId] }
  /** Asymptote expression with no tkz-euclide counterpart; `args` are the points it reads. */
  | { op: 'expr'; args: PointId[]; out: [PointId]; expr: ExprNode; text: string };

export type Op = Construction['op'];

export type InterArgs = [PointId, PointId, PointId, PointId] | [PointId, PointId, PointId, PointId, PointId];

export type DrawCmd =
  | 'tkzDrawSegment'
  | 'tkzDrawSegments'
  | 'tkzDrawLine'
  | 'tkzDrawLines'
  | 'tkzDrawPolygon'
  | 'tkzDrawPolySeg'
  | 'tkzDrawCircle'
  | 'tkzDrawCircles'
  | 'tkzDrawPoint'
  | 'tkzDrawPoints'
  | 'tkzLabelPoint'
  | 'tkzLabelPoints'
  | 'tkzMarkRightAngle'
  | 'tkzMarkAngle'
  | 'tkzMarkSegment'
  | 'tkzMarkSegments'
  | 'tkzFillPolygon'
  | 'tkzFillCircle'
  /** \tkzDrawArc(O,A)(B): groups [[O,A,B]]; counter-clockwise from A towards B, radius OA */
  | 'tkzDrawArc'
  /** \tkzDrawSemiCircle(O,A): groups [[O,A]]; half circle counter-clockwise from A */
  | 'tkzDrawSemiCircle'
  /** \tkzDrawSector(O,A)(B) / \tkzFillSector(O,A)(B): groups [[O,A,B]] */
  | 'tkzDrawSector'
  | 'tkzFillSector'
  /** \tkzLabelAngle[dist=d](A,B,C){text}: groups [[A,B,C]] */
  | 'tkzLabelAngle';

/** Where a drawing was written; decides how `options` is read. */
export type SourceLang = 'tkz' | 'tikz' | 'asy';

/**
 * A drawing command. `groups` holds the referenced points:
 *  - tkzDrawSegments / tkzDrawLines / tkzDrawCircles / tkzMarkSegments: one group per pair
 *  - everything else: exactly one group   [[A,B,C]]
 * `options` is the raw option text (kept verbatim), or null when absent.
 */
export interface DrawingSpec {
  cmd: DrawCmd;
  options: string | null;
  groups: PointId[][];
  /** Text of \tkzLabelPoint (as written, e.g. "$A$"). */
  text?: string;
  /** Front end that produced the drawing when it was not tkz-euclide. */
  src?: 'tikz' | 'asy';
  /** Asymptote: line(A,B) is infinite (drawn across the whole view). */
  infinite?: true;
  /** Asymptote label/dot direction, already evaluated: angle in degrees and distance factor. */
  dir?: { angle: number; k: number } | { of: PointId; k: number } | null;
}

/** Spans of the literal numbers of a free point, for in-place editing when it is dragged. */
export type Literal =
  | { kind: 'xy'; xs: Span[]; ys: Span[] }
  /** polar point: only the angle is rewritten, the radius stays */
  | { kind: 'angle'; spans: Span[]; r: number }
  /** the one number of a derived point that moves it along its object: the ratio of
   *  \tkzDefPointOnLine / homothety, or the angle of a rotation (dragging rewrites it) */
  | { kind: 'param'; spans: Span[] };

export interface DefStatement {
  type: 'def';
  c: Construction;
  /** Whole statement, from the \tkzDef... command through its \tkzGetPoint(s). */
  span: Span;
  /** One span per entry of c.args. */
  argSpans: Span[];
  /** One span per entry of c.out. */
  outSpans: Span[];
  /** Free points only. */
  lit?: Literal;
}

/**
 * Where the style of a drawing is written, so it can be edited in place:
 *  - tkz-euclide / TikZ: `span` is the text inside [..]; `remove` the whole [..];
 *    without options `span` is empty at the insertion point and `insert` is '[..]'.
 *  - Asymptote: `span` is the pen argument; `remove` also covers the ", " before it;
 *    without a pen `span` is empty before ")" and `insert` is ', ..'.
 */
export interface OptSpan {
  span: Span;
  remove?: Span;
  insert?: 'bracket' | 'arg';
}

export interface DrawStatement {
  type: 'draw';
  d: DrawingSpec;
  span: Span;
  /** Mirrors d.groups. */
  refSpans: Span[][];
  /** Where the options / pen are, when they can be edited in place. */
  opt?: OptSpan;
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
  code?: 'forward-ref' | 'ignored';
}

export interface ParseResult {
  statements: Statement[];
  diagnostics: Diagnostic[];
  /** Colours defined in the source (\definecolor, Asymptote pens), name → CSS colour. */
  colors?: Record<string, string>;
}

/** Internal helper points (not written by the user) have names starting with "~". */
export const isAux = (name: PointId): boolean => name.startsWith('~');
