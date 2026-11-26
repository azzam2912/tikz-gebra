// Asymptote front end: parsing, recognition of constructions, values, drawings, errors.

import { describe, expect, it } from 'vitest';
import { asyRegion, parseAsymptote } from '../src/asy/front';
import { evalNum } from '../src/asy/expr';
import { lex, parseExpression } from '../src/asy/parser';
import { evaluate } from '../src/geom/evaluate';
import type { Construction, DefStatement, DrawingSpec, DrawStatement, Literal } from '../src/parser/ast';
import { compile, detectLang } from '../src/pipeline';

const res = (src: string) => parseAsymptote(src);
const errors = (src: string) => res(src).diagnostics.filter((d) => d.severity === 'error');
const warnings = (src: string) => res(src).diagnostics.filter((d) => d.severity === 'warning');
const steps = (src: string): Construction[] => {
  const r = res(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.statements.filter((s): s is DefStatement => s.type === 'def').map((s) => s.c);
};
const step = (src: string, name: string) => steps(src).find((c) => c.out.includes(name));
const draws = (src: string): DrawingSpec[] =>
  res(src).statements.filter((s): s is DrawStatement => s.type === 'draw').map((s) => s.d);
const pos = (src: string) => {
  const r = compile(src, 'asy');
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return evaluate(r.graph!);
};
const ev = (text: string) => evalNum(parseExpression(lex(text, 0))!, new Map());

describe('language detection and code region', () => {
  it('detects Asymptote', () => {
    expect(detectLang('\\begin{center}\\begin{asy}\npair A=(0,0);\n\\end{asy}\\end{center}')).toBe('asy');
    expect(detectLang('import olympiad;\npair A = dir(90);')).toBe('asy');
    expect(detectLang('\\tkzDefPoint(0,0){A}')).toBe('tkz');
    expect(detectLang('\\draw (0,0) -- (1,1);')).toBe('tkz');
  });
  it('reads only the inside of \\begin{asy}…\\end{asy}', () => {
    const text = '\\begin{center}\n\\begin{asy}\npair A=(1,2);\n\\end{asy}\n\\end{center}';
    const r = asyRegion(text);
    expect(r.code.trim()).toBe('pair A=(1,2);');
    expect(text.slice(r.base, r.base + 3)).toBe('\npa');
  });
});

describe('expressions', () => {
  it('numbers, pairs, dir, compass directions, complex products, transforms', () => {
    expect(ev('2*3+1')).toBe(7);
    expect(ev('(1,2)+(3,4)')).toEqual({ x: 4, y: 6 });
    expect(ev('2(1,1)')).toEqual({ x: 2, y: 2 });
    const d = ev('dir(90)') as { x: number; y: number };
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(1);
    const ne = ev('NE') as { x: number; y: number };
    expect(ne.x).toBeCloseTo(Math.SQRT1_2);
    expect(ev('(0,1)*(0,1)')).toEqual({ x: -1, y: 0 });
    const r = ev('rotate(90,(1,0))*(2,0)') as { x: number; y: number };
    expect(r.x).toBeCloseTo(1);
    expect(r.y).toBeCloseTo(1);
    expect(ev('abs((3,4))')).toBe(5);
    expect(ev('1/0')).toBeNull();
  });
});

describe('points', () => {
  it('literal pairs and dir() are free points with editable numbers', () => {
    const src = 'pair A = (0.5, -2), B = dir(75), C = 2*dir(-30);';
    const st = res(src).statements as DefStatement[];
    expect(st.map((s) => s.c.op)).toEqual(['free', 'free', 'free']);
    const txt = (sp: { from: number; to: number }) => src.slice(sp.from, sp.to);
    const [a, b, c] = st.map((s) => s.lit!) as [Literal, Literal, Literal];
    expect(a.kind === 'xy' && [txt(a.xs[0]!), txt(a.ys[0]!)]).toEqual(['0.5', '-2']);
    expect(b.kind === 'angle' && [txt(b.spans[0]!), b.r]).toEqual(['75', 1]);
    expect(c.kind === 'angle' && [txt(c.spans[0]!), c.r]).toEqual(['-30', 2]);
    expect(st[1]!.c).toMatchObject({ polar: true });
  });
  it('declaration first, assignment later', () => {
    expect(steps('pair A, B; A = (1,0); B = dir(90);').map((c) => c.out[0])).toEqual(['A', 'B']);
  });
  it('recognises constructions', () => {
    const base = 'pair A=(0,0), B=(4,0), C=(1,3), I=(1,1), P=(2,2);';
    expect(step(`${base} pair X = foot(C, A, B);`, 'X')).toMatchObject({ op: 'projection', args: ['C', 'A', 'B'] });
    expect(step(`${base} pair X = extension(A, B, C, I);`, 'X')).toMatchObject({ op: 'interLL' });
    expect(step(`${base} pair X = midpoint(A--B);`, 'X')).toMatchObject({ op: 'midpoint', args: ['A', 'B'] });
    expect(step(`${base} pair X = (A+B)/2;`, 'X')).toMatchObject({ op: 'midpoint' });
    expect(step(`${base} pair X = 2*I - A;`, 'X')).toMatchObject({ op: 'symmetry', args: ['A', 'I'] });
    expect(step(`${base} pair X = B/4 + 3*A/4;`, 'X')).toMatchObject({ op: 'homothety', args: ['A', 'B'], k: 0.75 });
    expect(step(`${base} pair X = P + B - A;`, 'X')).toMatchObject({ op: 'translation', args: ['P', 'A', 'B'] });
    expect(step(`${base} pair X = A + (1,2);`, 'X')).toMatchObject({ op: 'shift', dx: 1, dy: 2 });
    expect(step(`${base} pair X = rotate(180, P)*C;`, 'X')).toMatchObject({ op: 'rotation', args: ['C', 'P'], angle: 180 });
    expect(step(`${base} pair X = reflect(A, B)*C;`, 'X')).toMatchObject({ op: 'reflection', args: ['C', 'A', 'B'] });
    expect(step(`${base} pair X = C + rotate(90)*(B - A);`, 'X')).toMatchObject({ op: 'orthLine', args: ['C', 'A', 'B'] });
    expect(step(`${base} pair X = C - rotate(90)*unit(I - C);`, 'X')).toMatchObject({ op: 'tangentAt', args: ['C', 'I'] });
    expect(step(`${base} pair X = incenter(A, B, C);`, 'X')).toMatchObject({ op: 'center', kind: 'in' });
    expect(step(`${base} pair X = circumcenter(triangle(A, B, C));`, 'X')).toMatchObject({ op: 'center', kind: 'circum' });
    // geometry.asy excenter(A,B,C) is opposite C = tkz [ex](A,C,B)
    expect(step(`${base} pair X = excenter(A, B, C);`, 'X')).toMatchObject({ op: 'center', kind: 'ex', args: ['A', 'C', 'B'] });
    expect(step(`${base} triangle t = triangle(A,B,C); point X = excenter(t.BC);`, 'X')).toMatchObject({ kind: 'ex', args: ['B', 'A', 'C'] });
    expect(step(`${base} pair X = interp(A, B, 0.25);`, 'X')).toMatchObject({ op: 'onLine', args: ['A', 'B'], t: 0.25 });
  });
  it('anything else becomes an expression step evaluated numerically', () => {
    const c = step('pair A=(0,0), B=(3,4); pair X = A + unit(B - A);', 'X');
    expect(c).toMatchObject({ op: 'expr', args: ['A', 'B'] });
    const p = pos('pair A=(0,0), B=(3,4); pair X = A + unit(B - A); pair H = A+B+(1,1);');
    expect(p.get('X')).toEqual({ x: 0.6, y: 0.8 });
    expect(p.get('H')).toEqual({ x: 4, y: 5 });
  });
  it('reals that depend on points', () => {
    const p = pos('pair A=(0,0), B=(3,4); real r = abs(B-A); pair X = A + (r, 0);');
    expect(p.get('X')).toEqual({ x: 5, y: 0 });
  });
  it('variables shadow compass names; using one before assignment is an error', () => {
    expect(pos('pair E = (2,3); pair F = E + (1,0);').get('F')).toEqual({ x: 3, y: 3 });
    expect(errors('pair E; pair F = E + (1,0);')[0]!.message).toMatch(/used before/);
  });
  it('reassigning a variable keeps the old point under another name', () => {
    const p = pos('pair A = (1,0); dot(A); A = (2,0); dot(A);');
    expect([...p.values()].filter((v) => v).length).toBe(2);
  });
});

describe('circles, lines and intersections', () => {
  it('geometry circles: intersection points by ascending y', () => {
    const src = 'pair A=(-3,1), B=(3,-1), O=(0,0); circle c = circle((point)O, 2); pair X[] = intersectionpoints(line(A,B), c); pair P = X[0], Q = X[1];';
    expect(step(src, 'P')).toMatchObject({ op: 'interLC', order: 'asy-y' });
    const p = pos(src);
    expect(p.get('P')!.y).toBeLessThan(p.get('Q')!.y);
  });
  it('paths: by angle on the circle (from 0°, counter-clockwise)', () => {
    const src = 'pair A=(-3,1), B=(3,-1), O=(0,0); pair[] X = intersectionpoints(line(A,B), Circle(O, 2)); pair P = X[0], Q = X[1];';
    expect(step(src, 'P')).toMatchObject({ order: 'asy-path1' });
    const p = pos(src);
    const ang = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) + 2 * Math.PI) % (2 * Math.PI);
    expect(ang(p.get('P')!)).toBeLessThan(ang(p.get('Q')!));
  });
  it('a segment first: along the segment', () => {
    const src = 'pair A=(-3,1), B=(3,-1), O=(0,0); pair P = intersectionpoints(B--A, Circle(O, 2))[0];';
    expect(step(src, 'P')).toMatchObject({ order: 'asy-path2' });
    expect(pos(src).get('P')!.x).toBeGreaterThan(0);
  });
  it('circle(A, abs(A-D)) goes through D; circle(A,B,C) is a circumcircle', () => {
    const src = 'pair A=(0,0), D=(1,1), B=(4,0); pair E = intersectionpoints(line(A,B), Circle(A, abs(A-D)))[0];';
    expect(step(src, 'E')).toMatchObject({ args: ['A', 'B', 'A', 'D'] });
    const c = steps('pair A=(0,0), B=(1,0), C=(0,1); circle k = circle(A, B, C); draw(k);');
    expect(c.pop()).toMatchObject({ op: 'center', kind: 'circum' });
  });
  it('intersectionpoint of two lines; perpendicular / parallel lines', () => {
    expect(step('pair A=(0,0),B=(1,0),C=(0,1),D=(1,1); pair X = intersectionpoint(line(A,D), line(B,C));', 'X')).toMatchObject({ op: 'interLL' });
    const p = pos('pair A=(0,0),B=(2,0),M=(1,3); line l = perpendicular(M, line(A,B)); pair X = intersectionpoint(l, line(A,B));');
    expect(p.get('X')!.x).toBeCloseTo(1);
    expect(p.get('X')!.y).toBeCloseTo(0);
  });
});

