// Graph + evaluated coordinates → what the canvas draws (math coordinates, styles resolved).
// Pure: no DOM. Shapes that reference an undefined point are dropped (hidden).

import { normalizeAngles } from '../geom/constructions';
import type { Evaluated } from '../geom/evaluate';
import { add, dist, lerp, scale, sub, len, type Vec } from '../geom/vec';
import type { Drawing, Graph, PointId } from '../graph/types';
import { isAux } from '../parser/ast';
import { asyStyle, tikzStyle, type Style } from '../style';
import type { BBox } from './viewport';

export type Shape =
  | { type: 'segment'; a: Vec; b: Vec }
  | { type: 'polygon'; pts: Vec[] }
  | { type: 'polyline'; pts: Vec[] }
  | { type: 'circle'; c: Vec; r: number }
  /** infinite line through a and b (Asymptote line(A,B)) */
  | { type: 'line'; a: Vec; b: Vec }
  /** right-angle square at vertex b, sides along unit vectors u and v, side length s */
  | { type: 'rightAngle'; b: Vec; u: Vec; v: Vec; s: number }
  /** arc of radius r at vertex b from angle t1 counter-clockwise to t2 (radians); n concentric arcs */
  | { type: 'angle'; b: Vec; r: number; t1: number; t2: number; n?: number }
  /** n small ticks across segment ab, at its middle */
  | { type: 'tick'; a: Vec; b: Vec; n?: number }
  /** circular arc centred c from angle t1 counter-clockwise to t2 (radians); a sector is closed through c */
  | { type: 'arc'; c: Vec; r: number; t1: number; t2: number; sector?: boolean };

export interface StyledShape {
  shape: Shape;
  style: Style;
  /** true for \tkzFill… / Asymptote fill(): only the inside is painted */
  fillOnly?: boolean;
}

/** Label direction: angle in degrees (0 = right, 90 = above) and a distance factor; null = centred. */
export type LabelDir = { angle: number; k: number } | null;

export interface LabelSpec {
  /** id of the drawing that produced the label */
  drawing: string;
  at: Vec;
  text: string;
  dir: LabelDir;
  color?: string;
}

/** tkz-euclide's `line style` uses `add = .2 and .2`: extend by 20 % of |AB| on both sides. */
export const LINE_ADD = 0.2;

/** Default sizes, in figure units (cm for TikZ; user units for Asymptote with markscalefactor 0.03). */
const MARK = {
  tkz: { right: 0.25, angle: 1, tick: 0.14 },
  tikz: { right: 0.25, angle: 0.5, tick: 0.14 },
  asy: { right: 0.24, angle: 0.24, tick: 0.1 },
};

export function styleOf(d: Drawing['d'], colors: Record<string, string> = {}): Style {
  return d.src === 'asy' ? asyStyle(d.options, colors) : tikzStyle(d.options, colors);
}

const unit = (v: Vec): Vec | null => {
  const l = len(v);
  return l > 0 ? scale(v, 1 / l) : null;
};

