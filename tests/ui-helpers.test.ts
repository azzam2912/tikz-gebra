import { describe, expect, it } from 'vitest';
import { compile } from '../src/pipeline';
import { targetAt } from '../src/ui/hover';
import { minimalChange } from '../src/ui/textdiff';
import { labelPos, shapesOf } from '../src/ui/shapes';
import { evaluate } from '../src/geom/evaluate';

describe('code → object hover mapping', () => {
  const src = '\\tkzDefPoints{0/0/A, 4/0/B}\n\\tkzDefMidPoint(A,B) \\tkzGetPoint{M}\n\\tkzDrawSegment(A,B)';
  const g = compile(src).graph!;
  it('maps offsets to steps and drawings', () => {
    expect(targetAt(g, src.indexOf('4/0/B'))).toEqual({ kind: 'step', id: 'B' });
    expect(targetAt(g, src.indexOf('GetPoint{M}'))).toEqual({ kind: 'step', id: 'M' });
    expect(targetAt(g, src.indexOf('DrawSegment'))).toEqual({ kind: 'drawing', id: 'd0' });
    expect(targetAt(g, 0)).toEqual(null);
  });
});

describe('minimal text change', () => {
  it('trims common prefix and suffix', () => {
    expect(minimalChange('\\tkzDefPoint(1,2){A}', '\\tkzDefPoint(1.5,2){A}')).toEqual({ from: 14, to: 14, insert: '.5' });
    expect(minimalChange('abc', 'abc')).toBeNull();
    expect(minimalChange('aXc', 'ac')).toEqual({ from: 1, to: 2, insert: '' });
  });
});

describe('rendering helpers', () => {
  it('label positions default to "below" like tkz-euclide', () => {
    expect(labelPos(null)).toEqual({ v: 'below', h: 'center' });
    expect(labelPos('above right')).toEqual({ v: 'above', h: 'right' });
    expect(labelPos('font=\\small, left')).toEqual({ v: 'center', h: 'left' });
  });
  it('\\tkzDrawLine is extended by 20% on both sides', () => {
    const g = compile('\\tkzDefPoints{0/0/A, 10/0/B}\n\\tkzDrawLine(A,B)').graph!;
    expect(shapesOf(g.drawings[0]!, evaluate(g))).toEqual([{ shape: { type: 'segment', a: { x: -2, y: 0 }, b: { x: 12, y: 0 } }, style: {} }]);
  });
  it('drawings touching an undefined point are hidden', () => {
    const g = compile(
      '\\tkzDefPoints{0/0/A, 1/0/B, 0/1/C, 1/1/D}\n\\tkzInterLL(A,B)(C,D) \\tkzGetPoint{P}\n\\tkzDrawSegment(A,P)',
    ).graph!;
    expect(shapesOf(g.drawings[0]!, evaluate(g))).toEqual([]);
  });
});
