import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmt, fullDocument, generate } from '../src/codegen/codegen';
import { compile } from '../src/pipeline';
import { moveFreePoint, structure, type Graph } from '../src/graph/types';
import { generateAsy } from '../src/codegen/asy';
import { evaluate } from '../src/geom/evaluate';
import { nameMap } from '../src/codegen/codegen';
import { asyNames } from '../src/codegen/asy';

const examplesDir = join(__dirname, '..', 'examples');
const examples = readdirSync(examplesDir).filter((f) => f.endsWith('.tex'));

const graphOf = (src: string): Graph => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r.graph!;
};

const SAMPLES: Record<string, string> = {
  'every construction': `\\tkzDefPoints{0/0/A, 4/0/B, 1/3/C, -1/-1/D}
\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}
\\tkzDefPointBy[projection=onto A--B](C) \\tkzGetPoint{H}
\\tkzDefLine[orthogonal=through C](A,B) \\tkzGetPoint{c}
\\tkzDefLine[parallel=through C](A,B) \\tkzGetPoint{d}
\\tkzInterLL(A,C)(B,D) \\tkzGetPoint{P}
\\tkzInterLC(A,B)(C,A) \\tkzGetPoints{E}{F}
\\tkzInterCC(A,C)(B,C) \\tkzGetPoints{G}{G'}
\\tkzDefTriangleCenter[circum](A,B,C) \\tkzGetPoint{O}
\\tkzDefTriangleCenter[in](A,B,C) \\tkzGetPoint{I}
\\tkzDefTriangleCenter[centroid](A,B,C) \\tkzGetPoint{K}
\\tkzDefTriangleCenter[ortho](A,B,C) \\tkzGetPoint{H_1}
\\tkzDefTriangleCenter[ex](A,B,C) \\tkzGetPoint{J}
\\tkzDefTriangleCenter[euler](A,B,C) \\tkzGetPoint{N}
\\tkzDefPoint(75:2){R}
\\tkzDefPointBy[reflection=over A--B](C) \\tkzGetPoint{C'}
\\tkzDefPointBy[symmetry=center M](C) \\tkzGetPoint{C_2}
\\tkzDefPointBy[homothety=center A ratio 0.333333](B) \\tkzGetPoint{T}
\\tkzDefPointBy[rotation=center A angle -30](B) \\tkzGetPoint{U}
\\tkzDefPointBy[translation=from A to B](C) \\tkzGetPoint{V}
\\tkzDefShiftPoint[A](1.5,-2){W}
\\tkzDefShiftPoint[A](30:2){W'}
\\tkzDefLine[tangent at=A](O) \\tkzGetPoint{t}
\\tkzDefMidArc(O,A,B) \\tkzGetPoint{S}
\\tkzInterLC[common=A](A,B)(C,A) \\tkzGetFirstPoint{X}
\\tkzInterLC[near](A,B)(O,A) \\tkzGetPoints{Y}{Y'}
\\tkzInterCC(A,C)(B,C) \\tkzGetSecondPoint{Z}
\\tkzDefPointOnLine[pos=0.3](A,C) \\tkzGetPoint{L}
\\tkzDrawSegment(A,B)
\\tkzDrawSegments[dashed](A,C B,C)
\\tkzDrawLine(C,c)
\\tkzDrawPolygon(A,B,C)
\\tkzDrawCircle(O,A)
\\tkzLabelPoints[above right](A,B)
\\tkzDrawPoints(A,B,C,M,H)
\\tkzDrawPoint[fill=red](O)
\\tkzDrawPolySeg[blue](A,M,C)
\\tkzDrawCircles[dashed](O,A I,J)
\\tkzDrawLines(A,B C,c)
\\tkzFillPolygon[blue!20](A,B,C)
\\tkzFillCircle[red!10](O,A)
\\tkzMarkRightAngle(C,H,A)
\\tkzMarkAngle[size=0.5](B,A,C)
\\tkzMarkSegment(A,M)
\\tkzMarkSegments(A,M M,B)
\\tkzLabelPoint[below](M){$M_{AB}$}
\\tkzDrawArc[red](O,A)(B)
\\tkzDrawSemiCircle(M,A)
\\tkzDrawSector[fill=blue, fill opacity=0.3](A,B)(C)
\\tkzFillSector[green](B,C)(A)
\\tkzLabelAngle[dist=1.2](B,A,C){$\\alpha$}
`,
  'plain TikZ and colours': `\\definecolor{wewdxt}{rgb}{0.43,0.42,0.45}
\\coordinate[label=above:$A$] (A) at (0,3);
\\coordinate (B) at (-2,0);
\\coordinate (C) at (2.5,0);
\\coordinate (M) at ($(B)!0.5!(C)$);
\\draw[color=wewdxt, thick] (A)--(B)--(C)--cycle;
\\draw (A) -- (M);
\\draw (M) circle (1.5);
\\fill (A) circle (1pt);
\\node at (1,1) {$x$};
`,
  'forward references and messy formatting': `% comment
\\tkzDefMidPoint(A,B)
   \\tkzGetPoint{M}   % midpoint first
\\tkzLabelPoints(M)
\\tkzDefPoints{ 0.125/0/A ,  3.333/-2.5/B }
\\tkzDrawPoints[]( A , B , M )
`,
};