function sizeOption(options: string | null, key: string): number | null {
  const m = options ? new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*([\\d.]+)\\s*(cm|pt|mm)?`).exec(options) : null;
  if (!m) return null;
  const k = { cm: 1, pt: 1 / 28.45, mm: 0.1 }[m[2] ?? 'cm']!;
  return Number(m[1]) * k;
}

export function shapesOf(d: Drawing, pos: Evaluated, colors: Record<string, string> = {}): StyledShape[] {
  const get = (n: PointId) => pos.get(n) ?? null;
  const all = (names: PointId[]) => {
    const pts = names.map(get);
    return pts.every((p): p is Vec => p !== null) ? pts : null;
  };
  const base = styleOf(d.d, colors);
  // \tkzFillPolygon[color=red] fills with its colour
  const isFill = d.d.cmd === 'tkzFillPolygon' || d.d.cmd === 'tkzFillCircle' || d.d.cmd === 'tkzFillSector';
  const style = isFill && !base.fill && d.d.src !== 'asy' ? { ...base, fill: base.color ?? 'rgb(0,0,0)' } : base;
  const out: StyledShape[] = [];
  const push = (shape: Shape, fillOnly = false) => out.push({ shape, style, ...(fillOnly ? { fillOnly } : {}) });
  const marks = MARK[d.d.src ?? 'tkz'];
  switch (d.d.cmd) {
    case 'tkzDrawSegment':
    case 'tkzDrawSegments':
      for (const g of d.d.groups) {
        const p = all(g);
        if (p) push({ type: 'segment', a: p[0]!, b: p[1]! });
      }
      break;
    case 'tkzDrawLine':
    case 'tkzDrawLines':
      for (const g of d.d.groups) {
        const p = all(g);
        if (!p || dist(p[0]!, p[1]!) === 0) continue;
        if (d.d.infinite) push({ type: 'line', a: p[0]!, b: p[1]! });
        else push({ type: 'segment', a: lerp(p[0]!, p[1]!, -LINE_ADD), b: lerp(p[1]!, p[0]!, -LINE_ADD) });
      }
      break;
    case 'tkzDrawPolygon':
    case 'tkzFillPolygon': {
      const p = all(d.d.groups[0]!);
      if (p) push({ type: 'polygon', pts: p }, d.d.cmd === 'tkzFillPolygon');
      break;
    }
    case 'tkzDrawPolySeg': {
      const p = all(d.d.groups[0]!);
      if (p) push({ type: 'polyline', pts: p });
      break;
    }
    case 'tkzDrawCircle':
    case 'tkzDrawCircles':
    case 'tkzFillCircle':
      for (const g of d.d.groups) {
        const p = all(g);
        if (p) push({ type: 'circle', c: p[0]!, r: dist(p[0]!, p[1]!) }, d.d.cmd === 'tkzFillCircle');
      }
      break;
    case 'tkzDrawArc':
    case 'tkzDrawSector':
    case 'tkzFillSector':
    case 'tkzDrawSemiCircle': {
      const p = all(d.d.groups[0]!);
      if (!p) break;
      const [o, a] = [p[0]!, p[1]!];
      const r = dist(o, a);
      if (r === 0) break;
      const deg = (v: Vec) => (Math.atan2(v.y - o.y, v.x - o.x) * 180) / Math.PI;
      let t1: number;
      let t2: number;
      if (d.d.cmd === 'tkzDrawSemiCircle') {
        [t1, t2] = normalizeAngles(deg(a), deg({ x: 2 * o.x - a.x, y: 2 * o.y - a.y }));
      } else {
        if (dist(o, p[2]!) === 0) break;
        [t1, t2] = normalizeAngles(deg(a), deg(p[2]!));
      }
      const sector = d.d.cmd === 'tkzDrawSector' || d.d.cmd === 'tkzFillSector';
      push({ type: 'arc', c: o, r, t1: (t1 * Math.PI) / 180, t2: (t2 * Math.PI) / 180, ...(sector ? { sector } : {}) }, d.d.cmd === 'tkzFillSector');
      break;
    }
    case 'tkzMarkRightAngle': {
      const p = all(d.d.groups[0]!);
      const u = p && unit(sub(p[0]!, p[1]!));
      const v = p && unit(sub(p[2]!, p[1]!));
      if (p && u && v) push({ type: 'rightAngle', b: p[1]!, u, v, s: sizeOption(d.d.options, 'size') ?? marks.right });
      break;
    }
    case 'tkzMarkAngle': {
      const p = all(d.d.groups[0]!);
      if (!p || dist(p[0]!, p[1]!) === 0 || dist(p[2]!, p[1]!) === 0) break;
      const t1 = Math.atan2(p[0]!.y - p[1]!.y, p[0]!.x - p[1]!.x);
      let t2 = Math.atan2(p[2]!.y - p[1]!.y, p[2]!.x - p[1]!.x);
      if (t2 < t1) t2 += 2 * Math.PI;
      const r = sizeOption(d.d.options, 'size') ?? sizeOption(d.d.options, 'angle radius') ?? marks.angle;
      const n = arcCount(d.d.options);
      push({ type: 'angle', b: p[1]!, r, t1, t2, ...(n > 1 ? { n } : {}) });
      break;
    }
    case 'tkzMarkSegment':
    case 'tkzMarkSegments':
      for (const g of d.d.groups) {
        const p = all(g);
        const n = tickCount(d.d.options);
        if (p && dist(p[0]!, p[1]!) > 0 && n > 0) push({ type: 'tick', a: p[0]!, b: p[1]!, ...(n > 1 ? { n } : {}) });
      }
      break;
    default:
      break;
  }
  return out;
}

/** dist= (or the older pos=) of \tkzLabelAngle, in cm; default 1. */
export function labelAngleDist(options: string | null): number {
  const m = options ? /(?:^|,)\s*(?:dist|pos)\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+))/.exec(options) : null;
  return m ? Number(m[1]) : 1;
}
/** Number of bars of a tkz-euclide segment mark (mark=| by default; ||, |||, s||…); 0 = none. */
export function tickCount(options: string | null): number {
  const m = options ? /(?:^|,)\s*mark\s*=\s*([^,]*)/.exec(options) : null;
  if (!m) return 1;
  const v = m[1]!.trim();
  if (v === 'none') return 0;
  const bars = (v.match(/\|/g) ?? []).length;
  return bars || 1;
}

/** Number of arcs of \tkzMarkAngle (arc=l / ll / lll). */
export function arcCount(options: string | null): number {
  const m = options ? /(?:^|,)\s*arc\s*=\s*(l{1,3})\s*(?:,|$)/.exec(options) : null;
  return m ? m[1]!.length : 1;
}

/** Label position from TikZ / tkz-euclide options ("above right", "anchor=north", "left=2pt"). */
export function labelDirOf(options: string | null, fallback: LabelDir): LabelDir {
  if (!options) return fallback;
  const ANCHOR: Record<string, number> = {
    north: 270, south: 90, east: 180, west: 0, 'north east': 225, 'north west': 315, 'south east': 135, 'south west': 45,
  };
  for (const raw of options.split(',')) {
    const [k0, v0] = raw.split('=');
    const key = k0!.trim().replace(/\s+/g, ' ');
    if (key === 'anchor' && v0 && ANCHOR[v0.trim()] !== undefined) return { angle: ANCHOR[v0.trim()]!, k: 1 };
    const m = /^(above|below)?\s*(left|right)?$/.exec(key);
    if (m && (m[1] || m[2])) {
      const v = m[1] === 'above' ? 1 : m[1] === 'below' ? -1 : 0;
      const h = m[2] === 'right' ? 1 : m[2] === 'left' ? -1 : 0;
      return { angle: (Math.atan2(v, h) * 180) / Math.PI, k: 1 };
    }
  }
  return fallback;
}

/** Backwards-compatible helper: position keywords of a label option string. */
export type LabelPos = { v: 'above' | 'below' | 'center'; h: 'left' | 'right' | 'center' };
export function labelPos(options: string | null): LabelPos {
  const def: LabelPos = { v: 'below', h: 'center' };
  if (!options) return def;
  for (const raw of options.split(',')) {
    const key = raw.split('=')[0]!.trim();
    const m = /^(above|below)?\s*(left|right)?$/.exec(key);
    if (m && (m[1] || m[2])) {
      return { v: (m[1] as 'above' | 'below' | undefined) ?? 'center', h: (m[2] as 'left' | 'right' | undefined) ?? 'center' };
    }
  }
  return def;
}

const BELOW: LabelDir = { angle: -90, k: 1 };

export function labelsOf(d: Drawing, pos: Evaluated, colors: Record<string, string> = {}): LabelSpec[] {
  const color = d.d.src === 'asy' ? undefined : tikzStyle(d.d.options, colors).color;
  if (d.d.cmd === 'tkzLabelPoints') {
    const dir = labelDirOf(d.d.options, BELOW);
    return d.d.groups[0]!.flatMap((name) => {
      const at = pos.get(name);
      return at ? [{ drawing: d.id, at, text: `$${name}$`, dir, ...(color ? { color } : {}) }] : [];
    });
  }
  if (d.d.cmd === 'tkzLabelAngle') {
    const [a, b, c] = d.d.groups[0]!.map((n) => pos.get(n) ?? null);
    if (!a || !b || !c || dist(a, b) === 0 || dist(c, b) === 0) return [];
    const deg = (v: Vec) => (Math.atan2(v.y - b.y, v.x - b.x) * 180) / Math.PI;
    const [t1, t2] = normalizeAngles(deg(a), deg(c));
    const t = (((t1 + t2) / 2) * Math.PI) / 180;
    const k = labelAngleDist(d.d.options);
    return [{ drawing: d.id, at: { x: b.x + k * Math.cos(t), y: b.y + k * Math.sin(t) }, text: d.d.text ?? '', dir: null, ...(color ? { color } : {}) }];
  }
  if (d.d.cmd !== 'tkzLabelPoint') return [];
  const name = d.d.groups[0]![0]!;
  const at = pos.get(name);
  if (!at) return [];
  let dir: LabelDir;
  if (d.d.src === 'asy') {
    const ad = d.d.dir;
    if (!ad) dir = null;
    else if ('angle' in ad) dir = { angle: ad.angle, k: ad.k };
    else {
      const p = pos.get(ad.of);
      dir = p && (p.x !== 0 || p.y !== 0) ? { angle: (Math.atan2(p.y, p.x) * 180) / Math.PI, k: ad.k } : null;
    }
  } else {
    // \tkzLabelPoint defaults to tkz-euclide's label style; a plain TikZ node sits on its point
    dir = labelDirOf(d.d.options, d.d.src === 'tikz' ? null : BELOW);
  }
  return [{ drawing: d.id, at, text: d.d.text ?? '', dir, ...(color ? { color } : {}) }];
}

/** Points listed in \tkzDrawPoints / \tkzDrawPoint (Asymptote dot, TikZ filled dots). */
export function drawnPoints(g: Graph): Set<PointId> {
  const s = new Set<PointId>();
  for (const d of g.drawings) {
    if (d.d.cmd === 'tkzDrawPoints' || d.d.cmd === 'tkzDrawPoint') for (const n of d.d.groups[0]!) s.add(n);
  }
  return s;
}

/** Points used only to place labels (TikZ nodes / Asymptote labels at a computed spot). */
export function labelOnlyPoints(g: Graph): Set<PointId> {
  const used = new Set<PointId>();
  const labelled = new Set<PointId>();
  for (const s of g.steps) for (const a of s.c.args) used.add(a);
  for (const d of g.drawings) {
    const isLabel = d.d.cmd === 'tkzLabelPoint' || d.d.cmd === 'tkzLabelPoints';
    for (const grp of d.d.groups) for (const n of grp) (isLabel ? labelled : used).add(n);
  }
  return new Set([...labelled].filter((n) => !used.has(n)));
}

/** A handle the canvas shows for a point. */
export interface PointHandle {
  name: PointId;
  stepId: string;
  at: Vec;
  free: boolean;
  /** has literal numbers in the source that a drag can rewrite */
  draggable: boolean;
  /** a derived point that can be dragged along its line or circle (a number of it is literal) */
  glider: boolean;
  /** not drawn by the figure itself (shown faded) */
  ghost: boolean;
}

export function pointHandles(g: Graph, pos: Evaluated): PointHandle[] {
  const drawn = drawnPoints(g);
  const labelOnly = labelOnlyPoints(g);
  const out: PointHandle[] = [];
  for (const step of g.steps) {
    const free = step.c.op === 'free';
    for (const name of step.c.out) {
      const at = pos.get(name);
      if (!at) continue;
      // internal helper points are hidden unless they are free (numbers in the code) and not just a label spot
      if (isAux(name) && (!free || labelOnly.has(name))) continue;
      const glider = !free && step.lit?.kind === 'param' && step.c.out.length === 1;
      out.push({ name, stepId: step.id, at, free, draggable: (free && !!step.lit) || glider, glider, ghost: !drawn.has(name) });
    }
  }
  return out;
}

/** Bounding box of every visible point, drawn shape and label anchor. */
export function boundingBox(g: Graph, pos: Evaluated): BBox | null {
  let box: BBox | null = null;
  const addPt = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  };
  for (const h of pointHandles(g, pos)) addPt(h.at.x, h.at.y);
  for (const d of g.drawings) {
    for (const l of labelsOf(d, pos)) addPt(l.at.x, l.at.y);
    for (const { shape: s } of shapesOf(d, pos)) {
      if (s.type === 'circle') {
        addPt(s.c.x - s.r, s.c.y - s.r);
        addPt(s.c.x + s.r, s.c.y + s.r);
      } else if (s.type === 'segment' || s.type === 'line' || s.type === 'tick') {
        addPt(s.a.x, s.a.y);
        addPt(s.b.x, s.b.y);
      } else if (s.type === 'arc') {
        // the end points, the centre (sectors) and the extreme points the arc passes
        const at = (t: number) => addPt(s.c.x + s.r * Math.cos(t), s.c.y + s.r * Math.sin(t));
        at(s.t1);
        at(s.t2);
        if (s.sector) addPt(s.c.x, s.c.y);
        for (let k = Math.ceil(s.t1 / (Math.PI / 2)); k * (Math.PI / 2) <= s.t2; k++) at(k * (Math.PI / 2));
      } else if (s.type === 'polygon' || s.type === 'polyline') {
        for (const p of s.pts) addPt(p.x, p.y);
      } else {
        addPt(s.b.x, s.b.y);
      }
    }
  }
  return box;
}

/** Points of a right-angle mark (for rendering). */
export function rightAnglePath(s: Extract<Shape, { type: 'rightAngle' }>): Vec[] {
  const p = add(s.b, scale(s.u, s.s));
  const r = add(s.b, scale(s.v, s.s));
  return [p, add(p, scale(s.v, s.s)), r];
}

// ------------------------------------------------------------------ label text

export interface TextRun {
  text: string;
  shift?: 'sub' | 'super';
}

const TEX_SYMBOLS: Record<string, string> = {
  dg: '°', circ: '°', angle: '∠', triangle: '△', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ',
  omega: 'ω', Omega: 'Ω', pi: 'π', ell: 'ℓ', prime: '′', cdot: '·', perp: '⊥', parallel: '∥', infty: '∞', phi: 'φ',
  varphi: 'φ', lambda: 'λ', mu: 'μ', sigma: 'σ', tau: 'τ', epsilon: 'ε', varepsilon: 'ε', rho: 'ρ', Gamma: 'Γ',
  Delta: 'Δ', siku: '', s: '', small: '', scriptsize: '', footnotesize: '', large: '',
};

/** Very small TeX → text conversion for point labels: $A_1$, $O'$, $15\dg$, \textcolor{c}{X}… */
export function texRuns(src: string): TextRun[] {
  let s = src.replace(/\$/g, '').trim();
  s = s.replace(/\\(?:textcolor|color)\{[^}]*\}/g, '').replace(/\\(?:mathrm|text|textbf|mathbf|mathit|textit|operatorname)\{([^}]*)\}/g, '$1');
  s = s.replace(/\\([A-Za-z]+)/g, (_, w: string) => TEX_SYMBOLS[w] ?? w).replace(/\\,|\\;|\\!|~/g, ' ').replace(/[{}]/g, (c) => c);
  const runs: TextRun[] = [];
  let i = 0;
  let cur = '';
  const flush = () => {
    if (cur) runs.push({ text: cur });
    cur = '';
  };
  while (i < s.length) {
    const c = s[i]!;
    if ((c === '_' || c === '^') && i + 1 < s.length) {
      flush();
      let arg: string;
      if (s[i + 1] === '{') {
        const end = s.indexOf('}', i + 2);
        arg = s.slice(i + 2, end < 0 ? undefined : end);
        i = end < 0 ? s.length : end + 1;
      } else {
        arg = s[i + 1]!;
        i += 2;
      }
      if (c === '^' && (arg === '°' || arg === '′')) cur += arg;
      else runs.push({ text: arg.replace(/[{}]/g, ''), shift: c === '_' ? 'sub' : 'super' });
      continue;
    }
    if (c === '{' || c === '}') {
      i++;
      continue;
    }
    cur += c === "'" ? '′' : c;
    i++;
  }
  flush();
  return runs;
}
