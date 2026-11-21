import { describe, expect, it } from 'vitest';
import { compile } from '../src/pipeline';
import { evaluate } from '../src/geom/evaluate';
import { moveFreePoint } from '../src/graph/types';

describe('graph building', () => {
  it('builds a topologically ordered graph', () => {
    const r = compile('\\tkzDefPoints{0/0/A,4/0/B}\n\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}');
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.steps.map((s) => s.id)).toEqual(['A', 'B', 'M']);
    expect(r.graph!.producer.get('M')).toBe('M');
  });
  it('reports undefined references with line numbers', () => {
    const r = compile('\\tkzDefPoint(0,0){A}\n\\tkzDefMidPoint(A,Z) \\tkzGetPoint{M}\n\\tkzDrawPoints(A,Q)');
    expect(r.graph).toBeNull();
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [2, 'Undefined point Z'],
      [3, 'Undefined point Q'],
    ]);
  });
  it('reports redefinitions', () => {
    const r = compile('\\tkzDefPoint(0,0){A}\n\\tkzDefPoint(1,0){A}');
    expect(r.graph).toBeNull();
    expect(r.diagnostics[0]).toMatchObject({ line: 2, message: 'Point A is already defined on line 1' });
  });
  it('accepts forward references with a warning and reorders them', () => {
    const r = compile('\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}\n\\tkzDefPoints{0/0/A,2/0/B}');
    expect(r.graph!.steps.map((s) => s.id)).toEqual(['A', 'B', 'M']);
    expect(r.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(r.diagnostics).toHaveLength(2);
  });
  it('detects cycles', () => {
    const r = compile(
      '\\tkzDefPoint(0,0){A}\n\\tkzDefMidPoint(A,N) \\tkzGetPoint{M}\n\\tkzDefMidPoint(A,M) \\tkzGetPoint{N}',
    );
    expect(r.graph).toBeNull();
    const err = r.diagnostics.find((d) => d.severity === 'error')!;
    expect(err.message).toMatch(/Circular definition: (M → N|N → M)/);
  });
  it('detects self-reference', () => {
    const r = compile('\\tkzDefPoint(0,0){A}\n\\tkzDefMidPoint(A,M) \\tkzGetPoint{M}');
    expect(r.diagnostics.find((d) => d.severity === 'error')!.message).toMatch(/Circular definition: M/);
  });
});

describe('evaluation', () => {
  it('propagates undefined points instead of NaN', () => {
    const src = `\\tkzDefPoints{0/0/A, 1/0/B, 0/1/C, 1/1/D}
\\tkzInterLL(A,B)(C,D) \\tkzGetPoint{P}
\\tkzDefMidPoint(P,A) \\tkzGetPoint{M}`;
    const g = compile(src).graph!;
    const pos = evaluate(g);
    expect(pos.get('P')).toBeNull();
    expect(pos.get('M')).toBeNull();
    expect(pos.get('A')).toEqual({ x: 0, y: 0 });
  });
  it('re-evaluates after moving a free point', () => {
    const src = `\\tkzDefPoints{0/0/A, 1/0/B, 0/1/C, 1/1/D}
\\tkzInterLL(A,B)(C,D) \\tkzGetPoint{P}`;
    const g = moveFreePoint(compile(src).graph!, 'D', 1, 2);
    const p = evaluate(g).get('P')!;
    expect(p.x).toBeCloseTo(-1);
    expect(p.y).toBeCloseTo(0);
  });
});
