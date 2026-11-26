// Cross-check the preview engine against REAL tkz-euclide.
//
// Builds one LaTeX document containing many constructions (the examples plus
// seeded random configurations), compiles it with pdflatex, reads every point's
// coordinates back via \tkzGetPointCoord and compares them with evaluate().
// Skipped automatically when pdflatex / tkz-euclide are not installed.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmt } from '../src/codegen/codegen';
import { evaluate } from '../src/geom/evaluate';
import { dist, type Vec } from '../src/geom/vec';
import { compile } from '../src/pipeline';

function hasLatex(): boolean {
  try {
    execFileSync('kpsewhich', ['tkz-euclide.sty'], { stdio: 'pipe' });
    return spawnSync('pdflatex', ['--version'], { stdio: 'pipe' }).status === 0;
  } catch {
    return false;
  }
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case {
  title: string;
  code: string;
}

const pt = (r: () => number, name: string, span = 6): string =>
  `\\tkzDefPoint(${fmt((r() * 2 - 1) * span)},${fmt((r() * 2 - 1) * span)}){${name}}`;

/** Random cases for every construction; degenerate / near-tangent ones are filtered out later. */
function randomCases(n: number): Case[] {
  const r = rng(20261121);
  const cases: Case[] = [];
  for (let i = 0; i < n; i++) {
    const pts = ['A', 'B', 'C', 'D'].map((p) => pt(r, p)).join('\n');
    cases.push({ title: `random #${i} — interLC`, code: `${pts}\n\\tkzInterLC(A,B)(C,D) \\tkzGetPoints{P}{Q}` });
    cases.push({ title: `random #${i} — interCC`, code: `${pts}\n\\tkzInterCC(A,B)(C,D) \\tkzGetPoints{P}{Q}` });
    cases.push({
      title: `random #${i} — lines & centres`,
      code: `${pts}
\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}
\\tkzDefPointBy[projection=onto A--B](C) \\tkzGetPoint{H}
\\tkzDefLine[orthogonal=through C](A,B) \\tkzGetPoint{c}
\\tkzDefLine[parallel=through C](A,B) \\tkzGetPoint{d}
\\tkzInterLL(A,B)(C,D) \\tkzGetPoint{I}
\\tkzDefTriangleCenter[circum](A,B,C) \\tkzGetPoint{O}
\\tkzDefTriangleCenter[in](A,B,C) \\tkzGetPoint{J}
\\tkzDefTriangleCenter[centroid](A,B,C) \\tkzGetPoint{G}
\\tkzDefTriangleCenter[ortho](A,B,C) \\tkzGetPoint{K}`,
    });
    const angle = fmt(r() * 360 - 180);
    const radius = fmt(1 + r() * 4);
    cases.push({
      title: `random #${i} — transformations & more`,
      code: `${pts}
\\tkzDefPoint(${angle}:${radius}){E}
\\tkzDefPointBy[reflection=over A--B](C) \\tkzGetPoint{R1}
\\tkzDefPointBy[symmetry=center A](C) \\tkzGetPoint{R2}
\\tkzDefPointBy[homothety=center A ratio 0.37](C) \\tkzGetPoint{R3}
\\tkzDefPointBy[rotation=center B angle 47](C) \\tkzGetPoint{R4}
\\tkzDefPointBy[translation=from A to B](C) \\tkzGetPoint{R5}
\\tkzDefShiftPoint[A](1.3,-0.7){R6}
\\tkzDefShiftPoint[B](40:1.5){R7}
\\tkzDefLine[tangent at=C](A) \\tkzGetPoint{R8}
\\tkzDefMidArc(A,B,C) \\tkzGetPoint{R9}
\\tkzDefTriangleCenter[ex](A,B,C) \\tkzGetPoint{R10}
\\tkzDefTriangleCenter[euler](A,B,C) \\tkzGetPoint{R11}
\\tkzInCenter(A,B,C)\\tkzGetPoint{R12}
\\tkzCircumCenter(A,B,C)\\tkzGetPoint{R13}
\\tkzExCenter(A,B,C)\\tkzGetPoint{R14}
\\tkzDefPointOnLine[pos=${fmt(r() * 3 - 1)}](A,B) \\tkzGetPoint{R15}
\\tkzDefPointOnLine[pos=0.25](C,D) \\tkzGetPoint{R16}`,
    });
    cases.push({
      title: `random #${i} — common / near / first / second`,
      code: `${pts}
\\tkzInterLC[common=C](C,D)(A,C) \\tkzGetFirstPoint{P}
\\tkzInterCC[common=C](A,C)(B,C) \\tkzGetFirstPoint{Q}
\\tkzInterLC[near](A,B)(C,D) \\tkzGetPoints{S}{T}
\\tkzInterCC(A,C)(B,D) \\tkzGetSecondPoint{U}`,
    });
  }
  return cases;
}

/** Reject configurations that are degenerate or numerically fragile in TeX's fixed-point arithmetic. */
function robust(code: string): boolean {
  const g = compile(code).graph;
  if (!g) return false;
  const pos = evaluate(g);
  if ([...pos.values()].some((p) => p === null || Math.abs(p.x) > 60 || Math.abs(p.y) > 60)) return false;
  const P = (n: string) => pos.get(n) as Vec;
  const A = P('A');
  const B = P('B');
  const C = P('C');
  const D = P('D');
  if (dist(A, B) < 1 || dist(C, D) < 1 || dist(A, C) < 1 || dist(B, C) < 1) return false;
  if (code.includes('R13')) {
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x));
    return area >= 4 && dist(A, C) > 1 && dist(B, C) > 1;
  }
  if (code.includes('common=')) {
    // the second intersection must be clearly apart from the common point
    const near = (n: string, m: string) => dist(P(n), P(m)) < 0.5;
    if (near('P', 'C') || near('Q', 'C')) return false;
    if (dist(P('S'), P('T')) < 0.5 || ['S', 'T', 'U'].some((n) => Math.abs(P(n).x) > 40)) return false;
    // [near]: the two candidates must be at clearly different distances from A
    if (Math.abs(dist(P('S'), A) - dist(P('T'), A)) < 0.3) return false;
    return dist(A, B) > 1 && dist(C, D) > 1;
  }
  if (code.includes('InterLC') || code.includes('InterCC')) {
    const pq = dist(P('P'), P('Q'));
    if (pq < 0.5) return false; // near-tangent: TeX's sqrt/acos lose precision
  }
  if (code.includes('InterLC')) {
    // keep the centre clearly off the line (the "through the centre" case is tested separately)
    const u = { x: (B.x - A.x) / dist(A, B), y: (B.y - A.y) / dist(A, B) };
    const off = Math.abs(u.x * (C.y - A.y) - u.y * (C.x - A.x));
    if (off < 0.2) return false;
  }
  if (code.includes('InterLL')) {
    const cross = (B.x - A.x) * (D.y - C.y) - (B.y - A.y) * (D.x - C.x);
    if (Math.abs(cross) / (dist(A, B) * dist(C, D)) < 0.2) return false; // nearly parallel
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x));
    if (area < 4) return false; // flat triangles make centres ill-conditioned
  }
  return true;
}

