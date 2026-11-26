// Points on objects (gliders), crossings, the arc / tangent / transform tools, and in-place
// style edits from the properties panel.

import { describe, expect, it } from 'vitest';
import { generate } from '../src/codegen/codegen';
import { generateAsy } from '../src/codegen/asy';
import { evaluate } from '../src/geom/evaluate';
import type { Vec } from '../src/geom/vec';
import type { DefStatement, DrawStatement } from '../src/parser/ast';
import { parse } from '../src/parser/parser';
import { parseAsymptote } from '../src/asy/front';
import { compile, type Lang } from '../src/pipeline';
import { applyEdits, paramEdits, segmentOnly } from '../src/ui/literal';
import {
  drawingInfo,
  pointLabelInfo,
  setAngleLabel,
  setAsyPen,
  setDrawingStyle,
  setPointLabel,
  setTicks,
  setTikzOption,
  tikzValue,
} from '../src/ui/props';
import { pointHandles, shapesOf, labelsOf } from '../src/ui/shapes';
import { crossings, handlePick, initialState, type Target, type ToolId, type ToolState } from '../src/ui/tools';

const near = (p: Vec | null | undefined, x: number, y: number, digits = 6) => {
  expect(p).toBeTruthy();
  expect(p!.x).toBeCloseTo(x, digits);
  expect(p!.y).toBeCloseTo(y, digits);
};

const ok = (src: string, lang: Lang = 'tkz') => {
  const r = compile(src, lang);
  expect(r.diagnostics.filter((d) => d.severity === 'error'), src).toEqual([]);
  return { graph: r.graph!, pos: evaluate(r.graph!) };
};

// ------------------------------------------------------------------ parsing

describe('parsing', () => {
  it('\\tkzDefPointOnLine[pos=t](A,B), with t as a draggable number', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/2/B}\n\\tkzDefPointOnLine[pos=0.25](A,B) \\tkzGetPoint{P}\n\\tkzDefPointOnLine[pos=1/3](A,B) \\tkzGetPoint{Q}';
    const { pos } = ok(src);
    near(pos.get('P'), 1, 0.5);
    near(pos.get('Q'), 4 / 3, 2 / 3);
    const st = parse(src).statements.filter((s): s is DefStatement => s.type === 'def');
    const p = st.find((s) => s.c.out[0] === 'P')!;
    expect(p.lit?.kind).toBe('param');
    expect(src.slice(p.lit!.kind === 'param' ? p.lit!.spans[0]!.from : 0, p.lit!.kind === 'param' ? p.lit!.spans[0]!.to : 0)).toBe('0.25');
    // a fraction is not rewritten by a drag
    expect(st.find((s) => s.c.out[0] === 'Q')!.lit).toBeUndefined();
  });
  it('rejects \\tkzDefPointOnLine without pos', () => {
    const r = compile('\\tkzDefPoints{0/0/A, 4/2/B}\n\\tkzDefPointOnLine[near](A,B) \\tkzGetPoint{P}');
    expect(r.diagnostics[0]!.message).toMatch(/pos=t/);
  });
  it('homothety ratios and rotation angles written as numbers are draggable', () => {
    const st = parse('\\tkzDefPointBy[rotation=center O angle 40](A) \\tkzGetPoint{B}\\tkzDefPointBy[homothety=center O ratio 1/2](A) \\tkzGetPoint{C}').statements as DefStatement[];
    expect(st[0]!.lit).toMatchObject({ kind: 'param' });
    expect(st[1]!.lit).toBeUndefined();
  });
  it('arcs, semicircles, sectors and angle labels', () => {
    const src = `\\tkzDefPoints{0/0/O, 2/0/A, 0/2/B}
\\tkzDrawArc[red](O,A)(B)
\\tkzDrawSemiCircle(O,A)
\\tkzDrawSector[fill=blue](O,B)(A)
\\tkzFillSector(O,A)(B)
\\tkzMarkAngle(A,O,B)
\\tkzLabelAngle[dist=1.5](A,O,B){$\\alpha$}`;
    const { graph, pos } = ok(src);
    expect(compile(src).diagnostics).toEqual([]);
    const cmds = graph.drawings.map((d) => d.d.cmd);
    expect(cmds).toEqual(['tkzDrawArc', 'tkzDrawSemiCircle', 'tkzDrawSector', 'tkzFillSector', 'tkzMarkAngle', 'tkzLabelAngle']);
    const arc = shapesOf(graph.drawings[0]!, pos)[0]!.shape;
    expect(arc).toMatchObject({ type: 'arc', r: 2 });
    if (arc.type === 'arc') {
      expect(arc.t1).toBeCloseTo(0);
      expect(arc.t2).toBeCloseTo(Math.PI / 2);
    }
    // the sector goes counter-clockwise from B (90°) towards A (0° → 360°)
    const sec = shapesOf(graph.drawings[2]!, pos)[0]!.shape;
    if (sec.type === 'arc') expect(sec.t2 - sec.t1).toBeCloseTo((3 * Math.PI) / 2);
    const semi = shapesOf(graph.drawings[1]!, pos)[0]!.shape;
    if (semi.type === 'arc') expect(semi.t2 - semi.t1).toBeCloseTo(Math.PI);
    const lbl = labelsOf(graph.drawings[5]!, pos)[0]!;
    near(lbl.at, 1.5 * Math.SQRT1_2, 1.5 * Math.SQRT1_2);
    // round trip through the code generator
    expect(generate(graph)).toContain('\\tkzDrawArc[red](O,A)(B)');
    expect(generate(graph)).toContain('\\tkzLabelAngle[dist=1.5](A,O,B){$\\alpha$}');
  });
  it('other arc forms stay a warning', () => {
    const r = compile('\\tkzDefPoints{0/0/O, 2/0/A}\n\\tkzDrawArc[rotate](O,A)(90)');
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'ignored' })]);
  });
  it('options of drawings know where they are written', () => {
    const src = '\\tkzDrawSegment[red](A,B)\\tkzDrawCircle(O,A)\\draw[thick] (A)--(B);';
    const st = parse(src).statements as DrawStatement[];
    expect(src.slice(st[0]!.opt!.span.from, st[0]!.opt!.span.to)).toBe('red');
    expect(st[1]!.opt).toMatchObject({ insert: 'bracket' });
    expect(src.slice(st[1]!.opt!.span.from - 14, st[1]!.opt!.span.from)).toBe('\\tkzDrawCircle');
    const tikz = st.find((s) => s.type === 'draw' && s.d.src === 'tikz')!;
    expect(src.slice(tikz.opt!.span.from, tikz.opt!.span.to)).toBe('thick');
  });
});

