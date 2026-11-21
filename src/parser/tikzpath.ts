// Scanner for the plain-TikZ subset: coordinates and the operations of a path
// (\draw, \fill, \node, \coordinate ...). Works on comment-blanked text; every span is an
// offset into the original source.

import type { Span } from './ast';
import { pgfEval } from '../asy/pgf';

export class TikzError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
  ) {
    super(message);
  }
}

/** TikZ dimension → cm (bare numbers are cm). */
const UNITS: Record<string, number> = { '': 1, cm: 1, mm: 0.1, pt: 1 / 28.45274, bp: 2.54 / 72, in: 2.54, em: 0.35, ex: 0.15 };
const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(cm|mm|pt|bp|in|em|ex)?$/;

export interface Num {
  value: number;
  /** Span of the number itself, only for plain (cm) numbers that can be rewritten. */
  span: Span | null;
}

export function parseNum(text: string, from: number, what: string): Num {
  const lead = text.length - text.trimStart().length;
  const t = text.trim();
  const m = NUM_RE.exec(t);
  if (!m) {
    const v = pgfEval(t.replace(/^\{|\}$/g, ''));
    if (v !== null) return { value: v, span: null };
    throw new TikzError(`Only numbers and simple expressions are supported in ${what} (got "${t}")`, from + lead, from + lead + Math.max(1, t.length));
  }
  const unit = m[2] ?? '';
  const start = from + lead;
  return {
    value: Number(m[1]) * UNITS[unit]!,
    span: unit === '' || unit === 'cm' ? { from: start, to: start + m[1]!.length } : null,
  };
}

export type TCoord =
  | { k: 'xy'; x: Num; y: Num; span: Span }
  | { k: 'polar'; angle: Num; r: Num; span: Span }
  | { k: 'name'; name: string; span: Span }
  /** ($(A)!t!(B)$) */
  | { k: 'partway'; a: TCoord; t: number; b: TCoord; span: Span }
  /** ($(A)!(P)!(B)$) — projection of P onto AB */
  | { k: 'proj'; a: TCoord; p: TCoord; b: TCoord; span: Span }
  /** ($(A)+(dx,dy)$) */
  | { k: 'add'; a: TCoord; d: TCoord; span: Span }
  /** (intersection of A--B and C--D) */
  | { k: 'inter'; pts: [TCoord, TCoord, TCoord, TCoord]; span: Span }
  /** +(..) / ++(..) relative to the previous point */
  | { k: 'rel'; d: TCoord; span: Span };

export type PathItem =
  | { k: 'coord'; c: TCoord }
  | { k: 'line'; span: Span }
  | { k: 'cycle'; span: Span }
  | { k: 'circle'; r: number; span: Span }
  | { k: 'node'; options: string | null; text: string; span: Span; at: TCoord | null };

/** Index of the bracket matching text[i] (which must be an opening bracket), or -1. */
export function matching(text: string, i: number): number {
  const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let j = i; j < text.length; j++) {
    const c = text[j]!;
    if (c in CLOSE) stack.push(CLOSE[c]!);
    else if (c === ')' || c === ']' || c === '}') {
      // a stray closer of another kind inside () or [] is tolerated (e.g. "]" in "(a]b)")
      if (stack[stack.length - 1] === c) stack.pop();
      else if (c === '}') return -1;
      if (stack.length === 0) return j;
    }
  }
  return -1;
}

/** Split on top-level commas (ignoring commas inside (), [], {}). */
function splitCommas(text: string): { text: string; from: number }[] {
  const out: { text: string; from: number }[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push({ text: text.slice(start, i), from: start });
      start = i + 1;
    }
  }
  out.push({ text: text.slice(start), from: start });
  return out;
}

/**
 * Parse the inside of a coordinate "( ... )". `inner` excludes the parentheses,
 * `from` is the source offset of inner[0], `span` covers the parentheses.
 */