function runLatex(cases: Case[]): Map<string, Vec>[] {
  const dir = mkdtempSync(join(tmpdir(), 'tkzcheck-'));
  const body = cases
    .map((c, k) => {
      const g = compile(c.code).graph!;
      const names = g.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~'));
      const writes = names
        .map((n, i) => `\\tkzGetPointCoord(${n}){tmp}\\immediate\\write\\coords{${k} ${i} \\tmpx\\space\\tmpy}`)
        .join('\n');
      return `\\begin{tikzpicture}\n${c.code}\n${writes}\n\\end{tikzpicture}\n`;
    })
    .join('\n');
  const doc = `\\documentclass{article}
\\usepackage{tkz-euclide}
\\newwrite\\coords
\\immediate\\openout\\coords=\\jobname.coords
\\begin{document}
${body}
\\immediate\\closeout\\coords
\\end{document}
`;
  writeFileSync(join(dir, 'check.tex'), doc);
  spawnSync('pdflatex', ['-interaction=nonstopmode', 'check.tex'], { cwd: dir, stdio: 'pipe', timeout: 240_000 });
  const out: Map<string, Vec>[] = cases.map(() => new Map());
  const coordsFile = readdirSync(dir).find((f) => f.endsWith('.coords'));
  if (!coordsFile) throw new Error(`pdflatex produced no coordinates; see ${dir}/check.log`);
  for (const line of readFileSync(join(dir, coordsFile), 'utf8').split('\n')) {
    const m = /^(\d+) (\d+) (\S+) (\S+)$/.exec(line.trim());
    if (!m) continue;
    const k = Number(m[1]);
    const g = compile(cases[k]!.code).graph!;
    const name = g.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~'))[Number(m[2])]!;
    out[k]!.set(name, { x: Number(m[3]), y: Number(m[4]) });
  }
  return out;
}

const examplesDir = join(__dirname, '..', 'examples');

