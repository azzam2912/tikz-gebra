// Parser tests for the commands added after the MVP: more tkz-euclide constructions and
// drawings, and the plain TikZ subset (\coordinate, \draw, \node, \fill, \pic, \foreach).

import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/parser';
import type { Construction, DefStatement, DrawingSpec, DrawStatement } from '../src/parser/ast';
import { compile } from '../src/pipeline';
import { evaluate } from '../src/geom/evaluate';

const defs = (src: string): Construction[] => {
  const r = parse(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.statements.filter((s): s is DefStatement => s.type === 'def').map((s) => s.c);
};
const draws = (src: string): DrawingSpec[] => {
  const r = parse(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.statements.filter((s): s is DrawStatement => s.type === 'draw').map((s) => s.d);
};
const errors = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'error');
const warnings = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'warning');
const at = (src: string, name: string) => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return evaluate(r.graph!).get(name)!;
};

describe('\\tkzDefPointBy transformations', () => {
  it.each([
    ['reflection=over A--B', { op: 'reflection', args: ['P', 'A', 'B'] }],
    ['reflection = over A--B', { op: 'reflection', args: ['P', 'A', 'B'] }],
    ['symmetry=center I', { op: 'symmetry', args: ['P', 'I'] }],
    ['homothety=center A ratio 0.25', { op: 'homothety', args: ['P', 'A'], k: 0.25 }],
    ['homothety=center A ratio 1/3', { op: 'homothety', args: ['P', 'A'], k: 1 / 3 }],
    ['homothety=center A ratio -2', { op: 'homothety', args: ['P', 'A'], k: -2 }],
    ['rotation=center C angle -105', { op: 'rotation', args: ['P', 'C'], angle: -105 }],
    ['translation=from A to B', { op: 'translation', args: ['P', 'A', 'B'] }],
  ])('[%s]', (opt, expected) => {
    expect(defs(`\\tkzDefPointBy[${opt}](P)\\tkzGetPoint{X}`)[0]).toMatchObject({ ...expected, out: ['X'] });
  });
  it('geometry of each transformation', () => {
    const base = '\\tkzDefPoints{0/0/A, 2/0/B, 1/1/P}';
    const p = (opt: string) => at(`${base}\\tkzDefPointBy[${opt}](P)\\tkzGetPoint{X}`, 'X');
    expect(p('reflection=over A--B')).toEqual({ x: 1, y: -1 });
    expect(p('symmetry=center A')).toEqual({ x: -1, y: -1 });
    expect(p('homothety=center A ratio 3')).toEqual({ x: 3, y: 3 });
    expect(p('translation=from A to B')).toEqual({ x: 3, y: 1 });
    const r = p('rotation=center A angle 90');
    expect(r.x).toBeCloseTo(-1);
    expect(r.y).toBeCloseTo(1);
  });
  it('errors', () => {
    expect(errors('\\tkzDefPointBy[symmetry=center A-B](P)\\tkzGetPoint{X}')[0]!.message).toMatch(/Invalid point name/);
    expect(errors('\\tkzDefPointBy[rotation=center O angle sin(30)](P)\\tkzGetPoint{X}')[0]!.message).toMatch(/number or a fraction/);
    expect(errors('\\tkzDefPointBy[translation=from A](P)\\tkzGetPoint{X}')[0]!.message).toMatch(/supports/);
  });
});

