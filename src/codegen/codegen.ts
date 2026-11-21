// Construction graph → canonical tkz-euclide code.
// Layout: definitions (topological order), blank line, drawings, blank line, labels.
// Only free points carry numbers; everything else is emitted symbolically.

import type { Construction, DrawingSpec, Graph } from '../graph/types';

/** Round to 2 decimals and print without trailing zeros (never "-0"). */
export function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  const s = (Object.is(r, -0) ? 0 : r).toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
}

export function constructionCode(c: Construction): string {
  const a = c.args;
  switch (c.op) {
    case 'free':
      return `\\tkzDefPoint(${fmt(c.x)},${fmt(c.y)}){${c.out[0]}}`;
    case 'midpoint':
      return `\\tkzDefMidPoint(${a[0]},${a[1]}) \\tkzGetPoint{${c.out[0]}}`;
    case 'projection':
      return `\\tkzDefPointBy[projection=onto ${a[1]}--${a[2]}](${a[0]}) \\tkzGetPoint{${c.out[0]}}`;
    case 'orthLine':
      return `\\tkzDefLine[orthogonal=through ${a[0]}](${a[1]},${a[2]}) \\tkzGetPoint{${c.out[0]}}`;
    case 'parLine':
      return `\\tkzDefLine[parallel=through ${a[0]}](${a[1]},${a[2]}) \\tkzGetPoint{${c.out[0]}}`;
    case 'interLL':
      return `\\tkzInterLL(${a[0]},${a[1]})(${a[2]},${a[3]}) \\tkzGetPoint{${c.out[0]}}`;
    case 'interLC':
      return `\\tkzInterLC(${a[0]},${a[1]})(${a[2]},${a[3]}) \\tkzGetPoints{${c.out[0]}}{${c.out[1]}}`;
    case 'interCC':
      return `\\tkzInterCC(${a[0]},${a[1]})(${a[2]},${a[3]}) \\tkzGetPoints{${c.out[0]}}{${c.out[1]}}`;
    case 'center':
      return `\\tkzDefTriangleCenter[${c.kind}](${a[0]},${a[1]},${a[2]}) \\tkzGetPoint{${c.out[0]}}`;
  }
}

export function drawingCode(d: DrawingSpec): string {
  const opt = d.options !== null ? `[${d.options}]` : '';
  const body =
    d.cmd === 'tkzDrawSegments' ? d.groups.map((g) => g.join(',')).join(' ') : (d.groups[0] ?? []).join(',');
  return `\\${d.cmd}${opt}(${body})`;
}

export function generate(g: Graph): string {
  const defs = g.steps.map((s) => constructionCode(s.c));
  const draws = g.drawings.filter((d) => d.d.cmd !== 'tkzLabelPoints').map((d) => drawingCode(d.d));
  const labels = g.drawings.filter((d) => d.d.cmd === 'tkzLabelPoints').map((d) => drawingCode(d.d));
  return [defs, draws, labels]
    .filter((block) => block.length > 0)
    .map((block) => block.join('\n'))
    .join('\n\n')
    .concat('\n');
}

export function fullDocument(body: string): string {
  const indented = body
    .trimEnd()
    .split('\n')
    .map((l) => (l ? '  ' + l : l))
    .join('\n');
  return [
    '\\documentclass[tikz,border=5pt]{standalone}',
    '\\usepackage{tkz-euclide}',
    '\\begin{document}',
    '\\begin{tikzpicture}',
    indented,
    '\\end{tikzpicture}',
    '\\end{document}',
    '',
  ].join('\n');
}