describe.skipIf(!hasLatex())('agreement with real tkz-euclide (pdflatex)', () => {
  it(
    'examples and random constructions match LaTeX, including intersection order',
    () => {
      const cases: Case[] = [
        ...readdirSync(examplesDir)
          .filter((f) => f.endsWith('.tex'))
          .map((f) => ({ title: `examples/${f}`, code: readFileSync(join(examplesDir, f), 'utf8') })),
        ...randomCases(150).filter((c) => robust(c.code)),
      ];
      expect(cases.length).toBeGreaterThan(400);
      // every kind of random case must really be compared
      for (const kind of ['interLC', 'interCC', 'lines & centres', 'transformations & more', 'common / near / first / second']) {
        expect(cases.filter((c) => c.title.endsWith(kind)).length, kind).toBeGreaterThan(40);
      }
      const latex = runLatex(cases);
      const failures: string[] = [];
      let worst = 0;
      cases.forEach((c, k) => {
        const ours = evaluate(compile(c.code).graph!);
        for (const [name, p] of ours) {
          if (!p || name.startsWith('~')) continue;
          const q = latex[k]!.get(name);
          if (!q) {
            failures.push(`${c.title}: LaTeX gave no value for ${name}`);
            continue;
          }
          const d = dist(p, q);
          worst = Math.max(worst, d);
          if (d > 0.01) {
            failures.push(
              `${c.title}: ${name} ours (${p.x.toFixed(4)}, ${p.y.toFixed(4)}) vs LaTeX (${q.x.toFixed(4)}, ${q.y.toFixed(4)})\n${c.code}`,
            );
          }
        }
      });
      console.log(`compared ${cases.length} constructions with pdflatex; worst deviation ${worst.toFixed(5)} cm`);
      expect(failures).toEqual([]);
    },
    300_000,
  );

  it('the drawing commands of the tools and the properties panel compile without errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tkzdraw-'));
    const body = `\\tkzDefPoints{0/0/O, 3/0/A, 1/2/B, -2/1/C, 4/3/D}
\\tkzDefPointOnLine[pos=0.4](A,D) \\tkzGetPoint{G}
\\tkzDefPointBy[rotation=center O angle 37.5](A) \\tkzGetPoint{K}
\\tkzDefMidPoint(O,D) \\tkzGetPoint{q1}
\\tkzInterCC(O,A)(q1,O) \\tkzGetPoints{T}{T_1}
\\tkzDrawArc[color=red, thick](O,A)(B)
\\tkzDrawSemiCircle[dashed](O,A)
\\tkzDrawSector[fill=blue, fill opacity=0.3](O,A)(C)
\\tkzFillSector[color=green, opacity=0.2](O,B)(C)
\\tkzDrawPolygon[color=teal, densely dotted, fill=orange, fill opacity=0.3](O,A,D)
\\tkzDrawLines(D,T D,T_1)
\\tkzMarkAngle[arc=ll, size=0.8, color=violet](A,O,B)
\\tkzLabelAngle[dist=1.15](A,O,B){$\\alpha$}
\\tkzMarkSegment[mark=||](O,A)
\\tkzMarkSegment[mark=|||](A,D)
\\tkzMarkSegments[mark=|](O,B O,C)
\\tkzLabelPoint[above left](G){$G$}
\\tkzLabelPoints[below right](O,A)`;
    expect(compile(body).diagnostics).toEqual([]);
    writeFileSync(join(dir, 'd.tex'), `\\documentclass{standalone}\n\\usepackage{tkz-euclide}\n\\begin{document}\n\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}\n\\end{document}\n`);
    spawnSync('pdflatex', ['-interaction=nonstopmode', 'd.tex'], { cwd: dir, stdio: 'pipe', timeout: 120_000 });
    const log = readFileSync(join(dir, 'd.log'), 'utf8');
    expect(log.split('\n').filter((l) => l.startsWith('!'))).toEqual([]);
  }, 120_000);

  it(
    '\\tkzInterLC with the line through the centre (documented assumption)',
    () => {
      const cases: Case[] = [
        { title: 'horizontal', code: '\\tkzDefPoints{-3/0/A, 3/0/B, 0/0/O, 0/2/C}\n\\tkzInterLC(A,B)(O,C) \\tkzGetPoints{P}{Q}' },
        { title: 'reversed', code: '\\tkzDefPoints{3/0/A, -3/0/B, 0/0/O, 0/2/C}\n\\tkzInterLC(A,B)(O,C) \\tkzGetPoints{P}{Q}' },
        { title: 'diagonal', code: '\\tkzDefPoints{-1/-1/A, 4/4/B, 1/1/O, 3/1/C}\n\\tkzInterLC(A,B)(O,C) \\tkzGetPoints{P}{Q}' },
        { title: 'steep', code: '\\tkzDefPoints{1/-3/A, 2/5/B, 1.5/1/O, 2.5/1/C}\n\\tkzInterLC(A,B)(O,C) \\tkzGetPoints{P}{Q}' },
      ];
      const latex = runLatex(cases);
      cases.forEach((c, k) => {
        const ours = evaluate(compile(c.code).graph!);
        for (const n of ['P', 'Q']) expect(dist(ours.get(n)!, latex[k]!.get(n)!), `${c.title} ${n}`).toBeLessThan(0.01);
      });
    },
    120_000,
  );
});
