// Cross-check the Asymptote front end and the Asymptote code generator against REAL Asymptote.
//
// Random figures are written in Asymptote, run through `asy` (with olympiad.asy from tests/asy/)
// and through our interpreter; every named point must agree, including which intersection point
// is [0] and which is [1]. The tkz-euclide → Asymptote converter is checked the same way.
// Skipped automatically when `asy` is not installed.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asyNames, generateAsy } from '../src/codegen/asy';
import { fmt } from '../src/codegen/codegen';
import { evaluate } from '../src/geom/evaluate';
import { compile } from '../src/pipeline';
import { handlePick, initialState, TOOLS, type Target } from '../src/ui/tools';

function hasAsy(): boolean {
  try {
    return spawnSync('asy', ['-version'], { stdio: 'pipe' }).status === 0;
  } catch {
    return false;
  }
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run Asymptote code and read back `names` (variable names in the code). */
function runAsy(dir: string, code: string, names: string[]): Map<string, { x: number; y: number }> {
  const prog = code + '\n' + names.map((n) => `write("@@${n} ", (pair)${n});`).join('\n') + '\n';
  writeFileSync(join(dir, 'fig.asy'), prog);
  const r = spawnSync('asy', ['-noV', '-f', 'pdf', 'fig.asy'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const out = new Map<string, { x: number; y: number }>();
  for (const l of `${r.stdout}\n${r.stderr}`.split('\n')) {
    const m = /^@@(\S+) \(([^,]+),([^)]+)\)/.exec(l);
    if (m) out.set(m[1]!, { x: Number(m[2]), y: Number(m[3]) });
  }
  if (out.size === 0) throw new Error(`asy failed:\n${r.stderr}\n${prog}`);
  return out;
}

const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'asycheck-'));
  copyFileSync(join(__dirname, 'asy', 'olympiad.asy'), join(dir, 'olympiad.asy'));
  return dir;
};

function randomFigure(r: () => number): string {
  const p = () => `(${fmt(r() * 6 - 3)}, ${fmt(r() * 6 - 3)})`;
  const a = () => fmt(r() * 360);
  return `import olympiad;
import geometry;
pair A = dir(${a()}), B = dir(${a()}), C = dir(${a()});
pair P = ${p()}, Q = ${p()};
pair I = incenter(A, B, C), O = circumcenter(A, B, C), H = orthocenter(A, B, C), G = centroid(A, B, C);
pair J = excenter(A, B, C), D = foot(P, A, B), M = midpoint(B--C), K = (A + P)/2, S = 2*I - P;
pair T = B/4 + 3*Q/4, U = rotate(${a()}, P)*Q, V = reflect(A, B)*P, W = extension(A, P, B, Q);
pair X = A + rotate(90)*(B - C), Y = P + Q - A, Z = A + unit(P - A), R = interp(P, Q, 0.3);
triangle t = triangle(A, B, C);
pair E = excenter(t.BC);
circle c = circle((point)O, abs(A - O));
pair L1[] = intersectionpoints(line(P, Q), circle((point)P, 1.7));
pair L2[] = intersectionpoints(c, circle((point)A, 1.1));
pair L3[] = intersectionpoints(line(P, I), Circle(I, 2.3));
pair L4[] = intersectionpoints(circumcircle(A, B, C), Circle(B, 0.9));
pair L5[] = intersectionpoints(Q--(Q + 7*unit(I - Q)), Circle(I, 1.9));
pair F0 = L1[0], F1 = L1[1], F2 = L2[0], F3 = L2[1], F4 = L3[0], F5 = L3[1], F6 = L4[0], F7 = L4[1];
pair F8 = L5[0];
pair R2 = interp(P, Q, ${fmt(r() * 3 - 1)}), U2 = rotate(-${a()}, P)*Q;
draw(arc(O, A, B), red); draw(O--arc(O, B, C)--cycle); fill(I--arc(I, P, Q)--cycle, blue+opacity(0.2)); draw(arc(P, 1.5, 20, 200));
`;
}

