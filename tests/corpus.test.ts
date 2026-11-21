// Real figures (tests/fixtures/corpus, or a whole Geometry-Everyday-Project checkout via GEP_DIR):
// they must load without errors, convert to the other language without moving any point, and —
// when the tools are installed — agree with real Asymptote / pdflatex + tkz-euclide.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { asyRegion } from '../src/asy/front';
import { asyNames, generateAsy } from '../src/codegen/asy';
import { generate, nameMap } from '../src/codegen/codegen';
import { evaluate } from '../src/geom/evaluate';
import { compile } from '../src/pipeline';

const fixtures = join(__dirname, 'fixtures', 'corpus');
const files: { name: string; text: string }[] = readdirSync(fixtures)
  .filter((f) => f.endsWith('.tex'))
  .map((f) => ({ name: f, text: readFileSync(join(fixtures, f), 'utf8') }));
const gep = process.env.GEP_DIR;
if (gep && existsSync(gep)) {
  for (const dir of ['Asymptote', 'Tikzlatex']) {
    for (const f of readdirSync(join(gep, dir)).filter((x) => x.endsWith('.tex'))) {
      files.push({ name: `${dir}/${f}`, text: readFileSync(join(gep, dir, f), 'utf8') });
    }
  }
}

const named = (g: NonNullable<ReturnType<typeof compile>['graph']>) => g.steps.flatMap((s) => s.c.out).filter((n) => !n.startsWith('~'));

describe('real figures', () => {
  it.each(files.map((f) => [f.name, f.text]))('%s loads, every point is defined, conversion keeps them', (_n, text) => {
    const r = compile(text);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const g = r.graph!;
    const pos = evaluate(g);
    expect(named(g).filter((n) => !pos.get(n))).toEqual([]);
    const to = r.lang === 'asy' ? 'tkz' : 'asy';
    const out = to === 'asy' ? generateAsy(g, { pos, precise: true }) : generate(g, { pos, precise: true });
    const r2 = compile(out);
    expect(r2.lang).toBe(to);
    expect(r2.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const names = to === 'asy' ? asyNames(g) : nameMap(g);
    const pos2 = evaluate(r2.graph!);
    for (const n of named(g)) {
      const p = pos.get(n)!;
      const q = pos2.get(names.get(n)!)!;
      expect(Math.hypot(p.x - q.x, p.y - q.y), n).toBeLessThan(1e-4);
    }
  });
});

const hasAsy = (() => {
  try {
    return spawnSync('asy', ['-version'], { stdio: 'pipe' }).status === 0;
  } catch {
    return false;
  }
})();
const hasLatex = (() => {
  try {
    execFileSync('kpsewhich', ['tkz-euclide.sty'], { stdio: 'pipe' });
    return spawnSync('pdflatex', ['--version'], { stdio: 'pipe' }).status === 0;
  } catch {
    return false;
  }
})();

/** Evan Chen's cse5 helpers, as defined in the asydef of azzam.sty. */
const CSE5 = `pair MP(Label s, pair A, pair B = plain.S, pen p = defaultpen) { Label L = s; L.s = "$"+s.s+"$"; label(L, A, B, p); return A; }
pair Drawing(Label s = "", pair A, pair B = plain.S, pen p = defaultpen) { dot(MP(s, A, B, p), p); return A; }
path Drawing(path g, pen p = defaultpen, arrowbar ar = None) { draw(g, p, ar); return g; }
`;

describe.skipIf(!hasAsy)('real figures agree with real Asymptote', () => {
  const asyFiles = files.filter((f) => compile(f.text).lang === 'asy');
  it.each(asyFiles.map((f) => [f.name, f.text]))('%s', (_n, text) => {
    const r = compile(text);
    const pos = evaluate(r.graph!);
    const names = named(r.graph!);
    if (!names.length) return; // GeoGebra exports: no named points
    const dir = mkdtempSync(join(tmpdir(), 'corpus-asy-'));
    copyFileSync(join(__dirname, 'asy', 'olympiad.asy'), join(dir, 'olympiad.asy'));
    const code = asyRegion(text).code;
    const prog =
      (/import\s+olympiad/.test(code) ? '' : 'import olympiad;\nimport geometry;\n') +
      (/\b(Drawing|MP)\(/.test(code) ? CSE5 : '') +
      code +
      '\n' +
      names.map((n) => `write("@@${n} ", (pair)${n});`).join('\n');
    writeFileSync(join(dir, 'fig.asy'), prog);
    const res = spawnSync('asy', ['-noV', '-f', 'pdf', 'fig.asy'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
    const real = new Map<string, [number, number]>();
    for (const l of `${res.stdout}\n${res.stderr}`.split('\n')) {
      const m = /^@@(\S+) \(([^,]+),([^)]+)\)/.exec(l);
      if (m) real.set(m[1]!, [Number(m[2]), Number(m[3])]);
    }
    for (const n of names) {
      const p = pos.get(n)!;
      const q = real.get(n);
      expect(q, `${n} (asy: ${res.stderr.slice(0, 200)})`).toBeTruthy();
      expect(Math.hypot(p.x - q![0], p.y - q![1]), n).toBeLessThan(1e-6);
    }
  }, 60_000);
});

describe.skipIf(!hasLatex)('real figures agree with pdflatex + tkz-euclide', () => {
  it('all TikZ / tkz-euclide figures in one document', () => {
    const tex = files.filter((f) => compile(f.text).lang === 'tkz');
    const dir = mkdtempSync(join(tmpdir(), 'corpus-tex-'));
    const metas = tex.map((f) => {
      const g = compile(f.text).graph!;
      return { f, g, names: named(g) };
    });
    const body = metas
      .map(({ f, names }, k) => {
        const writes = names.map((n, i) => `\\tkzGetPointCoord(${n}){tmp}\\immediate\\write\\coords{${k} ${i} \\tmpx\\space\\tmpy}`).join('\n');
        return f.text.replace(/\\end\{tikzpicture\}/, `${writes}\n\\end{tikzpicture}`);
      })
      .join('\n\\clearpage\n');
    writeFileSync(
      join(dir, 'c.tex'),
      `\\documentclass{article}\\usepackage{tkz-euclide}\\usepackage{amssymb}
\\usetikzlibrary{calc,angles,quotes,intersections,decorations.markings,arrows.meta}
\\newcommand{\\dg}{^\\circ}\\newcommand{\\siku}{}
\\newwrite\\coords\\immediate\\openout\\coords=\\jobname.coords
\\begin{document}\n${body}\n\\immediate\\closeout\\coords\\end{document}`,
    );
    spawnSync('pdflatex', ['-interaction=nonstopmode', 'c.tex'], { cwd: dir, stdio: 'pipe', timeout: 300_000 });
    const real = new Map<string, [number, number]>();
    for (const l of readFileSync(join(dir, 'c.coords'), 'utf8').split('\n')) {
      const m = /^(\d+) (\d+) (\S+) (\S+)$/.exec(l.trim());
      if (m) real.set(`${m[1]} ${m[2]}`, [Number(m[3]), Number(m[4])]);
    }
    const bad: string[] = [];
    metas.forEach(({ f, g, names }, k) => {
      const pos = evaluate(g);
      names.forEach((n, i) => {
        const p = pos.get(n)!;
        const q = real.get(`${k} ${i}`);
        if (!q || Math.hypot(p.x - q[0], p.y - q[1]) > 0.01) bad.push(`${f.name} ${n}: ours ${JSON.stringify(p)} TeX ${JSON.stringify(q)}`);
      });
    });
    expect(bad).toEqual([]);
  }, 600_000);
});