describe('Asymptote', () => {
  it('interp(A,B,t) is a point on AB with a draggable t', () => {
    const r = parseAsymptote('pair A=(0,0), B=(4,0); pair P = interp(A, B, 0.25);');
    const p = r.statements.find((s) => s.type === 'def' && s.c.out[0] === 'P') as DefStatement;
    expect(p.c).toMatchObject({ op: 'onLine', args: ['A', 'B'], t: 0.25 });
    expect(p.lit?.kind).toBe('param');
  });
  it('rotate(a, C)*P with a literal angle is draggable', () => {
    const r = parseAsymptote('pair O=(0,0), A=(2,0); pair P = rotate(30, O)*A;');
    const p = r.statements.find((s) => s.type === 'def' && s.c.out[0] === 'P') as DefStatement;
    expect(p.c).toMatchObject({ op: 'rotation', angle: 30 });
    expect(p.lit?.kind).toBe('param');
  });
  it('arc(c, A, B), arc(c, r, a1, a2) and sectors', () => {
    const { graph, pos } = ok('pair O=(0,0), A=(2,0), B=(0,2);\ndraw(arc(O, A, B));\ndraw(arc(O, 1, 0, 180), red);\nfilldraw(O--arc(O, A, B)--cycle, blue);', 'asy');
    expect(graph.drawings.map((d) => d.d.cmd)).toEqual(['tkzDrawArc', 'tkzDrawArc', 'tkzFillSector', 'tkzDrawSector']);
    const second = shapesOf(graph.drawings[1]!, pos)[0]!.shape;
    expect(second).toMatchObject({ type: 'arc', r: 1 });
  });
  it('clockwise arcs are not drawn (warning)', () => {
    const r = compile('pair O=(0,0), A=(2,0), B=(0,2);\ndraw(arc(O, A, B, CW));', 'asy');
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning' });
  });
  it('the new drawings convert to Asymptote', () => {
    const { graph, pos } = ok('\\tkzDefPoints{0/0/O, 2/0/A, 0/2/B}\n\\tkzDefPointOnLine[pos=0.5](A,B)\\tkzGetPoint{M}\n\\tkzDrawArc(O,A)(B)\n\\tkzDrawSemiCircle(O,A)\n\\tkzDrawSector(O,A)(B)\n\\tkzLabelAngle(A,O,B){$x$}');
    const asy = generateAsy(graph, { pos });
    expect(asy).toContain('pair M = interp(A, B, 0.5);');
    expect(asy).toContain('draw(arc(O, A, B));');
    expect(asy).toContain('draw(arc(O, A, 2*O - A));');
    expect(asy).toContain('draw(O--arc(O, A, B)--cycle);');
    // and back: every point stays where it is
    const back = ok(asy, 'asy');
    for (const n of ['O', 'A', 'B', 'M']) near(back.pos.get(n), pos.get(n)!.x, pos.get(n)!.y);
  });
});