describe('round trip: parse(codegen(graph)) == graph', () => {
  for (const [name, src] of Object.entries(SAMPLES)) {
    it(name, () => {
      // coordinates are rounded to 2 decimals by codegen, so compare after one generation
      const g1 = graphOf(generate(graphOf(src)));
      const g2 = graphOf(generate(g1));
      expect(structure(g2)).toEqual(structure(g1));
      expect(generate(g2)).toBe(generate(g1));
    });
  }
  for (const file of examples) {
    it(`examples/${file}`, () => {
      const g = graphOf(readFileSync(join(examplesDir, file), 'utf8'));
      // examples only use 2-decimal coordinates; plain TikZ helper points get names on the first pass
      const g1 = graphOf(generate(g));
      expect(structure(graphOf(generate(g1)))).toEqual(structure(g1));
      expect(g1.steps.length).toBe(g.steps.length);
    });
  }
  it('after dragging a free point', () => {
    const g = moveFreePoint(graphOf(SAMPLES['every construction']!), 'C', 1.25, -2.5);
    expect(structure(graphOf(generate(g)))).toEqual(structure(g));
  });
});

describe('codegen format', () => {
  it('formats numbers with at most 2 decimals', () => {
    expect([fmt(1), fmt(1.5), fmt(1.256), fmt(-0.001), fmt(-2.1049), fmt(10)]).toEqual(['1', '1.5', '1.26', '0', '-2.1', '10']);
  });
  it('canonical order: definitions, drawings, labels', () => {
    const src = `\\tkzLabelPoints[above](M)
\\tkzDrawSegment(A,B)
\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}
\\tkzDefPoints{0/0/A, 4/0/B}`;
    expect(generate(graphOf(src))).toBe(`\\tkzDefPoint(0,0){A}
\\tkzDefPoint(4,0){B}
\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}

\\tkzDrawSegment(A,B)

\\tkzLabelPoints[above](M)
`);
  });
  it('wraps a full standalone document', () => {
    const doc = fullDocument('\\tkzDefPoint(0,0){A}\n');
    expect(doc).toBe(`\\documentclass[tikz,border=5pt]{standalone}
\\usepackage{tkz-euclide}
\\begin{document}
\\begin{tikzpicture}
  \\tkzDefPoint(0,0){A}
\\end{tikzpicture}
\\end{document}
`);
    // and the full document parses back to the same graph
    expect(structure(graphOf(doc))).toEqual(structure(graphOf('\\tkzDefPoint(0,0){A}')));
  });
});

const ASY_SAMPLE = `import olympiad;
import geometry;
pair A = dir(110), B = dir(210), C = (0.87, -0.5);
pair I = incenter(A, B, C), H = orthocenter(A, B, C), O = circumcenter(A, B, C);
pair D = foot(A, B, C), M = midpoint(B--C), K = (A+B)/2, P = 2*I - A;
pair Q = rotate(60, B)*C, R = reflect(A, B)*C, X = extension(A, D, B, I);
pair S = A + unit(B - A);
circle c = circle((point)O, abs(A - O));
pair Y[] = intersectionpoints(line(A, D), c);
pair Z = intersectionpoints(Circle(A, abs(D - A)), circumcircle(A, B, C))[1];
draw(A--B--C--cycle, blue);
draw(c, dashed);
draw(line(A, M));
filldraw(incircle(A, B, C), lightblue, red);
draw(rightanglemark(A, D, B));
dot("$A$", A, dir(A));
dot("$Y_1$", Y[1], SW);
label("$x$", (B + D)/2, S);
`;

describe('Asymptote round trip: parse(generateAsy(graph)) is stable', () => {
  it('sample', () => {
    const g0 = compile(ASY_SAMPLE, 'asy').graph!;
    const g1 = compile(generateAsy(g0, { pos: evaluate(g0) }), 'asy').graph!;
    const g2 = compile(generateAsy(g1, { pos: evaluate(g1) }), 'asy').graph!;
    expect(structure(g2)).toEqual(structure(g1));
  });
});

/** Positions of the named points survive a conversion to the other language. */
function convertsExactly(src: string) {
  const r = compile(src);
  const g = r.graph!;
  const pos = evaluate(g);
  const to = r.lang === 'asy' ? 'tkz' : 'asy';
  const text = to === 'asy' ? generateAsy(g, { pos, precise: true }) : generate(g, { pos, precise: true });
  const r2 = compile(text);
  expect(r2.lang).toBe(to);
  expect(r2.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const names = to === 'asy' ? asyNames(g) : nameMap(g);
  const pos2 = evaluate(r2.graph!);
  for (const s of g.steps) {
    for (const n of s.c.out) {
      if (n.startsWith('~') || !pos.get(n)) continue;
      const p = pos.get(n)!;
      const q = pos2.get(names.get(n)!);
      expect(q, n).toBeTruthy();
      expect(Math.hypot(p.x - q!.x, p.y - q!.y), n).toBeLessThan(1e-4);
    }
  }
}

describe('conversion keeps every point in place', () => {
  it('tkz-euclide → Asymptote (every construction)', () => convertsExactly(SAMPLES['every construction']!));
  it('plain TikZ → Asymptote', () => convertsExactly(SAMPLES['plain TikZ and colours']!));
  it('Asymptote → tkz-euclide', () => convertsExactly(ASY_SAMPLE));
  for (const file of examples) it(`examples/${file}`, () => convertsExactly(readFileSync(join(examplesDir, file), 'utf8')));
  it('examples/nine-point-circle.asy', () => convertsExactly(readFileSync(join(examplesDir, 'nine-point-circle.asy'), 'utf8')));
});