describe('drawings', () => {
  it('draw, filldraw, dot, label', () => {
    const d = draws('pair A=(0,0),B=(1,0),C=(0,1); draw(A--B--C--cycle, red+dashed); draw(A--B); draw(A--B--C); draw(line(A,B)); filldraw(circumcircle(A,B,C), invisible, blue); dot("$A$", A, NE); label("$x$", (A+B)/2, S); draw(rightanglemark(B,A,C));');
    expect(d.map((x) => x.cmd)).toEqual([
      'tkzDrawPolygon', 'tkzDrawSegment', 'tkzDrawPolySeg', 'tkzDrawLine', 'tkzFillCircle', 'tkzDrawCircle',
      'tkzDrawPoint', 'tkzLabelPoint', 'tkzLabelPoint', 'tkzMarkRightAngle',
    ]);
    expect(d[0]).toMatchObject({ options: 'red+dashed', src: 'asy' });
    expect(d[3]).toMatchObject({ infinite: true });
    expect(d[7]).toMatchObject({ text: '$A$', dir: { angle: 45, k: 1 } });
  });
  it('dir(A) as a label direction follows the point', () => {
    const d = draws('pair A=dir(30); dot("$A$", A, dir(A));');
    expect(d[1]!.dir).toEqual({ of: 'A', k: 1 });
  });
  it('dots of several points', () => {
    expect(draws('pair A=(0,0),B=(1,0); dot(A^^B);').map((x) => x.groups[0])).toEqual([['A'], ['B']]);
  });
  it('pens defined in the code', () => {
    const r = res('pen ccqqqq = rgb(0.8,0,0); pair A=(0,0),B=(1,1); draw(A--B, linewidth(0.8) + ccqqqq);');
    expect(r.colors).toEqual({ ccqqqq: 'pen:rgb(0.8,0,0)' });
  });
  it('cse5 helpers Drawing() and MP()', () => {
    const r = res('pair B = Drawing("B", (0,0), W); pair A = MP("A", (1,1), N); Drawing(A--B, red);');
    const d = r.statements.filter((s): s is DrawStatement => s.type === 'draw').map((s) => s.d);
    expect(d.map((x) => [x.cmd, x.text ?? '', x.groups[0]])).toEqual([
      ['tkzDrawPoint', '', ['B']],
      ['tkzLabelPoint', '$B$', ['B']],
      ['tkzLabelPoint', '$A$', ['A']],
      ['tkzDrawSegment', '', ['A', 'B']],
    ]);
  });
});

