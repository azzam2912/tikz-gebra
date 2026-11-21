// Construction graph → canonical tkz-euclide code.
// Layout: definitions (topological order), blank line, drawings, blank line, labels.
// Only free points carry numbers; everything else is emitted symbolically.
// Graphs that came from Asymptote or plain TikZ are converted on the way (see `GenerateOptions`).

import type { Evaluated } from '../geom/evaluate';
import { interCC, interLC } from '../geom/constructions';
import { dist, type Vec } from '../geom/vec';
import type { Construction, DrawingSpec, Graph, PointId } from '../graph/types';
import { isAux } from '../parser/ast';
import { POINT_NAME_RE } from '../parser/parser';
import { asyStyle, styleToTikz, tikzColorDefs } from '../style';

/** Round to 2 decimals and print without trailing zeros (never "-0"). */
export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
}

/** Ratios and angles: up to 6 decimals. */
export function fmtK(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(6);
  return s.replace(/\.?0+$/, '') || '0';
}

const deg = (x: number, y: number) => (Math.atan2(y, x) * 180) / Math.PI;

export interface GenerateOptions {
  /** Current coordinates: needed to convert constructions that tkz-euclide can't express symbolically. */
  pos?: Evaluated;
  /** Notes about lossy conversions are pushed here. */
  notes?: string[];
  /** Keep free coordinates to 6 decimals instead of 2 (conversions keep the numbers as typed). */
  precise?: boolean;
}

