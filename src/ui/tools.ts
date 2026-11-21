// GeoGebra-style construction tools. Pure: a tool collects clicks ("picks") on the canvas,
// then produces constructions + drawings, which are written into the code in the current
// language (tkz-euclide or Asymptote) with the normal code generators.

import { constructionAsy, drawingAsy } from '../codegen/asy';
import { constructionCode, drawingCode } from '../codegen/codegen';
import { evaluate, type Evaluated } from '../geom/evaluate';
import { dist, type Vec } from '../geom/vec';
import type { Construction, DrawingSpec, Graph, PointId } from '../graph/types';
import { isAux } from '../parser/ast';
import { compile, type Lang } from '../pipeline';
import { roundCoord } from './rounding';
import { shapesOf } from './shapes';

export type ToolId =
  | 'move'
  | 'point'
  | 'segment'
  | 'line'
  | 'polygon'
  | 'circle'
  | 'circle3'
  | 'midpoint'
  | 'perpBisector'
  | 'perpendicular'
  | 'parallel'
  | 'intersect'
  | 'foot'
  | 'reflectLine'
  | 'reflectPoint'
  | 'circumcenter'
  | 'incenter'
  | 'centroid'
  | 'orthocenter'
  | 'incircle'
  | 'rightAngle'
  | 'angleMark';

/** What a tool needs, in order. 'curve' = a line or a circle. */
export type InputKind = 'point' | 'line' | 'curve';

export interface ToolSpec {
  id: ToolId;
  group: 'basic' | 'lines' | 'points' | 'circles' | 'marks';
  /** inputs in order; the polygon tool takes points until the first one is clicked again */
  inputs: InputKind[] | 'polygon';
}

export const TOOLS: ToolSpec[] = [
  { id: 'move', group: 'basic', inputs: [] },
  { id: 'point', group: 'basic', inputs: ['point'] },
  { id: 'segment', group: 'lines', inputs: ['point', 'point'] },
  { id: 'line', group: 'lines', inputs: ['point', 'point'] },
  { id: 'polygon', group: 'lines', inputs: 'polygon' },
  { id: 'perpendicular', group: 'lines', inputs: ['point', 'line'] },
  { id: 'parallel', group: 'lines', inputs: ['point', 'line'] },
  { id: 'perpBisector', group: 'lines', inputs: ['point', 'point'] },
  { id: 'midpoint', group: 'points', inputs: ['point', 'point'] },
  { id: 'intersect', group: 'points', inputs: ['curve', 'curve'] },
  { id: 'foot', group: 'points', inputs: ['point', 'line'] },
  { id: 'reflectLine', group: 'points', inputs: ['point', 'line'] },
  { id: 'reflectPoint', group: 'points', inputs: ['point', 'point'] },
  { id: 'circumcenter', group: 'points', inputs: ['point', 'point', 'point'] },
  { id: 'incenter', group: 'points', inputs: ['point', 'point', 'point'] },
  { id: 'centroid', group: 'points', inputs: ['point', 'point', 'point'] },
  { id: 'orthocenter', group: 'points', inputs: ['point', 'point', 'point'] },
  { id: 'circle', group: 'circles', inputs: ['point', 'point'] },
  { id: 'circle3', group: 'circles', inputs: ['point', 'point', 'point'] },
  { id: 'incircle', group: 'circles', inputs: ['point', 'point', 'point'] },
  { id: 'rightAngle', group: 'marks', inputs: ['point', 'point', 'point'] },
  { id: 'angleMark', group: 'marks', inputs: ['point', 'point', 'point'] },
];

export const toolSpec = (id: ToolId): ToolSpec => TOOLS.find((t) => t.id === id)!;

/** What was clicked on the canvas. */
export type Target = { kind: 'point'; name: PointId } | { kind: 'drawing'; id: string; at: Vec } | { kind: 'empty'; at: Vec };

/** A resolved input. 'new' is a free point that will be created where the user clicked. */
export type Pick =
  | { kind: 'point'; name: PointId }
  | { kind: 'new'; at: Vec }
  | { kind: 'line'; a: PointId; b: PointId; drawing?: string }
  /** the line through two clicked points (either may be new) */
  | { kind: 'line2'; p: Pick; q: Pick }
  | { kind: 'circle'; c: PointId; th: PointId; drawing?: string };

