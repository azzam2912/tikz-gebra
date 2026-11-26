// Construction tools: clicks → code in tkz-euclide or Asymptote, checked geometrically.

import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/geom/evaluate';
import type { Vec } from '../src/geom/vec';
import { compile, type Lang } from '../src/pipeline';
import { curveOfDrawing, handlePick, initialState, TOOLS, type Target, type ToolId, type ToolState } from '../src/ui/tools';

const BASE: Record<Lang, string> = {
  tkz: '\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C}\n\\tkzDrawPolygon(A,B,C)\n\\tkzDrawCircle(A,B)\n',
  asy: 'import olympiad;\npair A = (0, 0), B = (4, 0), C = (1, 3);\ndraw(A--B--C--cycle);\ndraw(circle(A, abs(B - A)));\n',
};

const pt = (name: string): Target => ({ kind: 'point', name });
const at = (x: number, y: number): Target => ({ kind: 'empty', at: { x, y } });

/** Apply a sequence of clicks with a tool; returns the final code (must compile cleanly). */
function run(lang: Lang, tool: ToolId, clicks: (Target | ((code: string) => Target))[], code = BASE[lang]) {
  let s: ToolState = initialState(tool);
  let text = code;
  let last;
  for (const c of clicks) {
    const target = typeof c === 'function' ? c(text) : c;
    last = handlePick(s, target, text, lang, false);
    s = last.state;
    if (last.text !== undefined) text = last.text;
  }
  const r = compile(text, lang);
  expect(r.diagnostics.filter((d) => d.severity === 'error'), text).toEqual([]);
  return { text, pos: evaluate(r.graph!), graph: r.graph!, last: last! };
}

const near = (p: Vec | null | undefined, x: number, y: number) => {
  expect(p).toBeTruthy();
  expect(p!.x).toBeCloseTo(x, 6);
  expect(p!.y).toBeCloseTo(y, 6);
};

/** The drawing of a given command, for clicking on it. */
const drawingClick = (cmd: string, x: number, y: number) => (code: string): Target => {
  const g = compile(code).graph!;
  const d = g.drawings.find((dd) => dd.d.cmd === cmd)!;
  return { kind: 'drawing', id: d.id, at: { x, y } };
};

