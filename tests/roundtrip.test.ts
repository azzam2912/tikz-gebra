import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmt, fullDocument, generate } from '../src/codegen/codegen';
import { compile } from '../src/pipeline';
import { moveFreePoint, structure, type Graph } from '../src/graph/types';

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
\\tkzDrawSegment(A,B)
\\tkzDrawSegments[dashed](A,C B,C)
\\tkzDrawLine(C,c)
\\tkzDrawPolygon(A,B,C)
\\tkzDrawCircle(O,A)
\\tkzLabelPoints[above right](A,B)
\\tkzDrawPoints(A,B,C,M,H)
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
      // examples only use 2-decimal coordinates, so the very first round trip is exact
      expect(structure(graphOf(generate(g)))).toEqual(structure(g));
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
