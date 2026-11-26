// Construction graph → Asymptote (olympiad + geometry modules).
// Every construction becomes a named pair; drawings become draw/dot/label calls.

import type { Evaluated } from '../geom/evaluate';
import { normalizeAngles } from '../geom/constructions';
import type { Vec } from '../geom/vec';
import type { Construction, DrawingSpec, Graph, PointId } from '../graph/types';
import { isAux } from '../parser/ast';
import { asyStyle, styleToAsyFill, styleToAsyPen, tikzStyle } from '../style';
import { fmt, fmtK, type GenerateOptions } from './codegen';
import { labelAngleDist, labelDirOf } from '../ui/shapes';
import { asyRegion } from '../asy/front';

const ASY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Names Asymptote already uses (functions, constants, compass directions). */
const RESERVED = new Set([
  'N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NNE', 'ENE', 'ESE', 'SSE', 'SSW', 'WSW', 'WNW', 'NNW', 'I', 'pi', 'up', 'down',
  'left', 'right', 'origin', 'circle', 'line', 'point', 'pair', 'real', 'int', 'path', 'dot', 'draw', 'label', 'dir', 'unit',
  'abs', 'foot', 'red', 'blue', 'green', 'black', 'white', 'gray', 'grey', 'cycle', 'size', 'triangle', 'segment', 'pen',
  'fill', 'scale', 'shift', 'rotate', 'reflect', 'inch', 'cm', 'mm', 'pt', 'bp', 'Circle', 'arc', 'Label', 'string', 'bool',
]);

