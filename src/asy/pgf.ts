// Small pgfmath subset (numbers, + - * / ^, sqrt, sin/cos/tan in degrees …) for TikZ coordinates
// and radii, evaluated with the Asymptote expression machinery.

import type { Expr } from './ast';
import { evalNum } from './expr';
import { AsyError, lex, parseExpression } from './parser';

const DEGREE_FNS: Record<string, string> = { sin: 'Sin', cos: 'Cos', tan: 'Tan', asin: 'aSin', acos: 'aCos', atan: 'aTan' };

function toDegrees(e: Expr): Expr {
  if (e.k === 'call') return { ...e, fn: DEGREE_FNS[e.fn] ?? e.fn, args: e.args.map(toDegrees) };
  if (e.k === 'bin') return { ...e, a: toDegrees(e.a), b: toDegrees(e.b) };
  if (e.k === 'unary') return { ...e, e: toDegrees(e.e) };
  return e;
}

/** Value of a pgfmath expression, or null when it is not supported. */
export function pgfEval(text: string): number | null {
  if (!/^[\d\s.+\-*/^()a-z,]*$/.test(text)) return null;
  try {
    const e = parseExpression(lex(text, 0));
    if (!e) return null;
    const v = evalNum(toDegrees(e), new Map());
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch (err) {
    if (err instanceof AsyError) return null;
    throw err;
  }
}
