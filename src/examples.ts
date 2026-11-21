import triangle from '../examples/triangle-circumcircle.tex?raw';
import orthocenter from '../examples/orthocenter.tex?raw';
import twoCircles from '../examples/two-circles.tex?raw';
import ninePoint from '../examples/nine-point-circle.asy?raw';
import tangents from '../examples/tangents-tikz.tex?raw';

export const EXAMPLES: { id: string; title: string; code: string }[] = [
  { id: 'triangle', title: 'Triangle + circumcircle', code: triangle },
  { id: 'orthocenter', title: 'Orthocenter', code: orthocenter },
  { id: 'two-circles', title: 'Two intersecting circles', code: twoCircles },
  { id: 'tangents-tikz', title: 'Tangents (plain TikZ + tkz)', code: tangents },
  { id: 'nine-point-asy', title: 'Nine-point circle (Asymptote)', code: ninePoint },
];