describe('more constructions', () => {
  it('\\tkzDefLine[tangent at=C](O)', () => {
    expect(defs('\\tkzDefLine[tangent at=C](O)\\tkzGetPoint{t}')).toEqual([{ op: 'tangentAt', args: ['C', 'O'], out: ['t'] }]);
    expect(errors('\\tkzDefLine[tangent at=C](O,A)\\tkzGetPoint{t}')[0]!.message).toMatch(/expects 1 point/);
  });
  it('\\tkzDefMidArc(O,A,B)', () => {
    expect(defs('\\tkzDefMidArc(O,A,B)\\tkzGetPoint{M}')).toEqual([{ op: 'midArc', args: ['O', 'A', 'B'], out: ['M'] }]);
    const m = at('\\tkzDefPoints{0/0/O, 1/0/A, 0/1/B}\\tkzDefMidArc(O,A,B)\\tkzGetPoint{M}', 'M');
    expect(m.x).toBeCloseTo(Math.SQRT1_2);
    expect(m.y).toBeCloseTo(Math.SQRT1_2);
  });
  it('\\tkzDefShiftPoint', () => {
    expect(defs('\\tkzDefShiftPoint[A](1,-2){B}')).toEqual([{ op: 'shift', args: ['A'], out: ['B'], dx: 1, dy: -2 }]);
    expect(defs('\\tkzDefShiftPoint[A](90:2){B}')[0]).toMatchObject({ op: 'shift', polar: true });
  });
  it('triangle centre shortcuts and new kinds', () => {
    expect(defs('\\tkzCircumCenter(A,B,C)\\tkzGetPoint{O}')[0]).toMatchObject({ op: 'center', kind: 'circum' });
    expect(defs('\\tkzDefCircumCenter(A,B,C)\\tkzGetPoint{O}')[0]).toMatchObject({ kind: 'circum' });
    expect(defs('\\tkzInCenter(A,B,C)\\tkzGetPoint{I}')[0]).toMatchObject({ kind: 'in' });
    expect(defs('\\tkzDefTriangleCenter[ex](A,B,C)\\tkzGetPoint{J}')[0]).toMatchObject({ kind: 'ex' });
    expect(defs('\\tkzDefTriangleCenter[euler](A,B,C)\\tkzGetPoint{N}')[0]).toMatchObject({ kind: 'euler' });
    expect(errors('\\tkzInCenter(A,B)\\tkzGetPoint{I}')[0]!.message).toMatch(/expects 3 points/);
  });
  it('excenter is opposite the middle vertex (tkz-euclide)', () => {
    // A(0,0) B(4,0) C(0,4): the excircle opposite B touches side AC (x = 0) from the outside
    const j = at('\\tkzDefPoints{0/0/A, 4/0/B, 0/4/C}\\tkzDefTriangleCenter[ex](A,B,C)\\tkzGetPoint{J}', 'J');
    expect(j.x).toBeCloseTo(-2 * Math.SQRT2);
    expect(j.y).toBeCloseTo(2 * Math.SQRT2);
  });
  it('\\tkzInterLC[common=X] puts X second', () => {
    const src = '\\tkzDefPoints{-3/0/A, 3/0/B, 0/0/O}\\tkzDefPoint(2,0){C}';
    const plain = at(`${src}\\tkzInterLC(A,B)(O,C)\\tkzGetPoints{P}{Q}`, 'P');
    expect(plain.x).toBeCloseTo(-2);
    expect(at(`${src}\\tkzInterLC[common=C](A,B)(O,C)\\tkzGetFirstPoint{P}`, 'P').x).toBeCloseTo(-2);
    const src2 = '\\tkzDefPoints{-3/0/A, 3/0/B, 0/0/O, -2/0/C}';
    expect(at(`${src2}\\tkzInterLC[common=C](A,B)(O,C)\\tkzGetFirstPoint{P}`, 'P').x).toBeCloseTo(2);
    expect(defs(`${src2}\\tkzInterLC[common=C](A,B)(O,C)\\tkzGetFirstPoint{P}`).pop()).toMatchObject({ order: 'common', args: ['A', 'B', 'O', 'C', 'C'] });
  });
  it('\\tkzInterLC[near]: the first point is the one nearer to A', () => {
    const src = '\\tkzDefPoints{3/1/A, 4/1/B, 0/0/O, 2/0/C}\\tkzInterLC[near](A,B)(O,C)\\tkzGetPoints{P}{Q}';
    expect(at(src, 'P').x).toBeGreaterThan(at(src, 'Q').x);
  });
});

