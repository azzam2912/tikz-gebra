import { describe, expect, it } from 'vitest';
import { parse } from '../src/parser/parser';
import type { DefStatement, DrawStatement } from '../src/parser/ast';

const defs = (src: string) => {
  const r = parse(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.statements.filter((s): s is DefStatement => s.type === 'def').map((s) => s.c);
};
const draws = (src: string) => {
  const r = parse(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.statements.filter((s): s is DrawStatement => s.type === 'draw').map((s) => s.d);
};
const errors = (src: string) => parse(src).diagnostics.filter((d) => d.severity === 'error');

describe('free points', () => {
  it('\\tkzDefPoint', () => {
    expect(defs('\\tkzDefPoint(2,-1.5){A}')).toEqual([{ op: 'free', args: [], out: ['A'], x: 2, y: -1.5 }]);
  });
  it('accepts spaces inside the coordinates and before {name}', () => {
    expect(defs('\\tkzDefPoint( .5 , +3 ) {O\'}')).toEqual([{ op: 'free', args: [], out: ["O'"], x: 0.5, y: 3 }]);
  });
  it('\\tkzDefPoints', () => {
    expect(defs('\\tkzDefPoints{0/0/A, 4/0/B,\n 1.5/3/C}')).toEqual([
      { op: 'free', args: [], out: ['A'], x: 0, y: 0 },
      { op: 'free', args: [], out: ['B'], x: 4, y: 0 },
      { op: 'free', args: [], out: ['C'], x: 1.5, y: 3 },
    ]);
  });
  it('\\tkzDefPoints with comment lines inside', () => {
    expect(defs('\\tkzDefPoints{% x y name\n 0/0/A, % first\n 1/2/B}').map((c) => c.out[0])).toEqual(['A', 'B']);
  });
  it('rejects expressions', () => {
    expect(errors('\\tkzDefPoint(2*3,1){A}')[0]!.message).toMatch(/numeric/);
    expect(errors('\\tkzDefPoint(a:30){A}')[0]!.message).toMatch(/numeric/);
  });
  it('polar coordinates (angle:radius)', () => {
    const [c] = defs('\\tkzDefPoint(90:2){A}');
    expect(c).toMatchObject({ op: 'free', out: ['A'], polar: true });
    expect((c as { x: number }).x).toBeCloseTo(0);
    expect((c as { y: number }).y).toBeCloseTo(2);
  });
  it('records the spans of the numbers for in-place editing', () => {
    const src = '\\tkzDefPoint( 1.5 ,-2){A} \\tkzDefPoints{3/4/B} \\tkzDefPoint(75:1){C}';
    const lits = parse(src).statements.map((st) => (st as DefStatement).lit!);
    const txt = (sp: { from: number; to: number }) => src.slice(sp.from, sp.to);
    expect(lits[0]).toMatchObject({ kind: 'xy' });
    expect(lits.map((l) => (l.kind === 'xy' ? [txt(l.xs[0]!), txt(l.ys[0]!)] : [txt(l.spans[0]!), l.kind === 'angle' ? l.r : null]))).toEqual([
      ['1.5', '-2'],
      ['3', '4'],
      ['75', 1],
    ]);
  });
  it('rejects malformed \\tkzDefPoints item', () => {
    expect(errors('\\tkzDefPoints{0/0}')[0]!.message).toMatch(/x\/y\/name/);
  });
  it('rejects invalid names', () => {
    expect(errors('\\tkzDefPoint(0,0){A-B}')[0]!.message).toMatch(/Invalid point name/);
  });
});

describe('constructions', () => {
  it('\\tkzDefMidPoint', () => {
    expect(defs('\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}')).toEqual([{ op: 'midpoint', args: ['A', 'B'], out: ['M'] }]);
  });
  it('\\tkzDefPointBy[projection]', () => {
    expect(defs('\\tkzDefPointBy[projection=onto A--B](C) \\tkzGetPoint{H}')).toEqual([
      { op: 'projection', args: ['C', 'A', 'B'], out: ['H'] },
    ]);
  });
  it('\\tkzDefLine[orthogonal]', () => {
    expect(defs('\\tkzDefLine[orthogonal=through C](A,B) \\tkzGetPoint{c}')).toEqual([
      { op: 'orthLine', args: ['C', 'A', 'B'], out: ['c'] },
    ]);
  });
  it('\\tkzDefLine[perpendicular] is an alias of orthogonal', () => {
    expect(defs('\\tkzDefLine[perpendicular=through C](A,B)\\tkzGetPoint{c}')[0]!.op).toBe('orthLine');
  });
  it('\\tkzDefLine[parallel]', () => {
    expect(defs('\\tkzDefLine[parallel=through C](A,B) \\tkzGetPoint{c}')).toEqual([
      { op: 'parLine', args: ['C', 'A', 'B'], out: ['c'] },
    ]);
  });
  it('\\tkzInterLL', () => {
    expect(defs('\\tkzInterLL(A,B)(C,D) \\tkzGetPoint{P}')).toEqual([
      { op: 'interLL', args: ['A', 'B', 'C', 'D'], out: ['P'] },
    ]);
  });
  it('\\tkzInterLC', () => {
    expect(defs('\\tkzInterLC(A,B)(O,C)\n  \\tkzGetPoints{P}{Q}')).toEqual([
      { op: 'interLC', args: ['A', 'B', 'O', 'C'], out: ['P', 'Q'] },
    ]);
  });
  it('\\tkzInterCC', () => {
    expect(defs("\\tkzInterCC(O,A)(O',B) \\tkzGetPoints{P}{Q}")).toEqual([
      { op: 'interCC', args: ['O', 'A', "O'", 'B'], out: ['P', 'Q'] },
    ]);
  });
  it.each(['circum', 'in', 'centroid', 'ortho'] as const)('\\tkzDefTriangleCenter[%s]', (kind) => {
    expect(defs(`\\tkzDefTriangleCenter[${kind}](A,B,C) \\tkzGetPoint{X}`)).toEqual([
      { op: 'center', kind, args: ['A', 'B', 'C'], out: ['X'] },
    ]);
  });
  it('\\tkzDefTriangleCenter without option defaults to circum (tkz-euclide default)', () => {
    expect(defs('\\tkzDefTriangleCenter(A,B,C) \\tkzGetPoint{O}')[0]).toMatchObject({ kind: 'circum' });
  });
});

describe('construction errors', () => {
  it('missing \\tkzGetPoint', () => {
    const e = errors('\\tkzDefMidPoint(A,B)\n\\tkzDrawPoints(A)');
    expect(e).toHaveLength(1);
    expect(e[0]!.message).toMatch(/must be followed by \\tkzGetPoint\{M\}/);
    expect(e[0]!.line).toBe(1);
    // the following drawing is still parsed
    expect(parse('\\tkzDefMidPoint(A,B)\n\\tkzDrawPoints(A)').statements).toHaveLength(1);
  });
  it('\\tkzGetPoint after a two-point command', () => {
    expect(errors('\\tkzInterCC(O,A)(P,B) \\tkzGetPoint{X}')[0]!.message).toMatch(/two points.*\\tkzGetPoints/);
  });
  it('\\tkzGetPoints after a one-point command', () => {
    expect(errors('\\tkzInterLL(A,B)(C,D) \\tkzGetPoints{X}{Y}')[0]!.message).toMatch(/one point/);
  });
  it('\\tkzGetFirstPoint / \\tkzGetSecondPoint name one of the two points', () => {
    const [a] = defs('\\tkzInterLC(A,B)(O,C) \\tkzGetFirstPoint{X}');
    expect(a!.out[0]).toBe('X');
    expect(a!.out[1]).toMatch(/^~/);
    const [b] = defs('\\tkzInterCC(O,A)(P,B) \\tkzGetSecondPoint{Y}');
    expect(b!.out[1]).toBe('Y');
    expect(b!.out[0]).toMatch(/^~/);
  });
  it('\\tkzGetFirstPoint after a one-point command', () => {
    expect(errors('\\tkzInterLL(A,B)(C,D) \\tkzGetFirstPoint{X}')[0]!.message).toMatch(/one point/);
  });
  it('stray \\tkzGetPoint', () => {
    expect(errors('\\tkzGetPoint{M}')[0]!.message).toMatch(/must directly follow/);
  });
  it('same name twice in \\tkzGetPoints', () => {
    expect(errors('\\tkzInterCC(O,A)(P,B) \\tkzGetPoints{X}{X}')[0]!.message).toMatch(/Both/);
  });
  it('space between ")(" is rejected like LaTeX would', () => {
    expect(errors('\\tkzInterLL(A,B) (C,D) \\tkzGetPoint{P}')[0]!.message).toMatch(/No space/);
  });
  it('space between "](" is rejected', () => {
    expect(errors('\\tkzDefLine[parallel=through C] (A,B) \\tkzGetPoint{c}')[0]!.message).toMatch(/No space/);
  });
  it('unsupported options', () => {
    expect(errors('\\tkzDefPointBy[inversion=center O through A](B) \\tkzGetPoint{C}')[0]!.message).toMatch(/projection/);
    expect(errors('\\tkzDefPointBy[homothety=center O ratio k](A) \\tkzGetPoint{B}')[0]!.message).toMatch(/number or a fraction/);
    expect(errors('\\tkzDefLine[mediator](A,B) \\tkzGetPoints{P}{Q}')[0]!.message).toMatch(/orthogonal/);
    expect(errors('\\tkzInterLC[R](A,B)(O,2) \\tkzGetPoints{P}{Q}')[0]!.message).toMatch(/not supported/);
    expect(errors('\\tkzDefTriangleCenter[nagel](A,B,C) \\tkzGetPoint{N}')[0]!.message).toMatch(/Unsupported triangle center/);
    expect(errors('\\tkzInterCC[near](A,B)(C,D) \\tkzGetPoints{P}{Q}')[0]!.message).toMatch(/not supported/);
  });
  it('wrong number of points', () => {
    expect(errors('\\tkzDefMidPoint(A,B,C) \\tkzGetPoint{M}')[0]!.message).toMatch(/expects 2 points/);
    expect(errors('\\tkzInterLL(A,B)(C) \\tkzGetPoint{M}')[0]!.message).toMatch(/expects 2 points/);
  });
  it('unclosed group', () => {
    expect(errors('\\tkzDefMidPoint(A,B \\tkzGetPoint{M}')[0]!.message).toMatch(/Unclosed/);
  });
});

describe('drawings', () => {
  it('\\tkzDrawSegment', () => {
    expect(draws('\\tkzDrawSegment(A,B)')).toEqual([{ cmd: 'tkzDrawSegment', options: null, groups: [['A', 'B']] }]);
  });
  it('\\tkzDrawSegments', () => {
    expect(draws('\\tkzDrawSegments[dashed](A,B B,C  C,A)')).toEqual([
      { cmd: 'tkzDrawSegments', options: 'dashed', groups: [['A', 'B'], ['B', 'C'], ['C', 'A']] },
    ]);
  });
  it('\\tkzDrawSegments rejects spaces inside a pair', () => {
    expect(errors('\\tkzDrawSegments(A, B)')[0]!.message).toMatch(/space-separated pairs/);
  });
  it('\\tkzDrawLine', () => {
    expect(draws('\\tkzDrawLine(A,B)')).toEqual([{ cmd: 'tkzDrawLine', options: null, groups: [['A', 'B']] }]);
  });
  it('\\tkzDrawPolygon', () => {
    expect(draws('\\tkzDrawPolygon(A,B,C,D)')).toEqual([
      { cmd: 'tkzDrawPolygon', options: null, groups: [['A', 'B', 'C', 'D']] },
    ]);
  });
  it('\\tkzDrawCircle', () => {
    expect(draws('\\tkzDrawCircle(O,A)')).toEqual([{ cmd: 'tkzDrawCircle', options: null, groups: [['O', 'A']] }]);
    expect(errors('\\tkzDrawCircle(O,A,B)')[0]!.message).toMatch(/expects 2 points/);
  });
  it('\\tkzDrawPoints', () => {
    expect(draws('\\tkzDrawPoints(A, B ,C)')).toEqual([
      { cmd: 'tkzDrawPoints', options: null, groups: [['A', 'B', 'C']] },
    ]);
  });
  it('\\tkzLabelPoints with options', () => {
    expect(draws('\\tkzLabelPoints[above right](A,B)')).toEqual([
      { cmd: 'tkzLabelPoints', options: 'above right', groups: [['A', 'B']] },
    ]);
  });
});

describe('document handling', () => {
  it('ignores comments', () => {
    expect(defs('% a comment \\tkzFoo\n\\tkzDefPoint(0,0){A} % trailing')).toHaveLength(1);
  });
  it('accepts a full standalone document', () => {
    const src = `\\documentclass[tikz,border=5pt]{standalone}
\\usepackage{tkz-euclide}
\\begin{document}
\\begin{tikzpicture}
  \\tkzDefPoint(0,0){A}
\\end{tikzpicture}
\\end{document}`;
    expect(defs(src)).toHaveLength(1);
  });
  it('warns about tikzpicture options', () => {
    const r = parse('\\begin{tikzpicture}[rotate=30]\\end{tikzpicture}');
    expect(r.diagnostics).toMatchObject([{ severity: 'warning' }]);
    // a uniform scale changes nothing in the preview
    expect(parse('\\begin{tikzpicture}[scale=2]\\end{tikzpicture}').diagnostics).toEqual([]);
  });
  it('skips unknown commands with a warning (line number) and keeps going', () => {
    const r = parse('\\tkzDefPoint(0,0){A}\n\\tkzFooBar[size=1](A,B,C)\n\\tkzDefPoint(1,0){B}');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', line: 2, code: 'ignored' });
    expect(r.diagnostics[0]!.message).toMatch(/\\tkzFooBar.*ignored/);
    expect(r.statements).toHaveLength(2);
  });
  it('reports \\def and \\foreach ranges as unsupported', () => {
    expect(errors('\\foreach \\i in {1,...,5}{\\tkzDefPoint(\\i,0){A}}')[0]!.message).toMatch(/\\foreach/);
    expect(errors('\\foreach \\i [count=\\k] in {A}{}')[0]!.message).toMatch(/\\foreach/);
    expect(errors('\\def\\x{2}')[0]!.message).toMatch(/\\def/);
  });
  it('reports stray text', () => {
    expect(errors('hello')[0]!.message).toMatch(/Unexpected text/);
  });
  it('records spans for hover mapping', () => {
    const src = 'X\n\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}';
    const st = parse(src).statements[0] as DefStatement;
    expect(src.slice(st.span.from, st.span.to)).toBe('\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}');
    expect(st.argSpans.map((s) => src.slice(s.from, s.to))).toEqual(['A', 'B']);
    expect(st.outSpans.map((s) => src.slice(s.from, s.to))).toEqual(['M']);
  });
});