export function parseCoordInner(inner: string, from: number, span: Span): TCoord {
  const t = inner.trim();
  const lead = inner.length - inner.trimStart().length;
  if (t.startsWith('$')) return parseCalc(inner, from, span);
  const inter = /^intersection\s+of\s+(.+?)--(.+?)\s+and\s+(.+?)--(.+?)$/.exec(t);
  if (inter) {
    const names = inter.slice(1, 5).map((n) => n.trim());
    const pts = names.map((n) => {
      const at = from + inner.indexOf(n);
      return { k: 'name', name: n, span: { from: at, to: at + n.length } } as TCoord;
    }) as [TCoord, TCoord, TCoord, TCoord];
    return { k: 'inter', pts, span };
  }
  const parts = splitCommas(inner);
  if (parts.length === 2) {
    return {
      k: 'xy',
      x: parseNum(parts[0]!.text, from + parts[0]!.from, 'coordinates'),
      y: parseNum(parts[1]!.text, from + parts[1]!.from, 'coordinates'),
      span,
    };
  }
  const colon = t.indexOf(':');
  if (parts.length === 1 && colon > 0) {
    const ci = inner.indexOf(':');
    return {
      k: 'polar',
      angle: parseNum(inner.slice(0, ci), from, 'polar coordinates'),
      r: parseNum(inner.slice(ci + 1), from + ci + 1, 'polar coordinates'),
      span,
    };
  }
  if (parts.length === 1 && /^[A-Za-z0-9_']+(\.[a-z ]+)?$/.test(t)) {
    const name = t.replace(/\.[a-z ]+$/, '');
    return { k: 'name', name, span: { from: from + lead, to: from + lead + name.length } };
  }
  throw new TikzError(`Unsupported coordinate "(${t})"`, span.from, span.to);
}

/** ($ ... $) with the calc library: (A)!t!(B), (A)!(P)!(B), (A)+(dx,dy). */
function parseCalc(inner: string, from: number, span: Span): TCoord {
  const s = inner.indexOf('$');
  const e = inner.lastIndexOf('$');
  const body = inner.slice(s + 1, e);
  const base = from + s + 1;
  // read "(...)" groups and the operators between them
  const groups: { c: TCoord; end: number }[] = [];
  const ops: string[] = [];
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      const j = matching(body, i);
      if (j < 0) throw new TikzError('Unclosed "(" in calc expression', base + i, base + i + 1);
      groups.push({ c: parseCoordInner(body.slice(i + 1, j), base + i + 1, { from: base + i, to: base + j + 1 }), end: j });
      i = j + 1;
      continue;
    }
    const m = /^!\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*!|^!|^\+/.exec(body.slice(i));
    if (!m) throw new TikzError(`Unsupported calc expression "$${body}$"`, span.from, span.to);
    ops.push(m[1] !== undefined ? `t${m[1]}` : m[0]);
    i += m[0].length;
  }
  const [a, b, c] = groups.map((g) => g.c);
  if (groups.length === 2 && ops.length === 1 && ops[0]!.startsWith('t')) {
    return { k: 'partway', a: a!, t: Number(ops[0]!.slice(1)), b: b!, span };
  }
  if (groups.length === 3 && ops.join('') === '!!') return { k: 'proj', a: a!, p: b!, b: c!, span };
  if (groups.length === 2 && ops.join('') === '+') return { k: 'add', a: a!, d: b!, span };
  throw new TikzError(`Unsupported calc expression "$${body.trim()}$" (supported: (A)!t!(B), (A)!(P)!(B), (A)+(x,y))`, span.from, span.to);
}

/**
 * Parse a path body (text after the command and its options, up to but excluding ";").
 * `from` is the source offset of text[0].
 */