export interface ToolState {
  tool: ToolId;
  picks: Pick[];
  /** first point of a line given by two points (for 'line'/'curve' inputs) */
  half: Pick | null;
}

export const initialState = (tool: ToolId): ToolState => ({ tool, picks: [], half: null });

/** The input the tool waits for next (null when it needs nothing). */
export function nextInput(s: ToolState): InputKind | null {
  const spec = toolSpec(s.tool);
  if (spec.inputs === 'polygon') return 'point';
  return spec.inputs[s.picks.length] ?? null;
}

/** Line or circle under a click on a drawing (polygons: the nearest side). */
export function curveOfDrawing(g: Graph, pos: Evaluated, id: string, at: Vec): Pick | null {
  const d = g.drawings.find((x) => x.id === id);
  if (!d) return null;
  const cmd = d.d.cmd;
  if (cmd === 'tkzDrawCircle' || cmd === 'tkzDrawCircles' || cmd === 'tkzFillCircle') {
    // the circle whose rim is nearest
    let best: Pick | null = null;
    let bestD = Infinity;
    for (const [c, th] of d.d.groups as [PointId, PointId][]) {
      const pc = pos.get(c);
      const pt = pos.get(th);
      if (!pc || !pt) continue;
      const dd = Math.abs(dist(pc, at) - dist(pc, pt));
      if (dd < bestD) {
        bestD = dd;
        best = { kind: 'circle', c, th, drawing: id };
      }
    }
    return best;
  }
  const lineCmds = ['tkzDrawSegment', 'tkzDrawSegments', 'tkzDrawLine', 'tkzDrawLines', 'tkzDrawPolygon', 'tkzDrawPolySeg', 'tkzFillPolygon'];
  if (!lineCmds.includes(cmd)) return null;
  const pairs: [PointId, PointId][] = [];
  if (cmd === 'tkzDrawPolygon' || cmd === 'tkzDrawPolySeg' || cmd === 'tkzFillPolygon') {
    const g0 = d.d.groups[0]!;
    for (let i = 0; i + 1 < g0.length; i++) pairs.push([g0[i]!, g0[i + 1]!]);
    if (cmd !== 'tkzDrawPolySeg' && g0.length > 2) pairs.push([g0[g0.length - 1]!, g0[0]!]);
  } else {
    for (const grp of d.d.groups) pairs.push([grp[0]!, grp[1]!]);
  }
  let best: Pick | null = null;
  let bestD = Infinity;
  for (const [a, b] of pairs) {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (!pa || !pb) continue;
    const dd = distToSegment(at, pa, pb, cmd === 'tkzDrawLine' || cmd === 'tkzDrawLines');
    if (dd < bestD) {
      bestD = dd;
      best = { kind: 'line', a, b, drawing: id };
    }
  }
  return best;
}

function distToSegment(p: Vec, a: Vec, b: Vec, infinite: boolean): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  if (!infinite) t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export interface StepResult {
  state: ToolState;
  /** all inputs are there: build with these */
  done?: Pick[];
  /** the click didn't fit (e.g. a point where a line is needed) */
  rejected?: boolean;
}

/** Feed one click to a tool. `snap` rounds new points to the 0.5 grid. */
export function feed(s: ToolState, t: Target, g: Graph | null, pos: Evaluated, snap: boolean): StepResult {
  const want = nextInput(s);
  if (!want) return { state: s };
  const newPoint = (at: Vec): Pick => ({ kind: 'new', at: { x: roundCoord(at.x, snap), y: roundCoord(at.y, snap) } });
  const add = (p: Pick): StepResult => {
    const picks = [...s.picks, p];
    const spec = toolSpec(s.tool);
    const complete = spec.inputs !== 'polygon' && picks.length === spec.inputs.length;
    if (complete) return { state: initialState(s.tool), done: picks };
    return { state: { ...s, picks, half: null } };
  };
  if (want === 'point') {
    if (toolSpec(s.tool).inputs === 'polygon') {
      // clicking the first point again closes the polygon
      const first = s.picks[0];
      if (t.kind === 'point' && first?.kind === 'point' && first.name === t.name && s.picks.length >= 3) {
        return { state: initialState(s.tool), done: s.picks };
      }
    }
    if (t.kind === 'point') {
      // the same point twice in a row is ignored
      const last = s.picks[s.picks.length - 1];
      if (last?.kind === 'point' && last.name === t.name) return { state: s, rejected: true };
      return add({ kind: 'point', name: t.name });
    }
    return add(newPoint(t.at));
  }
  // a line (or a circle): click the object itself, or two points
  if (t.kind === 'drawing' && g) {
    const c = curveOfDrawing(g, pos, t.id, t.at);
    if (!c || (want === 'line' && c.kind !== 'line')) return { state: s, rejected: true };
    return add(c);
  }
  const pt: Pick = t.kind === 'point' ? { kind: 'point', name: t.name } : newPoint(t.at);
  if (!s.half) return { state: { ...s, half: pt } };
  if (s.half.kind === 'point' && pt.kind === 'point' && s.half.name === pt.name) return { state: s, rejected: true };
  return add({ kind: 'line2', p: s.half, q: pt });
}