describe.each(['tkz', 'asy'] as const)('tools in %s', (lang) => {
  it('point: an empty click creates a labelled free point with rounded coordinates', () => {
    const { pos, text } = run(lang, 'point', [at(2.123, -1.987)]);
    near(pos.get('D'), 2.12, -1.99);
    expect(text).toContain(lang === 'asy' ? 'dot("$D$", D, NE);' : '\\tkzLabelPoints[above right](D)');
  });
  it('the new code goes before \\end{tikzpicture} / \\end{asy}, indented', () => {
    const wrapped = lang === 'asy' ? `\\begin{asy}\n  ${BASE.asy.trim().split('\n').join('\n  ')}\n\\end{asy}\n` : `\\begin{tikzpicture}\n  ${BASE.tkz.trim().split('\n').join('\n  ')}\n\\end{tikzpicture}\n`;
    const { text } = run(lang, 'point', [at(1, 1)], wrapped);
    const lines = text.trimEnd().split('\n');
    expect(lines[lines.length - 1]).toMatch(/^\\end\{/);
    expect(lines[lines.length - 2]).toMatch(/^ {2}\S/);
  });
  it('segment and line between new or existing points', () => {
    const { graph } = run(lang, 'segment', [pt('A'), at(5, 5)]);
    expect(graph.drawings.some((d) => d.d.cmd === 'tkzDrawSegment' && d.d.groups[0]!.join() === 'A,D')).toBe(true);
    const r = run(lang, 'line', [pt('B'), pt('C')]);
    expect(r.graph.drawings.some((d) => d.d.cmd === 'tkzDrawLine')).toBe(true);
  });
  it('midpoint, foot, reflections, centres', () => {
    near(run(lang, 'midpoint', [pt('A'), pt('B')]).pos.get('D'), 2, 0);
    near(run(lang, 'foot', [pt('C'), pt('A'), pt('B')]).pos.get('D'), 1, 0);
    // images of a point are named after it
    near(run(lang, 'reflectLine', [pt('C'), pt('A'), pt('B')]).pos.get('C_1'), 1, -3);
    near(run(lang, 'reflectPoint', [pt('C'), pt('A')]).pos.get('C_1'), -1, -3);
    near(run(lang, 'centroid', [pt('A'), pt('B'), pt('C')]).pos.get('D'), 5 / 3, 1);
    near(run(lang, 'circumcenter', [pt('A'), pt('B'), pt('C')]).pos.get('D'), 2, 1 / 3 + 2 / 3);
    near(run(lang, 'orthocenter', [pt('A'), pt('B'), pt('C')]).pos.get('D'), 1, 1);
  });
  it('a line input can be a clicked side of a polygon', () => {
    // C's foot on the side AB, picked by clicking the polygon near (2, 0.05)
    near(run(lang, 'foot', [pt('C'), drawingClick('tkzDrawPolygon', 2, 0.05)]).pos.get('D'), 1, 0);
  });
  it('perpendicular, parallel and perpendicular bisector lines', () => {
    const perp = run(lang, 'perpendicular', [pt('C'), pt('A'), pt('B')]);
    const line = perp.graph.drawings.find((d) => d.d.cmd === 'tkzDrawLine')!;
    const [p, q] = line.d.groups[0]!.map((n) => perp.pos.get(n)!);
    expect(p!.x).toBeCloseTo(q!.x); // vertical through C
    const bis = run(lang, 'perpBisector', [pt('A'), pt('B')]);
    const l2 = bis.graph.drawings.find((d) => d.d.cmd === 'tkzDrawLine')!;
    const [m, n] = l2.d.groups[0]!.map((x) => bis.pos.get(x)!);
    expect(m!.x).toBeCloseTo(2);
    expect(n!.x).toBeCloseTo(2);
    const par = run(lang, 'parallel', [pt('C'), pt('A'), pt('B')]);
    const l3 = par.graph.drawings.find((d) => d.d.cmd === 'tkzDrawLine')!;
    const [u, v] = l3.d.groups[0]!.map((x) => par.pos.get(x)!);
    expect(u!.y).toBeCloseTo(v!.y); // horizontal through C
  });
  it('intersections: line–line, line–circle, circle–circle', () => {
    // AB (y = 0) and the vertical line through C and a new point D(1,-1) meet at E(1,0)
    near(run(lang, 'intersect', [pt('A'), pt('B'), pt('C'), at(1, -1)]).pos.get('E'), 1, 0);
    const lc = run(lang, 'intersect', [drawingClick('tkzDrawCircle', 4, 0.1), pt('C'), pt('B')]);
    const names = lc.graph.steps.find((s) => s.c.op === 'interLC')!.c.out;
    for (const n of names) {
      const p = lc.pos.get(n)!;
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(4); // on the circle (A, |AB|)
    }
  });
  it('circles: centre+point, through three points, incircle', () => {
    const c3 = run(lang, 'circle3', [pt('A'), pt('B'), pt('C')]);
    expect(c3.graph.drawings.filter((d) => d.d.cmd === 'tkzDrawCircle')).toHaveLength(2);
    const inc = run(lang, 'incircle', [pt('A'), pt('B'), pt('C')]);
    expect(inc.graph.drawings.filter((d) => d.d.cmd === 'tkzDrawCircle')).toHaveLength(2);
  });
  it('polygon: closes when the first point is clicked again', () => {
    const r = run(lang, 'polygon', [pt('A'), pt('B'), at(5, 5), pt('C'), pt('A')]);
    expect(r.graph.drawings.some((d) => d.d.cmd === 'tkzDrawPolygon' && d.d.groups[0]!.length === 4)).toBe(true);
    expect(r.last.finished).toBe(true);
  });
  it('marks', () => {
    const r = run(lang, 'rightAngle', [pt('C'), pt('A'), pt('B')]);
    expect(r.graph.drawings.some((d) => d.d.cmd === 'tkzMarkRightAngle')).toBe(true);
    const a = run(lang, 'angleMark', [pt('B'), pt('A'), pt('C')]);
    expect(a.graph.drawings.some((d) => d.d.cmd === 'tkzMarkAngle')).toBe(true);
  });
  it('reports points that come out undefined (parallel lines)', () => {
    const r = run(lang, 'intersect', [pt('A'), pt('B'), pt('C'), at(9, 3)]);
    expect(r.last.undefinedPoints).toEqual(['E']);
  });
  it('a line input rejects a click on a circle', () => {
    const s = initialState('foot');
    const g = compile(BASE[lang], lang).graph!;
    const circle = g.drawings.find((d) => d.d.cmd === 'tkzDrawCircle')!;
    const o1 = handlePick(s, pt('C'), BASE[lang], lang, false);
    const o2 = handlePick(o1.state, { kind: 'drawing', id: circle.id, at: { x: 4, y: 0 } }, BASE[lang], lang, false);
    expect(o2.rejected).toBe(true);
  });
});

describe('tool helpers', () => {
  it('every tool has inputs and builds valid code from points', () => {
    for (const t of TOOLS) {
      if (t.id === 'move') continue;
      const n = t.inputs === 'polygon' ? 3 : t.inputs.length;
      const clicks: Target[] = ['A', 'B', 'C'].slice(0, n).map(pt);
      if (t.inputs === 'polygon') clicks.push(pt('A'));
      for (const lang of ['tkz', 'asy'] as const) {
        // inputs of kind 'line' take two points each; 'circle' clicks the circle
        const expanded = t.inputs === 'polygon' ? clicks : t.inputs.flatMap((k, i): (Target | ((code: string) => Target))[] => (k === 'point' || k === 'object' ? [clicks[i] ?? pt('C')] : k === 'circle' ? [drawingClick('tkzDrawCircle', 4, 0)] : [pt('A'), pt('B')]));
        const r = run(lang, t.id, t.id === 'intersect' ? [pt('A'), pt('C'), pt('B'), pt('C')] : expanded);
        expect(r.last.finished, `${t.id} in ${lang}`).toBe(true);
      }
    }
  });
  it('clicking a polygon picks the nearest side; a circle picks the circle', () => {
    const g = compile(BASE.tkz).graph!;
    const pos = evaluate(g);
    const poly = g.drawings.find((d) => d.d.cmd === 'tkzDrawPolygon')!;
    expect(curveOfDrawing(g, pos, poly.id, { x: 0.4, y: 1.5 })).toMatchObject({ kind: 'line', a: 'C', b: 'A' });
    const circle = g.drawings.find((d) => d.d.cmd === 'tkzDrawCircle')!;
    expect(curveOfDrawing(g, pos, circle.id, { x: 0, y: 4 })).toMatchObject({ kind: 'circle', c: 'A', th: 'B' });
  });
  it('new names skip every word already used in the code', () => {
    const r = run('asy', 'midpoint', [pt('A'), pt('B')], 'pair A=(0,0), B=(2,0);\ncircle C = circle(A, 1);\n');
    expect(r.pos.get('D')).toBeTruthy();
    expect(r.text).toMatch(/^import olympiad;\nimport geometry;\n/);
  });
});