// ------------------------------------------------------------------ gliders

describe('dragging points on objects', () => {
  it('onLine: the position follows the mouse along the line, clamped on a segment', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/0/B}\n\\tkzDrawSegment(A,B)\n\\tkzDefPointOnLine[pos=0.25](A,B) \\tkzGetPoint{P}';
    const { graph, pos } = ok(src);
    const step = graph.steps.find((s) => s.c.out[0] === 'P')!;
    expect(pointHandles(graph, pos).find((h) => h.name === 'P')).toMatchObject({ glider: true, draggable: true });
    expect(segmentOnly(graph, 'A', 'B')).toBe(true);
    const m = paramEdits(step.c, step.lit!, pos, { x: 3, y: 1 }, false, true)!;
    expect(m.value).toBeCloseTo(0.75);
    expect(applyEdits(src, m.edits)).toContain('[pos=0.75](A,B)');
    expect(paramEdits(step.c, step.lit!, pos, { x: 9, y: 0 }, false, true)!.value).toBe(1);
    expect(paramEdits(step.c, step.lit!, pos, { x: 9, y: 0 }, false, false)!.value).toBe(2.25);
    expect(paramEdits(step.c, step.lit!, pos, { x: 1.13, y: 0 }, true, false)!.value).toBeCloseTo(0.3);
  });
  it('rotation: the angle follows the mouse around the centre, without jumping at ±180°', () => {
    const src = '\\tkzDefPoints{0/0/O, 2/0/A}\n\\tkzDefPointBy[rotation=center O angle 170](A) \\tkzGetPoint{P}';
    const { graph, pos } = ok(src);
    const step = graph.steps.find((s) => s.c.out[0] === 'P')!;
    const m = paramEdits(step.c, step.lit!, pos, { x: -1, y: -0.2 }, false)!;
    expect(m.value).toBeCloseTo(191.3, 1);
    expect(paramEdits(step.c, step.lit!, pos, { x: 0, y: 3 }, true)!.value).toBe(90);
  });
  it('homothety: the ratio follows the mouse along the line', () => {
    const src = '\\tkzDefPoints{0/0/O, 2/0/A}\n\\tkzDefPointBy[homothety=center O ratio 2](A) \\tkzGetPoint{P}';
    const { graph, pos } = ok(src);
    const step = graph.steps.find((s) => s.c.out[0] === 'P')!;
    expect(paramEdits(step.c, step.lit!, pos, { x: -3, y: 1 }, false)!.value).toBe(-1.5);
  });
});

// ------------------------------------------------------------------ tools

const BASE: Record<Lang, string> = {
  tkz: '\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C}\n\\tkzDrawPolygon(A,B,C)\n\\tkzDrawCircle(A,B)\n',
  asy: 'import olympiad;\npair A = (0, 0), B = (4, 0), C = (1, 3);\ndraw(A--B--C--cycle);\ndraw(circle(A, abs(B - A)));\n',
};

const pt = (name: string): Target => ({ kind: 'point', name });
const at = (x: number, y: number): Target => ({ kind: 'empty', at: { x, y }, tol: 0.2 });
const on = (cmd: string, x: number, y: number, shift = false) => (code: string, lang: Lang): Target => {
  const g = compile(code, lang).graph!;
  return { kind: 'drawing', id: g.drawings.find((d) => d.d.cmd === cmd)!.id, at: { x, y }, tol: 0.2, shift };
};

function run(lang: Lang, tool: ToolId, clicks: (Target | ((code: string, lang: Lang) => Target))[], code = BASE[lang], param?: number) {
  let s: ToolState = initialState(tool, param);
  let text = code;
  let last;
  for (const c of clicks) {
    last = handlePick(s, typeof c === 'function' ? c(text, lang) : c, text, lang, false);
    s = last.state;
    if (last.text !== undefined) text = last.text;
  }
  const { graph, pos } = ok(text, lang);
  return { text, graph, pos, last: last! };
}