describe('more drawings', () => {
  it('\\tkzDrawPoint, \\tkzDrawPolySeg, \\tkzDrawCircles, \\tkzDrawLines, fills', () => {
    expect(draws('\\tkzDrawPoint[fill=black](A)')).toEqual([{ cmd: 'tkzDrawPoint', options: 'fill=black', groups: [['A']] }]);
    expect(draws('\\tkzDrawPolySeg(A,B,C)')[0]).toMatchObject({ cmd: 'tkzDrawPolySeg', groups: [['A', 'B', 'C']] });
    expect(draws('\\tkzDrawCircles[red](O,A O\',B)')[0]).toMatchObject({ cmd: 'tkzDrawCircles', groups: [['O', 'A'], ["O'", 'B']] });
    expect(draws('\\tkzDrawLines(A,B C,D)')[0]).toMatchObject({ groups: [['A', 'B'], ['C', 'D']] });
    expect(draws('\\tkzFillPolygon[blue!20](A,B,C)')[0]).toMatchObject({ cmd: 'tkzFillPolygon', options: 'blue!20' });
    expect(errors('\\tkzDrawPoint(A,B)')[0]!.message).toMatch(/expects 1 point/);
  });
  it('\\tkzLabelPoint with its own text', () => {
    expect(draws('\\tkzLabelPoint[below right](A){$A_1$}')).toEqual([
      { cmd: 'tkzLabelPoint', options: 'below right', groups: [['A']], text: '$A_1$' },
    ]);
    expect(errors('\\tkzLabelPoint(A)')[0]!.message).toMatch(/Expected "\{"/);
  });
  it('marks', () => {
    expect(draws('\\tkzMarkRightAngle[size=.2](A,B,C)')[0]).toMatchObject({ cmd: 'tkzMarkRightAngle', groups: [['A', 'B', 'C']] });
    expect(draws('\\tkzMarkAngle(A,B,C)')[0]).toMatchObject({ cmd: 'tkzMarkAngle' });
    expect(draws('\\tkzMarkSegments[mark=|](A,B C,D)')[0]).toMatchObject({ cmd: 'tkzMarkSegments', groups: [['A', 'B'], ['C', 'D']] });
    expect(errors('\\tkzMarkRightAngle(A,B)')[0]!.message).toMatch(/expects 3 points/);
  });
  it('commands that are kept but not drawn give a warning', () => {
    expect(warnings('\\tkzLabelSegment[above](A,B){$a$}')[0]).toMatchObject({ code: 'ignored' });
  });
});