/** Valid, collision-free Asymptote names for every point. */
export function asyNames(g: Graph): Map<PointId, string> {
  const used = new Set<string>();
  const map = new Map<PointId, string>();
  const ok = (n: string) => !isAux(n) && ASY_NAME_RE.test(n) && !RESERVED.has(n);
  for (const s of g.steps) for (const n of s.c.out) if (ok(n)) used.add(n);
  let k = 0;
  for (const s of g.steps) {
    for (const n of s.c.out) {
      if (ok(n)) {
        map.set(n, n);
        continue;
      }
      let base = n.replace(/^~/, '').replace(/'/g, 'p').replace(/[^A-Za-z0-9_]/g, '');
      if (!base || /^\d/.test(base) || /^[a-z]*\d+$/.test(base)) base = 'P';
      let cand = ok(base) && !used.has(base) ? base : '';
      while (!cand) {
        const c = `${base}${++k}`;
        if (!used.has(c) && ASY_NAME_RE.test(c) && !RESERVED.has(c)) cand = c;
      }
      used.add(cand);
      map.set(n, cand);
    }
  }
  return map;
}

const deg = (v: Vec) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** Asymptote's ordering for intersectionpoints(line(A,B), circle(O, r)) and of two circles (geometry: by y). */
function asyIndexOfFirst(c: Extract<Construction, { op: 'interLC' | 'interCC' }>, pos: Evaluated | undefined): 0 | 1 | null {
  const p = pos?.get(c.out[0]);
  const q = pos?.get(c.out[1]);
  const v = c.args.map((n) => pos?.get(n));
  if (!p || !q || v.some((x) => !x)) return null;
  const a = v as Vec[];
  const dir = c.op === 'interLC' ? { x: a[1]!.x - a[0]!.x, y: a[1]!.y - a[0]!.y } : { x: -(a[2]!.y - a[0]!.y), y: a[2]!.x - a[0]!.x };
  const horizontal = Math.abs(dir.y) <= 1e-9 * Math.max(1, Math.hypot(dir.x, dir.y));
  const pFirst = horizontal ? p.x <= q.x : p.y <= q.y;
  return pFirst ? 0 : 1;
}

export function constructionAsy(c: Construction, name: (p: PointId) => string, opts: GenerateOptions): string[] {
  const a = c.args.map(name);
  const o = c.out.map(name);
  const decl = (e: string) => [`pair ${o[0]} = ${e};`];
  switch (c.op) {
    case 'free': {
      const f = opts.precise ? fmtK : fmt;
      if (c.polar) {
        const r = Math.hypot(c.x, c.y);
        const t = f(deg({ x: c.x, y: c.y }));
        return decl(Math.abs(r - 1) < 1e-9 ? `dir(${t})` : `${f(r)}*dir(${t})`);
      }
      return decl(`(${f(c.x)}, ${f(c.y)})`);
    }
    case 'midpoint':
      return decl(`midpoint(${a[0]}--${a[1]})`);
    case 'onLine':
      return decl(`interp(${a[0]}, ${a[1]}, ${fmtK(c.t)})`);
    case 'projection':
      return decl(`foot(${a[0]}, ${a[1]}, ${a[2]})`);
    case 'reflection':
      return decl(`reflect(${a[1]}, ${a[2]})*${a[0]}`);
    case 'symmetry':
      return decl(`2*${a[1]} - ${a[0]}`);
    case 'homothety':
      return decl(`${a[1]} + ${fmtK(c.k)}*(${a[0]} - ${a[1]})`);
    case 'rotation':
      return decl(`rotate(${fmtK(c.angle)}, ${a[1]})*${a[0]}`);
    case 'translation':
      return decl(`${a[0]} + ${a[2]} - ${a[1]}`);
    case 'shift':
      if (c.polar) return decl(`${a[0]} + ${fmtK(Math.hypot(c.dx, c.dy))}*dir(${fmtK(deg({ x: c.dx, y: c.dy }))})`);
      return decl(`${a[0]} + (${fmtK(c.dx)}, ${fmtK(c.dy)})`);
    case 'orthLine':
      return decl(`${a[0]} + rotate(90)*(${a[2]} - ${a[1]})`);
    case 'parLine':
      return decl(`${a[0]} + ${a[2]} - ${a[1]}`);
    case 'tangentAt':
      return decl(`${a[0]} - rotate(90)*unit(${a[1]} - ${a[0]})`);
    case 'midArc': {
      // tkz-euclide's arc goes counter-clockwise from A towards B: the middle is on the bisector,
      // on the side the arc sweeps (more than 180° → the other side)
      const P = opts.pos;
      const [O, A, B] = c.args.map((n) => P?.get(n));
      let sign = '+';
      if (O && A && B) {
        const [t1, t2] = normalizeAngles(deg({ x: A.x - O.x, y: A.y - O.y }), deg({ x: B.x - O.x, y: B.y - O.y }));
        if (t2 - t1 > 180) sign = '-';
      }
      return decl(`${a[0]} ${sign} abs(${a[1]} - ${a[0]})*unit(unit(${a[1]} - ${a[0]}) + unit(${a[2]} - ${a[0]}))`);
    }
    case 'interLL':
      return decl(`extension(${a[0]}, ${a[1]}, ${a[2]}, ${a[3]})`);
    case 'interLC':
    case 'interCC': {
      if (c.op === 'interLC' && c.seg) {
        // segment first: Asymptote orders the points along A→B and drops those off the segment
        const call = `intersectionpoints(${a[0]}--${a[1]}, Circle(${a[2]}, abs(${a[3]} - ${a[2]})))`;
        const P = opts.pos;
        const A = P?.get(c.args[0]);
        const B = P?.get(c.args[1]);
        const t = (n: PointId) => {
          const v = P?.get(n);
          return v && A && B ? (v.x - A.x) * (B.x - A.x) + (v.y - A.y) * (B.y - A.y) : null;
        };
        const ts = c.out.map(t);
        const lines: string[] = [];
        c.out.forEach((n, k) => {
          if (isAux(n) || ts[k] === null) return;
          const other = ts[1 - k];
          const idx = other !== null && other !== undefined && other < ts[k]! ? 1 : 0;
          lines.push(`pair ${o[k]} = ${call}[${idx}];`);
        });
        return lines.length ? lines : [`pair ${o[0]} = ${call}[0];`];
      }
      const call =
        c.op === 'interLC'
          ? `intersectionpoints(line(${a[0]}, ${a[1]}), circle((point)${a[2]}, abs(${a[3]} - ${a[2]})))`
          : `intersectionpoints(circle((point)${a[0]}, abs(${a[1]} - ${a[0]})), circle((point)${a[2]}, abs(${a[3]} - ${a[2]})))`;
      let i = asyIndexOfFirst(c, opts.pos);
      if (i === null) {
        opts.notes?.push(`${o[0]}/${o[1]}: could not decide which intersection point is which`);
        i = 0;
      }
      const lines: string[] = [];
      if (!isAux(c.out[0])) lines.push(`pair ${o[0]} = ${call}[${i}];`);
      if (!isAux(c.out[1])) lines.push(`pair ${o[1]} = ${call}[${1 - i}];`);
      if (!lines.length) lines.push(`pair ${o[0]} = ${call}[${i}];`);
      return lines;
    }
    case 'center': {
      const [x, y, z] = a;
      switch (c.kind) {
        case 'circum':
          return decl(`circumcenter(${x}, ${y}, ${z})`);
        case 'in':
          return decl(`incenter(${x}, ${y}, ${z})`);
        case 'centroid':
          return decl(`centroid(${x}, ${y}, ${z})`);
        case 'ortho':
          return decl(`orthocenter(${x}, ${y}, ${z})`);
        case 'ex':
          // tkz [ex](A,B,C) is opposite B; geometry's excenter(A,B,C) is opposite C
          return decl(`excenter(${x}, ${z}, ${y})`);
        case 'euler':
          return decl(`(circumcenter(${x}, ${y}, ${z}) + orthocenter(${x}, ${y}, ${z}))/2`);
      }
      return [];
    }
    case 'expr':
      return decl(c.text.trim());
  }
}

/** TikZ position keywords → Asymptote compass direction. */
const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const compassOf = (angle: number) => COMPASS[((Math.round(angle / 45) % 8) + 8) % 8]!;

export function drawingAsy(d: DrawingSpec, name: (p: PointId) => string, colors: Record<string, string>): string[] {
  const st = d.src === 'asy' ? asyStyle(d.options, colors) : tikzStyle(d.options, colors);
  const pen = d.src === 'asy' ? d.options : styleToAsyPen(st);
  const fillPen = d.src === 'asy' ? d.options : styleToAsyFill(st) ?? (st.color ? styleToAsyPen({ color: st.color }) : null);
  const withPen = (what: string, p: string | null = pen) => `draw(${what}${p ? `, ${p}` : ''});`;
  const g = d.groups.map((grp) => grp.map(name));
  const first = g[0] ?? [];
  const path = (pts: string[], closed: boolean) => pts.join('--') + (closed ? '--cycle' : '');
  switch (d.cmd) {
    case 'tkzDrawSegment':
    case 'tkzDrawSegments':
      return g.map((p) => withPen(path(p, false)));
    case 'tkzDrawLine':
    case 'tkzDrawLines':
      if (d.infinite) return g.map((p) => withPen(`line(${p[0]}, ${p[1]})`));
      // tkz-euclide extends a drawn line by 20 % on both sides
      return g.map((p) => withPen(`interp(${p[0]}, ${p[1]}, -0.2)--interp(${p[0]}, ${p[1]}, 1.2)`));
    case 'tkzDrawPolygon':
      if (st.fill && d.src !== 'asy') return [`filldraw(${path(first, true)}, ${styleToAsyFill(st)}${pen ? `, ${pen}` : ''});`];
      return [withPen(path(first, true))];
    case 'tkzFillPolygon':
      return [`fill(${path(first, true)}${fillPen ? `, ${fillPen}` : ''});`];
    case 'tkzDrawPolySeg':
      return [withPen(path(first, false))];
    case 'tkzDrawCircle':
    case 'tkzDrawCircles':
      return g.map((p) => (st.fill && d.src !== 'asy' ? `filldraw(circle(${p[0]}, abs(${p[1]} - ${p[0]})), ${styleToAsyFill(st)}${pen ? `, ${pen}` : ''});` : withPen(`circle(${p[0]}, abs(${p[1]} - ${p[0]}))`)));
    case 'tkzFillCircle':
      return g.map((p) => `fill(circle(${p[0]}, abs(${p[1]} - ${p[0]}))${fillPen ? `, ${fillPen}` : ''});`);
    case 'tkzDrawPoint':
    case 'tkzDrawPoints': {
      const dotPen = d.src === 'asy' ? d.options : st.fill ? styleToAsyPen({ color: st.fill }) : st.color ? styleToAsyPen({ color: st.color }) : null;
      return first.map((p) => `dot(${p}${dotPen ? `, ${dotPen}` : ''});`);
    }
    case 'tkzLabelPoints': {
      const dir = labelDirOf(d.options, { angle: -90, k: 1 });
      return d.groups[0]!.map((p) => `label("$${p}$", ${name(p)}${dir ? `, ${compassOf(dir.angle)}` : ''});`);
    }
    case 'tkzLabelPoint': {
      const text = (d.text ?? '').replace(/"/g, '\\"');
      if (d.src === 'asy') return [`label("${text}", ${first[0]}${d.options ? `, ${d.options}` : ''});`];
      const dir = labelDirOf(d.options, d.src === 'tikz' ? null : { angle: -90, k: 1 });
      return [`label("${text}", ${first[0]}${dir ? `, ${compassOf(dir.angle)}` : ''});`];
    }
    case 'tkzMarkRightAngle':
      return [withPen(`rightanglemark(${first.join(', ')})`)];
    case 'tkzMarkAngle':
      return [withPen(`anglemark(${first.join(', ')})`)];
    case 'tkzMarkSegment':
    case 'tkzMarkSegments':
      return g.map((p) => `// tick mark on ${p[0]}--${p[1]} (no Asymptote equivalent in olympiad.asy)`);
    case 'tkzDrawArc':
      return [withPen(`arc(${first[0]}, ${first[1]}, ${first[2]})`)];
    case 'tkzDrawSemiCircle':
      return [withPen(`arc(${first[0]}, ${first[1]}, 2*${first[0]} - ${first[1]})`)];
    case 'tkzDrawSector':
      if (st.fill && d.src !== 'asy') return [`filldraw(${first[0]}--arc(${first[0]}, ${first[1]}, ${first[2]})--cycle, ${styleToAsyFill(st)}${pen ? `, ${pen}` : ''});`];
      return [withPen(`${first[0]}--arc(${first[0]}, ${first[1]}, ${first[2]})--cycle`)];
    case 'tkzFillSector':
      return [`fill(${first[0]}--arc(${first[0]}, ${first[1]}, ${first[2]})--cycle${fillPen ? `, ${fillPen}` : ''});`];
    case 'tkzLabelAngle': {
      // at dist (default 1) along the bisector of the counter-clockwise angle from BA to BC
      const [A, B, C] = first;
      const dist = labelAngleDist(d.options);
      const text = (d.text ?? '').replace(/"/g, '\\"');
      return [`label("${text}", ${B} + ${fmtK(dist)}*dir(degrees(${A} - ${B}) + ((degrees(${C} - ${B}) - degrees(${A} - ${B})) % 360)/2));`];
    }
  }
}

/** Graph → Asymptote code (without the LaTeX wrapper). */
export function generateAsy(g: Graph, opts: GenerateOptions = {}): string {
  const names = asyNames(g);
  const name = (p: PointId) => names.get(p) ?? p;
  const colors = g.colors ?? {};
  const lines: string[] = ['import olympiad;', 'import geometry;', 'size(8cm);', ''];
  // pens defined in the Asymptote source keep their names
  for (const [k, v] of Object.entries(colors)) if (v.startsWith('pen:') && g.lang === 'asy') lines.push(`pen ${k} = ${v.slice(4)};`);
  for (const s of g.steps) lines.push(...constructionAsy(s.c, name, opts));
  const draws = g.drawings.filter((d) => d.d.cmd !== 'tkzLabelPoint' && d.d.cmd !== 'tkzLabelPoints');
  const labels = g.drawings.filter((d) => d.d.cmd === 'tkzLabelPoint' || d.d.cmd === 'tkzLabelPoints');
  if (draws.length) lines.push('');
  for (const d of draws) lines.push(...drawingAsy(d.d, name, colors));
  if (labels.length) lines.push('');
  for (const d of labels) lines.push(...drawingAsy(d.d, name, colors));
  return lines.join('\n') + '\n';
}

/** A compilable LaTeX document around Asymptote code (needs pdflatex + asy, like the asymptote package). */
export function fullAsyDocument(body: string): string {
  const indented = body
    .trimEnd()
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
  return ['\\documentclass{standalone}', '\\usepackage{asymptote}', '\\begin{document}', '\\begin{asy}', indented, '\\end{asy}', '\\end{document}', ''].join('\n');
}

/** The Asymptote code of the editor text: the content of \begin{asy}…\end{asy}, dedented, or the whole text. */
export function extractAsyBody(text: string): string {
  const { code } = asyRegion(text);
  const lines = code.replace(/^\s*\n/, '').trimEnd().split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n') + '\n';
}