describe.each(['tkz', 'asy'] as const)('tools in %s', (lang) => {
  it('a point clicked on a side is a glider on it', () => {
    const r = run(lang, 'point', [on('tkzDrawPolygon', 2.5, 0.05)]);
    near(r.pos.get('D'), 2.5, 0);
    expect(r.text).toContain(lang === 'tkz' ? '\\tkzDefPointOnLine[pos=0.625](A,B)' : 'interp(A, B, 0.625)');
    expect(r.graph.steps.find((s) => s.c.out[0] === 'D')!.lit?.kind).toBe('param');
  });
  it('a point clicked on a circle is a glider on it', () => {
    const r = run(lang, 'point', [on('tkzDrawCircle', 0, 4.02)]);
    near(r.pos.get('D'), 0, 4);
    expect(r.text).toContain(lang === 'tkz' ? '\\tkzDefPointBy[rotation=center A angle 90](B)' : 'rotate(90, A)*B');
  });
  it('a click near a crossing makes the intersection point; Shift makes a glider instead', () => {
    // the segment CE (x = 1) crosses AB at (1, 0) and the circle (A, 4) at (1, −√15)
    const code = lang === 'tkz' ? `${BASE.tkz}\\tkzDefPoint(1,-5){E}\n\\tkzDrawSegment(C,E)\n` : `${BASE.asy}pair E = (1, -5);\ndraw(C--E);\n`;
    const x = crossings(ok(code, lang).graph, ok(code, lang).pos);
    expect(x.map((c) => [c.at.x, c.at.y].map((v) => Math.round(v * 1000) / 1000))).toEqual(
      expect.arrayContaining([
        [1, 0],
        [1, -3.873],
      ]),
    );
    const ll = run(lang, 'point', [at(1.05, 0.08)], code);
    near(ll.pos.get('D'), 1, 0);
    expect(ll.graph.steps.find((s) => s.c.out.includes('D'))!.c.op).toBe('interLL');
    const lc = run(lang, 'point', [on('tkzDrawSegment', 1.02, -3.8)], code);
    near(lc.pos.get('D'), 1, -Math.sqrt(15));
    expect(lc.graph.steps.find((s) => s.c.out.includes('D'))!.c.op).toBe('interLC');
    const g = run(lang, 'point', [on('tkzDrawSegment', 1.02, -3.8, true)], code);
    expect(g.graph.steps.find((s) => s.c.out.includes('D'))!.c.op).toBe('onLine');
  });
  it('tangent at a point on the circle, and the two tangents from outside', () => {
    const at1 = run(lang, 'tangent', [pt('B'), on('tkzDrawCircle', 0, -4)]);
    const line = at1.graph.drawings.find((d) => d.d.cmd === 'tkzDrawLine')!;
    const [p, q] = line.d.groups[0]!.map((n) => at1.pos.get(n)!);
    expect(p!.x).toBeCloseTo(4);
    expect(q!.x).toBeCloseTo(4); // vertical through B
    const from = run(lang, 'tangent', [at(8, 0), on('tkzDrawCircle', 0, -4)]);
    for (const n of ['E', 'F']) {
      const t = from.pos.get(n)!;
      expect(Math.hypot(t.x, t.y)).toBeCloseTo(4); // on the circle
      expect(t.x * (t.x - 8) + t.y * t.y).toBeCloseTo(0); // AT ⊥ TD
    }
    expect(from.graph.drawings.some((d) => d.d.cmd === 'tkzDrawLines' || (lang === 'asy' && d.d.cmd === 'tkzDrawLine'))).toBe(true);
  });
  it('arc, semicircle and sector', () => {
    expect(run(lang, 'arc', [pt('A'), pt('B'), pt('C')]).graph.drawings.some((d) => d.d.cmd === 'tkzDrawArc')).toBe(true);
    const semi = run(lang, 'semicircle', [pt('A'), pt('B')]);
    const s = semi.graph.drawings.find((d) => d.d.cmd === 'tkzDrawSemiCircle' || d.d.cmd === 'tkzDrawArc')!;
    const sh = shapesOf(s, semi.pos)[0]!.shape;
    expect(sh).toMatchObject({ type: 'arc', r: 2 });
    if (sh.type === 'arc') expect(sh.t2 - sh.t1).toBeCloseTo(Math.PI);
    expect(run(lang, 'sector', [pt('A'), pt('B'), pt('C')]).graph.drawings.some((d) => d.d.cmd === 'tkzDrawSector')).toBe(true);
  });
  it('rotate, dilate and translate whole objects', () => {
    const rot = run(lang, 'rotate', [on('tkzDrawPolygon', 2, 0), pt('A')], BASE[lang], 90);
    near(rot.pos.get('B_1'), 0, 4);
    near(rot.pos.get('C_1'), -3, 1);
    expect(rot.graph.drawings.filter((d) => d.d.cmd === 'tkzDrawPolygon')).toHaveLength(2);
    const dil = run(lang, 'dilate', [pt('C'), pt('A')], BASE[lang], 0.5);
    near(dil.pos.get('C_1'), 0.5, 1.5);
    const tr = run(lang, 'translate', [on('tkzDrawCircle', 0, 4), pt('A'), pt('C')]);
    expect(tr.graph.drawings.filter((d) => d.d.cmd === 'tkzDrawCircle')).toHaveLength(2);
  });
  it('a reflected sector keeps its side of the arc', () => {
    const code = lang === 'tkz' ? `${BASE.tkz}\\tkzDrawSector(A,B)(C)\n` : `${BASE.asy}draw(A--arc(A, B, C)--cycle);\n`;
    const r = run(lang, 'reflectLine', [on('tkzDrawSector', 3, 1), pt('A'), pt('C')], code);
    const secs = r.graph.drawings.filter((d) => d.d.cmd === 'tkzDrawSector');
    expect(secs).toHaveLength(2);
    const span = (d: (typeof secs)[number]) => {
      const s = shapesOf(d, r.pos)[0]!.shape;
      return s.type === 'arc' ? s.t2 - s.t1 : NaN;
    };
    expect(span(secs[1]!)).toBeCloseTo(span(secs[0]!));
  });
  it('the circle input rejects a segment', () => {
    const s0 = handlePick(initialState('tangent'), pt('B'), BASE[lang], lang, false);
    const g = compile(BASE[lang], lang).graph!;
    const poly = g.drawings.find((d) => d.d.cmd === 'tkzDrawPolygon')!;
    expect(handlePick(s0.state, { kind: 'drawing', id: poly.id, at: { x: 2, y: 0 } }, BASE[lang], lang, false).rejected).toBe(true);
  });
});