describe('plain TikZ', () => {
  it('\\coordinate (A) at (x,y) is a draggable free point; label= adds a label', () => {
    const r = parse('\\coordinate[label=above right:$A$] (A) at (5,5);');
    const [st, lab] = r.statements;
    expect((st as DefStatement).c).toMatchObject({ op: 'free', out: ['A'], x: 5, y: 5 });
    expect((st as DefStatement).lit).toBeTruthy();
    expect((lab as DrawStatement).d).toMatchObject({ cmd: 'tkzLabelPoint', options: 'above right', text: '$A$', groups: [['A']] });
  });
  it('\\coordinate with calc', () => {
    expect(defs('\\coordinate (M) at ($(A)!0.5!(B)$);')).toEqual([{ op: 'midpoint', args: ['A', 'B'], out: ['M'] }]);
    expect(defs('\\coordinate (K) at ($(A)!0.25!(B)$);')).toEqual([{ op: 'homothety', args: ['B', 'A'], out: ['K'], k: 0.25 }]);
    expect(defs('\\coordinate (H) at ($(A)!(C)!(B)$);')).toEqual([{ op: 'projection', args: ['C', 'A', 'B'], out: ['H'] }]);
    expect(defs('\\coordinate (D) at ($(A)+(1,2)$);')).toEqual([{ op: 'shift', args: ['A'], out: ['D'], dx: 1, dy: 2 }]);
    expect(defs('\\coordinate (P) at (intersection of A--B and C--D);')).toEqual([{ op: 'interLL', args: ['A', 'B', 'C', 'D'], out: ['P'] }]);
    expect(errors('\\coordinate (P) at ($(A)*2$);')[0]!.message).toMatch(/calc/);
  });
  it('\\draw paths: segments, polylines, polygons, circles', () => {
    const d = draws('\\draw[thick] (A)--(B)--(C)--cycle; \\draw (A) -- (B); \\draw (A)--(B)--(C); \\draw[red] (O) circle (2cm);');
    expect(d.map((x) => x.cmd)).toEqual(['tkzDrawPolygon', 'tkzDrawSegment', 'tkzDrawPolySeg', 'tkzDrawCircle']);
    expect(d[0]).toMatchObject({ options: 'thick', groups: [['A', 'B', 'C']], src: 'tikz' });
  });
  it('a circle with a radius goes through a helper point at the right distance', () => {
    const p = compile('\\coordinate (O) at (1,1); \\draw (O) circle (2.5);');
    const g = p.graph!;
    const circle = g.drawings[0]!.d;
    const pos = evaluate(g);
    const [c, t] = circle.groups[0]!.map((n) => pos.get(n)!);
    expect(Math.hypot(t!.x - c!.x, t!.y - c!.y)).toBeCloseTo(2.5);
  });
  it('numeric coordinates become shared free points (GeoGebra exports)', () => {
    const src = '\\draw (0.,0.)-- (3.,0.); \\draw (3.,0.) -- (0,4); \\fill (3.,0.) circle (0.85pt);';
    const r = parse(src);
    const free = r.statements.filter((s): s is DefStatement => s.type === 'def');
    expect(free).toHaveLength(3);
    const shared = free.find((f) => f.c.op === 'free' && f.c.x === 3)!;
    expect(shared.lit?.kind === 'xy' && shared.lit.xs.length).toBe(3);
    const dot = r.statements.filter((s): s is DrawStatement => s.type === 'draw').pop()!;
    expect(dot.d.cmd).toBe('tkzDrawPoint');
  });
  it('nodes are labels', () => {
    expect(draws('\\node at (A) {$A$};')).toEqual([{ cmd: 'tkzLabelPoint', options: null, groups: [['A']], text: '$A$', src: 'tikz' }]);
    expect(draws('\\draw[color=red] (1,2) node {$C$};')[0]).toMatchObject({ cmd: 'tkzLabelPoint', options: 'color=red', text: '$C$' });
    expect(draws('\\draw (A) -- (B) node[above] {$x$};').map((d) => d.cmd)).toEqual(['tkzLabelPoint', 'tkzDrawSegment']);
  });
  it('\\pic angles', () => {
    expect(draws('\\pic [draw=red, angle radius=20pt] {angle = F--A--D};')[0]).toMatchObject({ cmd: 'tkzMarkAngle', groups: [['F', 'A', 'D']] });
    expect(draws('\\pic {right angle = A--B--C};')[0]).toMatchObject({ cmd: 'tkzMarkRightAngle' });
    expect(warnings('\\pic {myangle = A--B--C};')[0]).toMatchObject({ code: 'ignored' });
  });
  it('\\definecolor', () => {
    expect(parse('\\definecolor{wewdxt}{rgb}{0.43,0.42,0.45}').colors).toEqual({ wewdxt: 'rgb(110,107,115)' });
    expect(parse('\\definecolor{c}{HTML}{FF0000}').colors).toEqual({ c: '#FF0000' });
    expect(warnings('\\definecolor{c}{cmyk}{0,1,1,0}')[0]!.message).toMatch(/not supported/);
  });
  it('pgfmath in radii', () => {
    const g = compile('\\coordinate (O) at (0,0); \\draw (O) circle ({sqrt(13)/2});').graph!;
    const pos = evaluate(g);
    const [c, t] = g.drawings[0]!.d.groups[0]!.map((n) => pos.get(n)!);
    expect(Math.hypot(t!.x - c!.x, t!.y - c!.y)).toBeCloseTo(Math.sqrt(13) / 2);
  });
  it('\\foreach over a list of points', () => {
    const d = draws('\\foreach \\s in {A,B,C} \\filldraw (\\s) circle (1.5pt);');
    expect(d.map((x) => x.groups[0])).toEqual([['A'], ['B'], ['C']]);
    expect(draws('\\foreach \\p in {A, B}{\\tkzDrawPoint(\\p)}').map((x) => x.groups[0])).toEqual([['A'], ['B']]);
  });
  it('errors and warnings', () => {
    expect(errors('\\draw (A) -- (B)')[0]!.message).toMatch(/Missing ";"/);
    expect(errors('\\draw (A) .. controls (B) .. (C);')).toEqual([]);
    expect(warnings('\\draw (A) .. controls (B) .. (C);')[0]).toMatchObject({ code: 'ignored' });
    expect(warnings('\\draw[shift={(1,0)}] (A) -- (B);')[0]).toMatchObject({ code: 'ignored' });
    expect(errors('\\draw (A) -- (1,2,3);')[0]!.message).toMatch(/Unsupported coordinate/);
    expect(errors('\\coordinate A at (1,2);')[0]!.message).toMatch(/\\coordinate \(name\)/);
  });
  it('\\begin{asy} in TeX mode points at the language switch', () => {
    expect(errors('\\begin{asy}\\end{asy}')[0]!.message).toMatch(/Asymptote/);
  });
});