// ------------------------------------------------------------------ building the code

export interface Built {
  steps: Construction[];
  drawings: DrawingSpec[];
  /** names of the points the user will see (dotted + labelled) */
  shown: PointId[];
}

/** Identifiers already in use (graph points + every word of the code, so Asymptote variables are avoided too). */
export function usedNames(g: Graph | null, code: string): Set<string> {
  const s = new Set<string>(code.match(/[A-Za-z_][A-Za-z0-9_']*/g) ?? []);
  if (g) for (const st of g.steps) for (const n of st.c.out) s.add(n);
  return s;
}

/** Name factory: capital letters for visible points, q1, q2 … for helper points. */
export function namer(used: Set<string>) {
  const take = (n: string) => {
    used.add(n);
    return n;
  };
  return {
    point(): string {
      for (const c of 'ABCDEFGHJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return take(c);
      for (let i = 1; ; i++) for (const c of 'ABCDEFGHJKLMNOPQRSTUVWXYZ') if (!used.has(`${c}${i}`)) return take(`${c}${i}`);
    },
    helper(): string {
      for (let i = 1; ; i++) if (!used.has(`q${i}`)) return take(`q${i}`);
    },
  };
}

/** Turn the picks of a finished tool into constructions and drawings. */
export function build(tool: ToolId, picks: Pick[], used: Set<string>): Built {
  const names = namer(used);
  const steps: Construction[] = [];
  const drawings: DrawingSpec[] = [];
  const shown: PointId[] = [];
  const free = (at: Vec): PointId => {
    const n = names.point();
    steps.push({ op: 'free', args: [], out: [n], x: at.x, y: at.y });
    shown.push(n);
    return n;
  };
  const pointOf = (p: Pick): PointId => {
    if (p.kind === 'point') return p.name;
    if (p.kind === 'new') return free(p.at);
    throw new Error('expected a point');
  };
  const lineOf = (p: Pick): [PointId, PointId] => {
    if (p.kind === 'line') return [p.a, p.b];
    if (p.kind === 'line2') return [pointOf(p.p), pointOf(p.q)];
    throw new Error('expected a line');
  };
  const def = (c: Construction, show = true) => {
    steps.push(c);
    if (show) for (const o of c.out) shown.push(o);
    return c.out[0];
  };
  const draw = (d: DrawingSpec) => drawings.push(d);
  switch (tool) {
    case 'move':
      break;
    case 'point':
      pointOf(picks[0]!);
      break;
    case 'segment':
      draw({ cmd: 'tkzDrawSegment', options: null, groups: [[pointOf(picks[0]!), pointOf(picks[1]!)]] });
      break;
    case 'line':
      draw({ cmd: 'tkzDrawLine', options: null, groups: [[pointOf(picks[0]!), pointOf(picks[1]!)]] });
      break;
    case 'polygon':
      draw({ cmd: 'tkzDrawPolygon', options: null, groups: [picks.map(pointOf)] });
      break;
    case 'perpendicular':
    case 'parallel': {
      const p = pointOf(picks[0]!);
      const [a, b] = lineOf(picks[1]!);
      const q = def({ op: tool === 'perpendicular' ? 'orthLine' : 'parLine', args: [p, a, b], out: [names.helper()] }, false);
      // a second helper on the other side, so the drawn line is centred on P
      const q2 = def({ op: 'symmetry', args: [q, p], out: [names.helper()] }, false);
      draw({ cmd: 'tkzDrawLine', options: null, groups: [[q2, q]] });
      break;
    }
    case 'perpBisector': {
      const a = pointOf(picks[0]!);
      const b = pointOf(picks[1]!);
      const m = def({ op: 'midpoint', args: [a, b], out: [names.helper()] }, false);
      const q = def({ op: 'orthLine', args: [m, a, b], out: [names.helper()] }, false);
      const q2 = def({ op: 'symmetry', args: [q, m], out: [names.helper()] }, false);
      draw({ cmd: 'tkzDrawLine', options: null, groups: [[q2, q]] });
      break;
    }
    case 'midpoint':
      def({ op: 'midpoint', args: [pointOf(picks[0]!), pointOf(picks[1]!)], out: [names.point()] });
      break;
    case 'foot':
    case 'reflectLine': {
      const p = pointOf(picks[0]!);
      const [a, b] = lineOf(picks[1]!);
      def({ op: tool === 'foot' ? 'projection' : 'reflection', args: [p, a, b], out: [names.point()] });
      break;
    }
    case 'reflectPoint': {
      const p = pointOf(picks[0]!);
      const c = pointOf(picks[1]!);
      def({ op: 'symmetry', args: [p, c], out: [names.point()] });
      break;
    }
    case 'circumcenter':
    case 'incenter':
    case 'centroid':
    case 'orthocenter': {
      const v = picks.map(pointOf) as [PointId, PointId, PointId];
      const kind = ({ circumcenter: 'circum', incenter: 'in', centroid: 'centroid', orthocenter: 'ortho' } as const)[tool];
      def({ op: 'center', kind, args: v, out: [names.point()] });
      break;
    }
    case 'circle': {
      const c = pointOf(picks[0]!);
      const th = pointOf(picks[1]!);
      draw({ cmd: 'tkzDrawCircle', options: null, groups: [[c, th]] });
      break;
    }
    case 'circle3': {
      const v = picks.map(pointOf) as [PointId, PointId, PointId];
      const o = def({ op: 'center', kind: 'circum', args: v, out: [names.helper()] }, false);
      draw({ cmd: 'tkzDrawCircle', options: null, groups: [[o, v[0]]] });
      break;
    }
    case 'incircle': {
      const v = picks.map(pointOf) as [PointId, PointId, PointId];
      const i = def({ op: 'center', kind: 'in', args: v, out: [names.helper()] }, false);
      const t = def({ op: 'projection', args: [i, v[1], v[2]], out: [names.helper()] }, false);
      draw({ cmd: 'tkzDrawCircle', options: null, groups: [[i, t]] });
      break;
    }
    case 'intersect': {
      const [p0, p1] = picks as [Pick, Pick];
      const curve = (p: Pick): { line?: [PointId, PointId]; circle?: [PointId, PointId] } =>
        p.kind === 'circle' ? { circle: [p.c, p.th] } : { line: lineOf(p) };
      const c0 = curve(p0);
      const c1 = curve(p1);
      if (c0.line && c1.line) def({ op: 'interLL', args: [...c0.line, ...c1.line], out: [names.point()] });
      else if (c0.circle && c1.circle) def({ op: 'interCC', args: [...c0.circle, ...c1.circle], out: [names.point(), names.point()] });
      else {
        const l = (c0.line ?? c1.line)!;
        const c = (c0.circle ?? c1.circle)!;
        def({ op: 'interLC', args: [...l, ...c], out: [names.point(), names.point()] });
      }
      break;
    }
    case 'rightAngle':
    case 'angleMark':
      draw({ cmd: tool === 'rightAngle' ? 'tkzMarkRightAngle' : 'tkzMarkAngle', options: null, groups: [picks.map(pointOf)] });
      break;
  }
  if (shown.length) {
    draw({ cmd: 'tkzDrawPoints', options: null, groups: [shown] });
    draw({ cmd: 'tkzLabelPoints', options: 'above right', groups: [shown] });
  }
  return { steps, drawings, shown };
}

export interface Insertion {
  /** the new code */
  text: string;
  /** points the tool created that come out undefined right now (e.g. no intersection) */
  undefinedPoints: PointId[];
}

/** Where new code goes: before \end{tikzpicture} / \end{asy}, else at the end. */
function insertAt(code: string, lang: Lang): number {
  const end = lang === 'asy' ? code.lastIndexOf('\\end{asy}') : code.lastIndexOf('\\end{tikzpicture}');
  if (end < 0) return code.length;
  return code.lastIndexOf('\n', end - 1) + 1 || end;
}

/** Write the result of a tool into the code. `g` is the current graph (to place new points correctly). */
export function insert(code: string, lang: Lang, g: Graph | null, built: Built): Insertion {
  // evaluate the old figure plus the new steps (for Asymptote's intersection indices and the check)
  const temp: Graph = {
    steps: [...(g?.steps ?? []), ...built.steps.map((c) => ({ id: c.out.join('+'), c, span: null }))],
    producer: new Map(),
    drawings: [],
  };
  const pos = evaluate(temp);
  const undefinedPoints = built.steps.flatMap((c) => c.out).filter((n) => !isAux(n) && !pos.get(n));
  const lines: string[] = [];
  if (lang === 'asy') {
    for (const c of built.steps) lines.push(...constructionAsy(c, (p) => p, { pos }));
    for (const d of built.drawings) {
      if (d.cmd === 'tkzDrawPoints') continue;
      if (d.cmd === 'tkzLabelPoints') {
        for (const n of d.groups[0]!) lines.push(`dot("$${n}$", ${n}, NE);`);
        continue;
      }
      // a line drawn with a tool is a whole line in Asymptote (geometry's line(A,B))
      lines.push(...drawingAsy(d.cmd === 'tkzDrawLine' ? { ...d, infinite: true } : d, (p) => p, {}));
    }
  } else {
    for (const c of built.steps) lines.push(constructionCode(c, (p) => p, { pos }));
    for (const d of built.drawings) lines.push(drawingCode(d));
  }
  const at = insertAt(code, lang);
  // indent like the line before
  const before = code.slice(0, at);
  const prevLine = before.trimEnd().split('\n').pop() ?? '';
  const indent = /^[ \t]*/.exec(prevLine)![0];
  const lead = before.length && !before.endsWith('\n') ? '\n' : '';
  const block = lead + lines.map((l) => indent + l).join('\n') + '\n';
  const text = before + block + code.slice(at);
  return { text: lang === 'asy' ? ensureAsyImports(text) : text, undefinedPoints };
}

/**
 * The generated Asymptote uses olympiad.asy (foot, extension, incenter …) and geometry.asy
 * (line, circle objects): add the imports that are missing, at the top of the code.
 */
export function ensureAsyImports(text: string): string {
  const missing = ['olympiad', 'geometry'].filter((m) => !new RegExp(`\\bimport\\s+${m}\\b`).test(text));
  if (!missing.length) return text;
  const begin = /\\begin\s*\{asy\}[^\n]*\n/.exec(text);
  const at = begin ? begin.index + begin[0].length : 0;
  const firstLine = text.slice(at).split('\n').find((l) => l.trim()) ?? '';
  const indent = /^[ \t]*/.exec(firstLine)![0];
  return text.slice(0, at) + missing.map((m) => `${indent}import ${m};\n`).join('') + text.slice(at);
}

/** Is a drawing something a 'line' / 'curve' input can take? (for highlighting under the cursor) */
export function pickableDrawing(g: Graph, pos: Evaluated, id: string, want: InputKind | null): boolean {
  if (!want || want === 'point') return false;
  const d = g.drawings.find((x) => x.id === id);
  if (!d || shapesOf(d, pos).length === 0) return false;
  const circle = d.d.cmd === 'tkzDrawCircle' || d.d.cmd === 'tkzDrawCircles' || d.d.cmd === 'tkzFillCircle';
  if (circle) return want === 'curve';
  return ['tkzDrawSegment', 'tkzDrawSegments', 'tkzDrawLine', 'tkzDrawLines', 'tkzDrawPolygon', 'tkzDrawPolySeg', 'tkzFillPolygon'].includes(d.d.cmd);
}

/** English names and hints (the nagori page translates them through its own locale files). */
export const TOOL_TEXT: Record<ToolId, string> = {
  move: 'Move',
  point: 'Point',
  segment: 'Segment',
  line: 'Line',
  polygon: 'Polygon',
  perpendicular: 'Perpendicular line',
  parallel: 'Parallel line',
  perpBisector: 'Perpendicular bisector',
  midpoint: 'Midpoint',
  intersect: 'Intersection',
  foot: 'Foot of perpendicular',
  reflectLine: 'Reflect about line',
  reflectPoint: 'Reflect about point',
  circumcenter: 'Circumcentre',
  incenter: 'Incentre',
  centroid: 'Centroid',
  orthocenter: 'Orthocentre',
  circle: 'Circle (centre, point)',
  circle3: 'Circle through 3 points',
  incircle: 'Incircle',
  rightAngle: 'Right-angle mark',
  angleMark: 'Angle mark',
};

export const INPUT_HINT: Record<InputKind, string> = {
  point: 'click a point, or an empty spot for a new one',
  line: 'click a line or segment (or two points)',
  curve: 'click a line, segment or circle (or two points for a line)',
};

/** Hint for the current state of a tool, e.g. "Midpoint: click a point … (1/2)". */
export function hintOf(s: ToolState, text: Record<ToolId, string> = TOOL_TEXT, inputs: Record<InputKind, string> = INPUT_HINT, polygonClose = 'click the first point again to close'): string {
  if (s.tool === 'move') return '';
  const want = nextInput(s);
  const spec = toolSpec(s.tool);
  if (spec.inputs === 'polygon') return `${text[s.tool]}: ${inputs.point}${s.picks.length >= 3 ? `; ${polygonClose}` : ''}`;
  const total = spec.inputs.length;
  return `${text[s.tool]}: ${want ? inputs[want] : ''}${s.half ? ' (2nd point)' : ''} (${s.picks.length + 1}/${total})`;
}

/** Points / drawings to highlight for the current state. */
export function selectionOf(s: ToolState): { points: PointId[]; drawings: string[] } {
  const points: PointId[] = [];
  const drawings: string[] = [];
  const visit = (p: Pick | null) => {
    if (!p) return;
    if (p.kind === 'point') points.push(p.name);
    else if ((p.kind === 'line' || p.kind === 'circle') && p.drawing) drawings.push(p.drawing);
    else if (p.kind === 'line2') {
      visit(p.p);
      visit(p.q);
    }
  };
  s.picks.forEach(visit);
  visit(s.half);
  return { points, drawings };
}

export interface PickOutcome {
  state: ToolState;
  /** new editor text, when something was written */
  text?: string;
  /** the click didn't fit what the tool waits for */
  rejected?: boolean;
  /** points the tool made that are undefined right now (e.g. the objects don't intersect) */
  undefinedPoints?: PointId[];
  /** the tool finished (its result was written) */
  finished?: boolean;
}

/**
 * Handle one canvas click for the active tool, given the current editor text.
 * A click on an empty spot (or, for a point input, on an object) creates a free point first, so
 * it shows up at once; then the tool goes on with that point.
 */
export function handlePick(state: ToolState, target: Target, code: string, lang: Lang, snap: boolean): PickOutcome {
  const want = nextInput(state);
  if (!want) return { state };
  let text = code;
  let g = compile(text, lang).graph;
  if (!g) return { state, rejected: true };
  let pos = evaluate(g);
  let t = target;
  const needsPoint = want === 'point' || t.kind === 'empty';
  if (needsPoint && t.kind !== 'point') {
    const at = { x: roundCoord(t.at.x, snap), y: roundCoord(t.at.y, snap) };
    const b = build('point', [{ kind: 'new', at }], usedNames(g, text));
    text = insert(text, lang, g, b).text;
    t = { kind: 'point', name: b.shown[0]! };
    g = compile(text, lang).graph;
    if (!g) return { state, rejected: true };
    pos = evaluate(g);
  }
  const r = feed(state, t, g, pos, snap);
  const changed = text !== code ? { text } : {};
  if (r.rejected) return { state, rejected: true, ...changed };
  if (!r.done) return { state: r.state, ...changed };
  const built = build(state.tool, r.done, usedNames(g, text));
  if (!built.steps.length && !built.drawings.length) return { state: r.state, finished: true, ...changed };
  const ins = insert(text, lang, g, built);
  return { state: r.state, text: ins.text, undefinedPoints: ins.undefinedPoints, finished: true };
}