describe.skipIf(!hasAsy())('agreement with real Asymptote', () => {
  it(
    'random figures: constructions and intersection order',
    () => {
      const r = rng(20261122);
      const dir = workdir();
      const failures: string[] = [];
      let compared = 0;
      for (let k = 0; k < 40; k++) {
        const code = randomFigure(r);
        const res = compile(code, 'asy');
        if (!res.graph) {
          failures.push(`#${k}: ${res.diagnostics.map((d) => d.message).join('; ')}`);
          continue;
        }
        const pos = evaluate(res.graph);
        const names = res.graph.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~') && pos.get(n));
        // a configuration where an intersection is (nearly) tangent or missing is skipped
        if (['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'].some((n) => !names.includes(n))) continue;
        const real = runAsy(dir, code, names);
        for (const n of names) {
          const p = pos.get(n)!;
          const q = real.get(n);
          compared++;
          if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-3) failures.push(`#${k} ${n}: ours ${JSON.stringify(p)} asy ${JSON.stringify(q)}`);
        }
      }
      expect(compared).toBeGreaterThan(300);
      expect(failures).toEqual([]);
    },
    300_000,
  );

  it(
    'tkz-euclide → Asymptote conversion runs in Asymptote with the same points',
    () => {
      const dir = workdir();
      const r = rng(7);
      const failures: string[] = [];
      for (let k = 0; k < 15; k++) {
        const pts = ['A', 'B', 'C', 'D'].map((n) => `\\tkzDefPoint(${fmt(r() * 8 - 4)},${fmt(r() * 8 - 4)}){${n}}`).join('\n');
        const src = `${pts}
\\tkzDefPoint(${fmt(r() * 360)}:2){E}
\\tkzDefMidPoint(A,B)\\tkzGetPoint{M}
\\tkzDefPointBy[projection=onto A--B](C)\\tkzGetPoint{H}
\\tkzDefPointBy[reflection=over A--B](C)\\tkzGetPoint{R}
\\tkzDefPointBy[rotation=center A angle 35](B)\\tkzGetPoint{Rt}
\\tkzDefPointBy[homothety=center A ratio 0.4](C)\\tkzGetPoint{Ho}
\\tkzDefLine[orthogonal=through C](A,B)\\tkzGetPoint{c}
\\tkzDefLine[tangent at=C](A)\\tkzGetPoint{t}
\\tkzDefMidArc(A,B,C)\\tkzGetPoint{Ma}
\\tkzDefTriangleCenter[ex](A,B,C)\\tkzGetPoint{J}
\\tkzDefTriangleCenter[euler](A,B,C)\\tkzGetPoint{N}
\\tkzInterLC(A,B)(C,D)\\tkzGetPoints{P}{Q}
\\tkzInterCC(A,C)(B,D)\\tkzGetPoints{S}{T}
\\tkzDefPointOnLine[pos=1.3](A,B)\\tkzGetPoint{Ol}
\\tkzDrawArc[red](A,B)(C)
\\tkzDrawSemiCircle(A,C)
\\tkzDrawSector[fill=blue, fill opacity=0.3](B,A)(C)
\\tkzFillSector[green](C,A)(B)
\\tkzMarkAngle(B,A,C)
\\tkzLabelAngle[dist=1.2](B,A,C){$\\alpha$}`;
        const res = compile(src);
        const pos = evaluate(res.graph!);
        if ([...pos.values()].some((v) => !v)) continue;
        const code = generateAsy(res.graph!, { pos, precise: true });
        const names = asyNames(res.graph!);
        const named = res.graph!.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~'));
        const real = runAsy(dir, code, named.map((n) => names.get(n)!));
        for (const n of named) {
          const p = pos.get(n)!;
          const q = real.get(names.get(n)!);
          if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-3) failures.push(`#${k} ${n}: tkz ${JSON.stringify(p)} asy ${JSON.stringify(q)}`);
        }
      }
      expect(failures).toEqual([]);
    },
    300_000,
  );

  it('code written by every construction tool runs in Asymptote with the same points', () => {
    let code = 'pair A = (0, 0), B = (4, 0), C = (1, 3);\ndraw(A--B--C--cycle);\ndraw(circle(A, abs(B - A)));\n';
    const pt = (name: string): Target => ({ kind: 'point', name });
    // the drawing that is the circle (A, |AB|) / the triangle, in the current code
    const drawing = (cmd: string, at: { x: number; y: number }) => (): Target => {
      const g = compile(code, 'asy').graph!;
      return { kind: 'drawing', id: g.drawings.find((d) => d.d.cmd === cmd)!.id, at, tol: 0.2 };
    };
    const runs: { tool: (typeof TOOLS)[number]['id']; clicks: (Target | (() => Target))[] }[] = [];
    for (const t of TOOLS) {
      if (t.id === 'move') continue;
      const clicks: (Target | (() => Target))[] =
        t.inputs === 'polygon'
          ? [pt('A'), pt('B'), { kind: 'empty', at: { x: 3, y: 4 } }, pt('A')]
          : t.id === 'intersect'
            ? [pt('A'), pt('C'), pt('B'), pt('C')]
            : t.id === 'tangent'
              ? [pt('B'), drawing('tkzDrawCircle', { x: 0, y: 4 })]
              : t.inputs.flatMap((k, i): (Target | (() => Target))[] => (k === 'point' || k === 'object' ? [pt('ABC'[i]!)] : k === 'circle' ? [drawing('tkzDrawCircle', { x: 0, y: 4 })] : [pt('A'), pt('B')]));
      runs.push({ tool: t.id, clicks });
    }
    // gliders, a crossing, a tangent from outside, transformed objects
    runs.push({ tool: 'point', clicks: [drawing('tkzDrawCircle', { x: -2.8, y: 2.9 })] });
    runs.push({ tool: 'point', clicks: [drawing('tkzDrawPolygon', { x: 2.5, y: 1.5 })] });
    runs.push({ tool: 'point', clicks: [drawing('tkzDrawPolygon', { x: 1.5, y: 3.6 })] });
    runs.push({ tool: 'tangent', clicks: [{ kind: 'empty', at: { x: 6, y: 1 } }, drawing('tkzDrawCircle', { x: 0, y: -4 })] });
    runs.push({ tool: 'rotate', clicks: [drawing('tkzDrawPolygon', { x: 2, y: 0 }), pt('C')] });
    runs.push({ tool: 'reflectLine', clicks: [drawing('tkzDrawCircle', { x: 0, y: -4 }), pt('B'), pt('C')] });
    for (const { tool, clicks } of runs) {
      let s = initialState(tool);
      for (const c0 of clicks) {
        const c = typeof c0 === 'function' ? c0() : c0;
        const o = handlePick(s, c, code, 'asy', false);
        s = o.state;
        if (o.text !== undefined) code = o.text;
      }
    }
    const res = compile(code, 'asy');
    expect(res.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const pos = evaluate(res.graph!);
    const names = res.graph!.steps.flatMap((st) => st.c.out).filter((n) => !n.startsWith('~') && pos.get(n));
    expect(names.length).toBeGreaterThanOrEqual(20);
    const real = runAsy(workdir(), code, names);
    for (const n of names) expect(Math.hypot(pos.get(n)!.x - real.get(n)!.x, pos.get(n)!.y - real.get(n)!.y), n).toBeLessThan(1e-6);
  }, 60_000);

  it('the Asymptote example', () => {
    const code = readFileSync(join(__dirname, '..', 'examples', 'nine-point-circle.asy'), 'utf8');
    const res = compile(code, 'asy');
    const pos = evaluate(res.graph!);
    const names = res.graph!.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~'));
    const real = runAsy(workdir(), code, names);
    for (const n of names) expect(Math.hypot(pos.get(n)!.x - real.get(n)!.x, pos.get(n)!.y - real.get(n)!.y), n).toBeLessThan(1e-6);
  }, 60_000);
});