/** Valid tkz-euclide names for every point (internal "~" names and Asymptote names get replaced). */
export function nameMap(g: Graph): Map<PointId, string> {
  const used = new Set<string>();
  const map = new Map<PointId, string>();
  const all = g.steps.flatMap((s) => s.c.out);
  for (const n of all) if (!isAux(n) && POINT_NAME_RE.test(n)) used.add(n);
  let k = 0;
  for (const n of all) {
    if (!isAux(n) && POINT_NAME_RE.test(n)) {
      map.set(n, n);
      continue;
    }
    const base = n.replace(/^~/, '').replace(/[^A-Za-z0-9_']/g, '').replace(/\d+$/, '') || 'P';
    let cand: string;
    do cand = `${base}${++k}`;
    while (used.has(cand));
    used.add(cand);
    map.set(n, cand);
  }
  return map;
}

export function constructionCode(c: Construction, name: (p: PointId) => string = (p) => p, opts: GenerateOptions = {}): string {
  const a = c.args.map(name);
  const o = c.out.map(name);
  const get = (n: number) => `\\tkzGetPoint{${o[n]}}`;
  switch (c.op) {
    case 'free': {
      const f = opts.precise ? fmtK : fmt;
      if (c.polar) return `\\tkzDefPoint(${f(deg(c.x, c.y))}:${f(Math.hypot(c.x, c.y))}){${o[0]}}`;
      return `\\tkzDefPoint(${f(c.x)},${f(c.y)}){${o[0]}}`;
    }
    case 'midpoint':
      return `\\tkzDefMidPoint(${a[0]},${a[1]}) ${get(0)}`;
    case 'projection':
      return `\\tkzDefPointBy[projection=onto ${a[1]}--${a[2]}](${a[0]}) ${get(0)}`;
    case 'reflection':
      return `\\tkzDefPointBy[reflection=over ${a[1]}--${a[2]}](${a[0]}) ${get(0)}`;
    case 'symmetry':
      return `\\tkzDefPointBy[symmetry=center ${a[1]}](${a[0]}) ${get(0)}`;
    case 'homothety':
      return `\\tkzDefPointBy[homothety=center ${a[1]} ratio ${fmtK(c.k)}](${a[0]}) ${get(0)}`;
    case 'rotation':
      return `\\tkzDefPointBy[rotation=center ${a[1]} angle ${fmtK(c.angle)}](${a[0]}) ${get(0)}`;
    case 'translation':
      return `\\tkzDefPointBy[translation=from ${a[1]} to ${a[2]}](${a[0]}) ${get(0)}`;
    case 'shift':
      if (c.polar) return `\\tkzDefShiftPoint[${a[0]}](${fmtK(deg(c.dx, c.dy))}:${fmtK(Math.hypot(c.dx, c.dy))}){${o[0]}}`;
      return `\\tkzDefShiftPoint[${a[0]}](${fmtK(c.dx)},${fmtK(c.dy)}){${o[0]}}`;
    case 'orthLine':
      return `\\tkzDefLine[orthogonal=through ${a[0]}](${a[1]},${a[2]}) ${get(0)}`;
    case 'parLine':
      return `\\tkzDefLine[parallel=through ${a[0]}](${a[1]},${a[2]}) ${get(0)}`;
    case 'tangentAt':
      return `\\tkzDefLine[tangent at=${a[0]}](${a[1]}) ${get(0)}`;
    case 'midArc':
      return `\\tkzDefMidArc(${a[0]},${a[1]},${a[2]}) ${get(0)}`;
    case 'interLL':
      return `\\tkzInterLL(${a[0]},${a[1]})(${a[2]},${a[3]}) ${get(0)}`;
    case 'interLC':
    case 'interCC': {
      const cmd = c.op === 'interLC' ? 'tkzInterLC' : 'tkzInterCC';
      let [p, q] = [c.out[0], c.out[1]];
      const tkzOpt = c.order === 'common' ? `[common=${a[4]}]` : c.order === 'near' ? '[near]' : '';
      if (c.order && c.order !== 'tkz' && !tkzOpt) {
        // tkz-euclide has its own order: name the points the way they are placed right now
        const swap = swapped(c, opts.pos);
        if (swap === null) opts.notes?.push(`${o[0]}/${o[1]}: intersection order taken as is`);
        if (swap) [p, q] = [q, p];
      }
      const head = `\\${cmd}${tkzOpt}(${a[0]},${a[1]})(${a[2]},${a[3]})`;
      if (isAux(q) && !isAux(p)) return `${head} \\tkzGetFirstPoint{${name(p)}}`;
      if (isAux(p) && !isAux(q)) return `${head} \\tkzGetSecondPoint{${name(q)}}`;
      return `${head} \\tkzGetPoints{${name(p)}}{${name(q)}}`;
    }
    case 'center':
      return `\\tkzDefTriangleCenter[${c.kind}](${a[0]},${a[1]},${a[2]}) ${get(0)}`;
    case 'expr': {
      const p = opts.pos?.get(c.out[0]);
      opts.notes?.push(`${o[0]} = ${c.text.trim()} has no tkz-euclide equivalent: written as a fixed point`);
      if (!p) return `% ${o[0]} = ${c.text.trim()} (could not be converted)`;
      const f = opts.precise ? fmtK : fmt;
      return `\\tkzDefPoint(${f(p.x)},${f(p.y)}){${o[0]}} % was: ${c.text.trim().replace(/\s+/g, ' ')}`;
    }
  }
}

/** For intersections in another program's order: are the two points swapped w.r.t. tkz-euclide? */
function swapped(c: Extract<Construction, { op: 'interLC' | 'interCC' }>, pos?: Evaluated): boolean | null {
  const p = pos?.get(c.out[0]);
  const q = pos?.get(c.out[1]);
  const v = c.args.slice(0, 4).map((n) => pos?.get(n));
  if (!p || !q || v.some((x) => !x)) return null;
  const a = v as Vec[];
  // where tkz-euclide (no options) puts its first point
  const t = c.op === 'interLC' ? interLC(a[0]!, a[1]!, a[2]!, a[3]!) : interCC(a[0]!, a[1]!, a[2]!, a[3]!);
  if (!t) return null;
  return dist(t[0], p) > dist(t[0], q);
}

/** tkz-euclide label position keywords for an angle. */
export function posKeyword(angle: number): string {
  const k = ((Math.round(angle / 45) % 8) + 8) % 8;
  return ['right', 'above right', 'above', 'above left', 'left', 'below left', 'below', 'below right'][k]!;
}

export function drawingCode(d: DrawingSpec, name: (p: PointId) => string = (p) => p, ctx: { defs: Map<string, string>; pos?: Evaluated } = { defs: new Map() }): string {
  let options = d.options;
  if (d.src === 'asy') {
    if (d.cmd === 'tkzLabelPoint') {
      const dir = d.dir;
      let angle: number | null = null;
      if (dir && 'angle' in dir) angle = dir.angle;
      else if (dir && 'of' in dir) {
        const p = ctx.pos?.get(dir.of);
        if (p) angle = deg(p.x, p.y);
      }
      options = angle === null ? null : posKeyword(angle);
    } else {
      const st = asyStyle(d.options);
      if (d.cmd === 'tkzFillPolygon' || d.cmd === 'tkzFillCircle') {
        options = st.noStroke ? null : styleToTikz({ fill: st.color ?? 'rgb(0,0,0)', ...(st.fillOpacity !== undefined ? { fillOpacity: st.fillOpacity } : {}) }, ctx.defs);
        if (st.noStroke) return '';
      } else options = styleToTikz(st, ctx.defs);
    }
  }
  const opt = options !== null && options !== '' ? `[${options}]` : '';
  const pairs = d.cmd === 'tkzDrawSegments' || d.cmd === 'tkzDrawLines' || d.cmd === 'tkzDrawCircles' || d.cmd === 'tkzMarkSegments';
  const body = pairs ? d.groups.map((g) => g.map(name).join(',')).join(' ') : (d.groups[0] ?? []).map(name).join(',');
  if (d.cmd === 'tkzLabelPoint') return `\\${d.cmd}${opt}(${body}){${d.text ?? ''}}`;
  return `\\${d.cmd}${opt}(${body})`;
}

const isLabel = (d: DrawingSpec) => d.cmd === 'tkzLabelPoints' || d.cmd === 'tkzLabelPoint';

export function generate(g: Graph, opts: GenerateOptions = {}): string {
  const names = nameMap(g);
  const name = (p: PointId) => names.get(p) ?? p;
  const defs = new Map<string, string>(Object.entries(g.colors ?? {}).filter(([, v]) => !v.startsWith('pen:')));
  const ctx = { defs, pos: opts.pos };
  const steps = g.steps.map((s) => constructionCode(s.c, name, opts));
  const draws = g.drawings.filter((d) => !isLabel(d.d)).map((d) => drawingCode(d.d, name, ctx)).filter((l) => l);
  const labels = g.drawings.filter((d) => isLabel(d.d)).map((d) => drawingCode(d.d, name, ctx)).filter((l) => l);
  // colours: those of the source (\definecolor) plus any created while converting styles
  const colorLines = tikzColorDefs(defs);
  return [colorLines, steps, draws, labels]
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n')
    .concat('\n');
}

export function fullDocument(body: string): string {
  const indented = body
    .trimEnd()
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
  return [
    '\\documentclass[tikz,border=5pt]{standalone}',
    '\\usepackage{tkz-euclide}',
    '\\begin{document}',
    '\\begin{tikzpicture}',
    indented,
    '\\end{tikzpicture}',
    '\\end{document}',
    '',
  ].join('\n');
}
