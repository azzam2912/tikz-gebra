import { describe, expect, it } from 'vitest';
import { asyStyle, styleToAsyPen, styleToTikz, tikzStyle, xcolor } from '../src/style';
import { applyEdits, moveEdits } from '../src/ui/literal';
import { labelDirOf, labelsOf, pointHandles, shapesOf, texRuns } from '../src/ui/shapes';
import { compile } from '../src/pipeline';
import { evaluate } from '../src/geom/evaluate';
import type { DefStatement } from '../src/parser/ast';
import { parse } from '../src/parser/parser';
import { parseAsymptote } from '../src/asy/front';

describe('styles', () => {
  it('xcolor names and mixes', () => {
    expect(xcolor('red')).toBe('rgb(255,0,0)');
    expect(xcolor('blue!20')).toBe('rgb(204,204,255)');
    expect(xcolor('green!60!black')).toBe('rgb(0,153,0)');
    expect(xcolor('mine', { mine: 'rgb(1,2,3)' })).toBe('rgb(1,2,3)');
    expect(xcolor('nosuchcolor')).toBeNull();
  });
  it('TikZ options', () => {
    expect(tikzStyle('red, dashed, thick')).toEqual({ color: 'rgb(255,0,0)', dash: [3, 3], width: 0.8 });
    expect(tikzStyle('line width=1pt,color=wewdxt', { wewdxt: 'rgb(110,109,115)' })).toEqual({ width: 1, color: 'rgb(110,109,115)' });
    expect(tikzStyle('fill=blue!20, draw=none')).toMatchObject({ noStroke: true, fill: 'rgb(204,204,255)' });
    expect(tikzStyle('size=3, mark=|')).toEqual({});
  });
  it('Asymptote pens', () => {
    expect(asyStyle('grey+dashed')).toEqual({ color: 'rgb(128,128,128)', dash: [4, 4] });
    expect(asyStyle('linewidth(0.8) + ccqqqq', { ccqqqq: 'pen:rgb(0.8,0,0)' })).toEqual({ width: 0.8, color: 'rgb(204,0,0)' });
    expect(asyStyle('invisible')).toEqual({ noStroke: true });
    expect(asyStyle('purple').color).toBe('rgb(128,0,255)'); // Asymptote's purple, not xcolor's
  });
  it('back to source text', () => {
    const defs = new Map<string, string>();
    expect(styleToTikz({ color: 'rgb(255,0,0)', dash: [3, 3] }, defs)).toBe('color=red, dashed');
    expect(styleToTikz({ color: 'rgb(1,2,3)' }, defs)).toBe('color=c1');
    expect([...defs]).toEqual([['c1', 'rgb(1,2,3)']]);
    expect(styleToAsyPen({ color: 'rgb(0,0,255)', width: 1 })).toBe('blue+linewidth(1)');
    expect(styleToAsyPen({ color: 'rgb(0,128,128)' })).toBe('deepcyan'); // xcolor's teal under its Asymptote name
    expect(styleToAsyPen({ color: 'rgb(10,20,30)' })).toBe('rgb(0.039,0.078,0.118)');
  });
});

describe('dragging edits numbers in place', () => {
  const lit = (src: string) => (parse(src).statements[0] as DefStatement).lit!;
  it('cartesian points: both coordinates, rounded', () => {
    const src = '\\tkzDefPoint( 1 , 2 ){A} % keep me';
    const m = moveEdits(lit(src), 3.14159, -0.004, false)!;
    expect(applyEdits(src, m.edits)).toBe('\\tkzDefPoint( 3.14 , 0 ){A} % keep me');
    expect(applyEdits(src, moveEdits(lit(src), 3.3, 1.8, true)!.edits)).toBe('\\tkzDefPoint( 3.5 , 2 ){A} % keep me');
  });
  it('polar points keep their radius', () => {
    const src = '\\tkzDefPoint(75:2){A}';
    const m = moveEdits(lit(src), 0, 5, false)!;
    expect(applyEdits(src, m.edits)).toBe('\\tkzDefPoint(90:2){A}');
    expect(m.at.y).toBeCloseTo(2);
    expect(applyEdits(src, moveEdits(lit(src), 1, 0.3, true)!.edits)).toBe('\\tkzDefPoint(15:2){A}');
  });
  it('Asymptote dir() and shared GeoGebra literals', () => {
    const asy = 'pair A = dir(75);';
    const st = parseAsymptote(asy).statements[0] as DefStatement;
    expect(applyEdits(asy, moveEdits(st.lit!, -1, 0, false)!.edits)).toBe('pair A = dir(180);');
    const tikz = '\\draw (0.,0.)-- (3.,0.); \\draw (3.,0.)-- (0,4);';
    const shared = parse(tikz).statements.find((s) => s.type === 'def' && s.c.op === 'free' && s.c.x === 3) as DefStatement;
    expect(applyEdits(tikz, moveEdits(shared.lit!, 2, 1, false)!.edits)).toBe('\\draw (0.,0.)-- (2,1); \\draw (2,1)-- (0,4);');
  });
});

describe('scene', () => {
  it('label text: subscripts, primes, degrees', () => {
    expect(texRuns('$A_1$')).toEqual([{ text: 'A' }, { text: '1', shift: 'sub' }]);
    expect(texRuns("$O'$")).toEqual([{ text: 'O′' }]);
    expect(texRuns('$15\\dg$')).toEqual([{ text: '15°' }]);
    expect(texRuns('$O_{12}$')).toEqual([{ text: 'O' }, { text: '12', shift: 'sub' }]);
    expect(texRuns('$x^2$')).toEqual([{ text: 'x' }, { text: '2', shift: 'super' }]);
  });
  it('label directions', () => {
    expect(labelDirOf('above right', null)).toEqual({ angle: 45, k: 1 });
    expect(labelDirOf('anchor=north', null)).toEqual({ angle: 270, k: 1 });
    expect(labelDirOf('font=\\small, left', null)).toEqual({ angle: 180, k: 1 });
    expect(labelDirOf('color=red', null)).toBeNull();
  });
  it('marks and labels', () => {
    const g = compile('\\tkzDefPoints{1/0/A, 0/0/B, 0/1/C}\\tkzMarkRightAngle(A,B,C)\\tkzMarkAngle[size=0.5](A,B,C)\\tkzLabelPoint[above](C){$C_0$}').graph!;
    const pos = evaluate(g);
    expect(shapesOf(g.drawings[0]!, pos)[0]!.shape).toMatchObject({ type: 'rightAngle', s: 0.25 });
    expect(shapesOf(g.drawings[1]!, pos)[0]!.shape).toMatchObject({ type: 'angle', r: 0.5, t1: 0, t2: Math.PI / 2 });
    expect(labelsOf(g.drawings[2]!, pos)[0]).toMatchObject({ text: '$C_0$', dir: { angle: 90, k: 1 } });
  });
  it('Asymptote infinite lines and coloured strokes', () => {
    const r = compile('pair A=(0,0), B=(1,0); draw(line(A,B), red);', 'asy');
    const s = shapesOf(r.graph!.drawings[0]!, evaluate(r.graph!), r.graph!.colors);
    expect(s[0]).toMatchObject({ shape: { type: 'line' }, style: { color: 'rgb(255,0,0)' } });
  });
  it('handles: helper points are hidden, literal points are draggable', () => {
    const g = compile('\\coordinate (O) at (0,0); \\draw (O) circle (2); \\node at (3,3) {$X$};').graph!;
    const h = pointHandles(g, evaluate(g));
    expect(h.map((x) => [x.name, x.draggable])).toEqual([['O', true]]);
  });
});