export function parsePath(text: string, from: number): PathItem[] {
  const items: PathItem[] = [];
  let i = 0;
  const at = (k: number) => from + k;
  while (i < text.length) {
    const rest = text.slice(i);
    const ws = /^\s+/.exec(rest);
    if (ws) {
      i += ws[0].length;
      continue;
    }
    if (rest.startsWith('--')) {
      items.push({ k: 'line', span: { from: at(i), to: at(i + 2) } });
      i += 2;
      continue;
    }
    if (rest.startsWith('++') || rest.startsWith('+(')) {
      const skip = rest.startsWith('++') ? 2 : 1;
      const j = matching(text, i + skip);
      if (text[i + skip] !== '(' || j < 0) throw new TikzError('Expected "(" after "+"', at(i), at(i + skip));
      const span = { from: at(i), to: at(j + 1) };
      const d = parseCoordInner(text.slice(i + skip + 1, j), at(i + skip + 1), span);
      items.push({ k: 'coord', c: { k: 'rel', d, span } });
      i = j + 1;
      continue;
    }
    if (rest[0] === '(') {
      const j = matching(text, i);
      if (j < 0) throw new TikzError('Unclosed "("', at(i), at(i + 1));
      items.push({ k: 'coord', c: parseCoordInner(text.slice(i + 1, j), at(i + 1), { from: at(i), to: at(j + 1) }) });
      i = j + 1;
      continue;
    }
    const word = /^[a-z]+/.exec(rest)?.[0];
    if (word === 'cycle') {
      items.push({ k: 'cycle', span: { from: at(i), to: at(i + 5) } });
      i += 5;
      continue;
    }
    if (word === 'circle' || word === 'ellipse') {
      const start = i;
      i += word.length;
      while (/\s/.test(text[i] ?? '')) i++;
      let r: number;
      if (text[i] === '(') {
        const j = matching(text, i);
        const inner = text.slice(i + 1, j);
        if (inner.includes(' and ')) throw new TikzError('Ellipses are not supported', at(start), at(j + 1));
        r = parseNum(inner, at(i + 1), 'a circle radius').value;
        i = j + 1;
      } else if (text[i] === '[') {
        const j = matching(text, i);
        const m = /radius\s*=\s*([^,\]]+)/.exec(text.slice(i + 1, j));
        if (!m) throw new TikzError('Expected circle[radius=…]', at(start), at(j + 1));
        r = parseNum(m[1]!, at(i + 1 + m.index + m[0].indexOf(m[1]!)), 'a circle radius').value;
        i = j + 1;
      } else {
        throw new TikzError('Expected a radius after "circle"', at(start), at(i));
      }
      items.push({ k: 'circle', r, span: { from: at(start), to: at(i) } });
      continue;
    }
    if (word === 'node' || word === 'coordinate') {
      const start = i;
      i += word.length;
      let options: string | null = null;
      let nodeAt: TCoord | null = null;
      for (;;) {
        while (/\s/.test(text[i] ?? '')) i++;
        if (text[i] === '[') {
          const j = matching(text, i);
          options = text.slice(i + 1, j).trim();
          i = j + 1;
        } else if (text[i] === '(') {
          i = matching(text, i) + 1; // node name: ignored
        } else if (text.startsWith('at', i) && /\s|\(/.test(text[i + 2] ?? '')) {
          i += 2;
          while (/\s/.test(text[i] ?? '')) i++;
          const j = matching(text, i);
          nodeAt = parseCoordInner(text.slice(i + 1, j), at(i + 1), { from: at(i), to: at(j + 1) });
          i = j + 1;
        } else break;
      }
      let label = '';
      if (word === 'node') {
        if (text[i] !== '{') throw new TikzError('Expected {text} after node', at(start), at(i));
        const j = matching(text, i);
        label = text.slice(i + 1, j).trim();
        i = j + 1;
      }
      items.push({ k: 'node', options, text: label, span: { from: at(start), to: at(i) }, at: nodeAt });
      continue;
    }
    if (rest[0] === '[') {
      // options in the middle of a path: kept out of the figure
      i = matching(text, i) + 1;
      continue;
    }
    const what = word ?? rest.slice(0, 2);
    const end = /^[^\s(]*/.exec(rest)![0].length || 1;
    throw new TikzError(`Path operation "${what}" is not supported`, at(i), at(i + end));
  }
  return items;
}