// ------------------------------------------------------------------ properties

describe('properties panel', () => {
  it('edits TikZ options key by key, keeping the unknown ones', () => {
    expect(setTikzOption('red, thick, my style', 'color', 'blue')).toBe('thick, my style, color=blue');
    expect(setTikzOption('red, thick', 'width', null)).toBe('red');
    expect(setTikzOption('dashed', 'dash', 'dotted')).toBe('dotted');
    expect(setTikzOption('above right, red', 'position', 'left')).toBe('left, red');
    expect(tikzValue('color=blue!20, densely dashed', 'color')).toBe('blue!20');
    expect(tikzValue('color=blue!20, densely dashed', 'dash')).toBe('densely dashed');
    expect(setAsyPen('red+dashed+linewidth(1)', 'color', 'blue')).toBe('dashed+linewidth(1)+blue');
    expect(setAsyPen('red+dashed', 'dash', 'solid')).toBe('red');
  });
  it('restyles a tkz-euclide drawing in place', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C}\n\\tkzDrawPolygon(A,B,C)\n\\tkzDrawCircle[dashed](A,B)\n';
    const { graph } = ok(src);
    const poly = graph.drawings[0]!;
    let out = setDrawingStyle(src, graph, poly, { key: 'color', value: 'red' })!;
    expect(out).toContain('\\tkzDrawPolygon[color=red](A,B,C)');
    out = setDrawingStyle(out, ok(out).graph, ok(out).graph.drawings[0]!, { key: 'fill', value: 'blue' })!;
    expect(out).toContain('\\tkzDrawPolygon[color=red, fill=blue, fill opacity=0.3](A,B,C)');
    const circle = ok(out).graph.drawings[1]!;
    out = setDrawingStyle(out, ok(out).graph, circle, { key: 'dash', value: 'solid' })!;
    expect(out).toContain('\\tkzDrawCircle(A,B)');
    expect(drawingInfo(ok(out).graph, ok(out).graph.drawings[0]!, null)).toMatchObject({ color: 'red', fill: 'blue', fillOpacity: '0.3', canFill: true });
  });
  it('restyles an Asymptote drawing by its pen', () => {
    const src = 'pair A=(0,0), B=(4,0);\ndraw(A--B);\ndraw(circle(A, 2), red+dashed);\n';
    const { graph } = ok(src, 'asy');
    let out = setDrawingStyle(src, graph, graph.drawings[0]!, { key: 'color', value: 'blue' })!;
    expect(out).toContain('draw(A--B, blue);');
    const g2 = ok(out, 'asy').graph;
    out = setDrawingStyle(out, g2, g2.drawings[1]!, { key: 'dash', value: 'solid' })!;
    expect(out).toContain('draw(circle(A, 2), red);');
    const g3 = ok(out, 'asy').graph;
    out = setDrawingStyle(out, g3, g3.drawings[1]!, { key: 'color', value: null })!;
    expect(out).toContain('draw(circle(A, 2));');
  });
  it('tick marks on a side: add, change, remove', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C}\n\\tkzDrawPolygon(A,B,C)\n';
    let out = setTicks(src, ok(src).graph, 'A', 'B', 2)!;
    expect(out).toContain('\\tkzMarkSegment[mark=||](A,B)');
    out = setTicks(out, ok(out).graph, 'B', 'A', 1)!;
    expect(out).toContain('\\tkzMarkSegment(A,B)');
    out = setTicks(out, ok(out).graph, 'A', 'B', 0)!;
    expect(out).toBe(src);
    // one pair of a \tkzMarkSegments list
    const multi = `${src}\\tkzMarkSegments(A,B B,C)\n`;
    out = setTicks(multi, ok(multi).graph, 'B', 'C', 3)!;
    expect(out).toContain('\\tkzMarkSegments(A,B)');
    expect(out).toContain('\\tkzMarkSegment[mark=|||](B,C)');
    expect(drawingInfo(ok(out).graph, ok(out).graph.drawings[0]!, ['B', 'C']).ticks).toBe(3);
  });
  it('angle marks: arcs, size and a label', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C}\n\\tkzMarkAngle(B,A,C)\n';
    const { graph } = ok(src);
    let out = setDrawingStyle(src, graph, graph.drawings[0]!, { key: 'arcs', value: 2 })!;
    expect(out).toContain('\\tkzMarkAngle[arc=ll](B,A,C)');
    expect(shapesOf(ok(out).graph.drawings[0]!, ok(out).pos)[0]!.shape).toMatchObject({ type: 'angle', n: 2 });
    out = setAngleLabel(out, ok(out).graph, ok(out).graph.drawings[0]!, '$\\alpha$')!;
    expect(out).toContain('\\tkzLabelAngle[dist=1.35](B,A,C){$\\alpha$}');
    expect(drawingInfo(ok(out).graph, ok(out).graph.drawings[0]!, null).angleLabel).toBe('$\\alpha$');
    out = setAngleLabel(out, ok(out).graph, ok(out).graph.drawings[0]!, '')!;
    expect(out).not.toContain('tkzLabelAngle');
  });
  it('label position of a point: its own label, one of a list, hide', () => {
    const src = '\\tkzDefPoints{0/0/A, 4/0/B}\n\\tkzLabelPoints[above right](A,B)\n';
    expect(pointLabelInfo(ok(src).graph, 'A')).toMatchObject({ position: 'above right', editable: true });
    let out = setPointLabel(src, ok(src).graph, 'A', 'left', 'tkz')!;
    expect(out).toBe('\\tkzDefPoints{0/0/A, 4/0/B}\n\\tkzLabelPoints[above right](B)\n\\tkzLabelPoint[left](A){$A$}\n');
    out = setPointLabel(out, ok(out).graph, 'A', 'below', 'tkz')!;
    expect(out).toContain('\\tkzLabelPoint[below](A){$A$}');
    out = setPointLabel(out, ok(out).graph, 'A', 'hide', 'tkz')!;
    expect(out).toBe('\\tkzDefPoints{0/0/A, 4/0/B}\n\\tkzLabelPoints[above right](B)\n');
  });
  it('label direction of an Asymptote dot/label', () => {
    const src = 'pair A=(0,0);\ndot("$A$", A, NE);\n';
    const out = setPointLabel(src, ok(src, 'asy').graph, 'A', 'below left', 'asy')!;
    expect(out).toBe('pair A=(0,0);\ndot("$A$", A, SW);\n');
    const src2 = 'pair A=(0,0);\nlabel("$A$", A);\n';
    expect(setPointLabel(src2, ok(src2, 'asy').graph, 'A', 'above', 'asy')).toBe('pair A=(0,0);\nlabel("$A$", A, N);\n');
  });
});