describe('errors and warnings', () => {
  it('syntax errors with line numbers, then it keeps going', () => {
    const r = res('pair A = (0,0)\npair B = (1,1);\ndraw(A--B);');
    expect(r.diagnostics[0]).toMatchObject({ severity: 'error', line: 2 });
  });
  it('unknown functions and names in definitions are errors', () => {
    expect(errors('pair A = (0,0); pair X = point(A--A, 0.5);')[0]!.message).toMatch(/"point" is not supported/);
    expect(errors('pair X = Q + (1,0);')[0]!.message).toMatch(/Unknown name "Q"/);
  });
  it('a drawing that cannot be followed is skipped with a warning', () => {
    const w = warnings('pair A=(0,0),B=(1,0); draw(ellipse(A, 1, 2)); draw(A--B);');
    expect(w[0]).toMatchObject({ code: 'ignored' });
    expect(w[0]!.message).toMatch(/not drawn/);
  });
  it('loops and function definitions are skipped with a warning', () => {
    expect(warnings('for (int i=0; i<3; ++i) { dot((i,0)); }')[0]!.message).toMatch(/"for" is not supported/);
    expect(warnings('void f(pair p) { dot(p); }')[0]!.message).toMatch(/function definitions/);
    expect(warnings('markSegment(A, B, 1);')[0]!.message).toMatch(/not drawn/);
  });
  it('index out of range', () => {
    expect(errors('pair A=(0,0),B=(1,0),C=(0,1); pair X = intersectionpoints(line(A,B), line(B,C))[1];')[0]!.message).toMatch(/out of range/);
  });
  it('setup calls are ignored silently', () => {
    expect(res('import olympiad; size(8cm); unitsize(1cm); defaultpen(fontsize(10pt)); real markscalefactor = 0.02;').diagnostics).toEqual([]);
  });
});
