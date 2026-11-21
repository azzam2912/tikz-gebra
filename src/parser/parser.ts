// Hand-written parser for the supported tkz-euclide subset.
// No macro expansion, no \foreach, no \def. Unknown commands are reported as errors.

import type {
  CenterKind,
  Construction,
  DefStatement,
  Diagnostic,
  DrawCmd,
  DrawStatement,
  ParseResult,
  PointId,
  Severity,
  Span,
  Statement,
} from './ast';
import { blankComments, tokenize, type Token } from './tokenizer';

/** Valid point names: letters, digits, underscore and prime (A, O', M_1, P2). */
export const POINT_NAME_RE = /^[A-Za-z0-9_']+$/;
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

class ParseError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
  ) {
    super(message);
  }
}

interface Group {
  open: '(' | '[' | '{';
  /** Span including the delimiters. */
  from: number;
  to: number;
  /** Inner text (comments already blanked) and its start offset. */
  inner: string;
  innerFrom: number;
}

interface Piece {
  text: string;
  span: Span;
}

const CLOSE_OF = { '(': ')', '[': ']', '{': '}' } as const;

/** Compute 1-based line numbers from offsets. */
export function makeLineIndex(src: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Split `text` on top-level occurrences of `sep` (braces nest), trimming every piece. */
function splitTop(text: string, base: number, sep: string): Piece[] {
  const pieces: Piece[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const from = base + start + lead;
    pieces.push({ text: trimmed, span: { from, to: from + trimmed.length } });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === sep && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return pieces;
}

/** Split on runs of whitespace (used by \tkzDrawSegments). */
function splitWs(text: string, base: number): Piece[] {
  const pieces: Piece[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    pieces.push({ text: m[0], span: { from: base + m.index, to: base + m.index + m[0].length } });
  }
  return pieces;
}

function checkName(p: Piece): PointId {
  if (p.text === '') throw new ParseError('Missing point name', p.span.from, Math.max(p.span.to, p.span.from + 1));
  if (!POINT_NAME_RE.test(p.text)) {
    throw new ParseError(
      `Invalid point name "${p.text}" (use letters, digits, _ and ')`,
      p.span.from,
      p.span.to,
    );
  }
  return p.text;
}

function checkNumber(p: Piece, what: string): number {
  if (NUMBER_RE.test(p.text)) return Number(p.text);
  if (p.text === '') throw new ParseError(`Missing ${what} coordinate`, p.span.from, p.span.from + 1);
  throw new ParseError(
    `Only plain numeric coordinates are supported (got "${p.text}")`,
    p.span.from,
    p.span.to,
  );
}

/** Parse a group's content as a comma-separated list of point names. */
function nameList(g: Group, min: number, max: number, cmd: string): { names: PointId[]; spans: Span[] } {
  const pieces = splitTop(g.inner, g.innerFrom, ',');
  if (pieces.length < min || pieces.length > max) {
    const expected = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}–${max}`;
    throw new ParseError(
      `\\${cmd} expects ${expected} point${min === 1 && max === 1 ? '' : 's'} here, got ${pieces.length}`,
      g.from,
      g.to,
    );
  }
  return { names: pieces.map(checkName), spans: pieces.map((p) => p.span) };
}

const CENTER_KINDS: Record<string, CenterKind> = {
  circum: 'circum',
  in: 'in',
  centroid: 'centroid',
  ortho: 'ortho',
};

const IGNORED_ENVS = new Set(['tikzpicture', 'document']);

class Parser {
  private toks: Token[];
  private pos = 0;
  readonly statements: Statement[] = [];
  readonly diagnostics: Diagnostic[] = [];
  private lineOf: (o: number) => number;
  private clean: string;

  constructor(private src: string) {
    this.clean = blankComments(src);
    this.toks = tokenize(this.clean);
    this.lineOf = makeLineIndex(src);
  }

  // ---------------------------------------------------------------- helpers

  private diag(severity: Severity, message: string, from: number, to: number) {
    this.diagnostics.push({ severity, message, from, to: Math.max(to, from + 1), line: this.lineOf(from) });
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private skipWs(): Token | undefined {
    while (this.peek()?.t === 'ws') this.pos++;
    return this.peek();
  }

  private endOffset(): number {
    return this.src.length;
  }

  /**
   * Read a delimited group. `space` controls what may precede it:
   *  - 'allow':  whitespace is skipped (after a control word or before {..} arguments)
   *  - 'forbid': the group must follow immediately (TeX delimiters such as ")(" or "](")
   */
  private readGroup(open: '(' | '[' | '{', space: 'allow' | 'forbid', context: string): Group {
    const ws = this.peek();
    if (ws?.t === 'ws') {
      if (space === 'forbid') {
        const next = this.toks[this.pos + 1];
        if (next?.t === 'open' && next.ch === open) {
          throw new ParseError(
            `No space allowed before "${open}" in \\${context} (LaTeX would misread the arguments)`,
            ws.from,
            ws.to,
          );
        }
      } else {
        this.skipWs();
      }
    }
    const t = this.peek();
    if (!t || t.t !== 'open' || t.ch !== open) {
      const at = t ? t.from : this.endOffset();
      throw new ParseError(`Expected "${open}" in \\${context}`, at, t ? t.to : at + 1);
    }
    const close = CLOSE_OF[open];
    let depth = 0;
    let i = this.pos + 1;
    for (; i < this.toks.length; i++) {
      const k = this.toks[i]!;
      if (k.t === 'open' && k.ch === '{') depth++;
      else if (k.t === 'close' && k.ch === '}' && depth > 0) depth--;
      else if (k.t === 'close' && k.ch === close && depth === 0) break;
    }
    if (i >= this.toks.length) {
      throw new ParseError(`Unclosed "${open}" in \\${context}`, t.from, t.to);
    }
    const closeTok = this.toks[i]!;
    this.pos = i + 1;
    const innerFrom = t.to;
    return {
      open,
      from: t.from,
      to: closeTok.to,
      inner: this.clean.slice(innerFrom, closeTok.from),
      innerFrom,
    };
  }

  /** Optional [..] group (whitespace before it is skipped). */
  private optGroup(): Group | null {
    const save = this.pos;
    const t = this.skipWs();
    if (t?.t === 'open' && t.ch === '[') return this.readGroup('[', 'allow', '');
    this.pos = save;
    return null;
  }

  /** After an error: skip to the next top-level command token. */
  private recover() {
    let depth = 0;
    while (this.pos < this.toks.length) {
      const t = this.toks[this.pos]!;
      if (t.t === 'cmd' && depth === 0) return;
      if (t.t === 'open' && t.ch === '{') depth++;
      if (t.t === 'close' && t.ch === '}' && depth > 0) depth--;
      this.pos++;
    }
  }

  // ---------------------------------------------------------------- driver

  run(): ParseResult {
    while (this.pos < this.toks.length) {
      const t = this.toks[this.pos]!;
      if (t.t === 'ws') {
        this.pos++;
        continue;
      }
      if (t.t !== 'cmd') {
        const from = t.from;
        this.recover();
        const last = this.toks[this.pos - 1];
        let to = last ? last.to : from + 1;
        // trim trailing whitespace out of the reported range
        while (to > from && /\s/.test(this.src[to - 1]!)) to--;
        this.diag('error', `Unexpected text "${this.src.slice(from, Math.min(to, from + 30)).trim()}" (only tkz-euclide commands are supported)`, from, to);
        continue;
      }
      this.pos++;
      try {
        this.command(t as Extract<Token, { t: 'cmd' }>);
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        this.diag('error', e.message, e.from, e.to);
        this.recover();
      }
    }
    return { statements: this.statements, diagnostics: this.diagnostics };
  }

  private command(t: Extract<Token, { t: 'cmd' }>) {
    const name = t.name;
    switch (name) {
      case 'tkzDefPoint':
        return this.defPoint(t);
      case 'tkzDefPoints':
        return this.defPoints(t);
      case 'tkzDefMidPoint': {
        const g = this.readGroup('(', 'allow', name);
        const a = nameList(g, 2, 2, name);
        return this.finishDef(t, (out) => ({ op: 'midpoint', args: a.names as [string, string], out: out as [string] }), a.spans, 1);
      }
      case 'tkzDefPointBy':
        return this.defPointBy(t);
      case 'tkzDefLine':
        return this.defLine(t);
      case 'tkzInterLL': {
        const g1 = this.readGroup('(', 'allow', name);
        const g2 = this.readGroup('(', 'forbid', name);
        const l1 = nameList(g1, 2, 2, name);
        const l2 = nameList(g2, 2, 2, name);
        const args = [...l1.names, ...l2.names] as [string, string, string, string];
        return this.finishDef(t, (out) => ({ op: 'interLL', args, out: out as [string] }), [...l1.spans, ...l2.spans], 1);
      }
      case 'tkzInterLC':
      case 'tkzInterCC': {
        const opt = this.optGroup();
        if (opt && opt.inner.trim() !== '') {
          throw new ParseError(`Options of \\${name} ("${opt.inner.trim()}") are not supported yet`, opt.from, opt.to);
        }
        const g1 = this.readGroup('(', opt ? 'forbid' : 'allow', name);
        const g2 = this.readGroup('(', 'forbid', name);
        const l1 = nameList(g1, 2, 2, name);
        const l2 = nameList(g2, 2, 2, name);
        const args = [...l1.names, ...l2.names] as [string, string, string, string];
        const op = name === 'tkzInterLC' ? 'interLC' : 'interCC';
        return this.finishDef(t, (out) => ({ op, args, out: out as [string, string] }), [...l1.spans, ...l2.spans], 2);
      }
      case 'tkzDefTriangleCenter': {
        const opt = this.optGroup();
        let kind: CenterKind = 'circum'; // tkz-euclide default key is "circum"
        if (opt) {
          const key = opt.inner.trim();
          const k = CENTER_KINDS[key];
          if (!k) {
            throw new ParseError(
              `Unsupported triangle center "${key}" (supported: circum, in, centroid, ortho)`,
              opt.from,
              opt.to,
            );
          }
          kind = k;
        }
        const g = this.readGroup('(', opt ? 'forbid' : 'allow', name);
        const l = nameList(g, 3, 3, name);
        return this.finishDef(t, (out) => ({ op: 'center', kind, args: l.names as [string, string, string], out: out as [string] }), l.spans, 1);
      }
      case 'tkzGetPoint':
      case 'tkzGetPoints':
      case 'tkzGetFirstPoint':
      case 'tkzGetSecondPoint':
        throw new ParseError(`\\${name} must directly follow a \\tkzDef… or \\tkzInter… command`, t.from, t.to);
      case 'tkzDrawSegment':
      case 'tkzDrawLine':
      case 'tkzDrawCircle':
        return this.draw(t, name, 2, 2);
      case 'tkzDrawPolygon':
        return this.draw(t, name, 2, Infinity);
      case 'tkzDrawPoints':
      case 'tkzLabelPoints':
        return this.draw(t, name, 1, Infinity);
      case 'tkzDrawSegments':
        return this.drawSegments(t);
      case 'begin':
      case 'end':
        return this.env(t);
      case 'documentclass':
      case 'usepackage':
        this.optGroup();
        this.readGroup('{', 'allow', name);
        return;
      default:
        throw new ParseError(`Unknown or unsupported command \\${name}`, t.from, t.to);
    }
  }

  // ---------------------------------------------------------------- definitions

  private defPoint(t: Extract<Token, { t: 'cmd' }>) {
    const opt = this.optGroup();
    if (opt && opt.inner.trim() !== '') {
      throw new ParseError('Options of \\tkzDefPoint are not supported', opt.from, opt.to);
    }
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', 'tkzDefPoint');
    if (/^[^{]*:/.test(g.inner)) {
      throw new ParseError('Polar coordinates (r:angle) are not supported; use (x,y)', g.from, g.to);
    }
    const parts = splitTop(g.inner, g.innerFrom, ',');
    if (parts.length !== 2) throw new ParseError('\\tkzDefPoint expects (x,y)', g.from, g.to);
    const x = checkNumber(parts[0]!, 'x');
    const y = checkNumber(parts[1]!, 'y');
    const ng = this.readGroup('{', 'allow', 'tkzDefPoint');
    const np = splitTop(ng.inner, ng.innerFrom, ',');
    if (np.length !== 1) throw new ParseError('\\tkzDefPoint defines exactly one point', ng.from, ng.to);
    const name = checkName(np[0]!);
    this.pushDef({ op: 'free', args: [], out: [name], x, y }, { from: t.from, to: ng.to }, [], [np[0]!.span]);
  }

  private defPoints(_t: Extract<Token, { t: 'cmd' }>) {
    const opt = this.optGroup();
    if (opt && opt.inner.trim() !== '') {
      throw new ParseError('Options of \\tkzDefPoints are not supported', opt.from, opt.to);
    }
    const g = this.readGroup('{', 'allow', 'tkzDefPoints');
    const items = splitTop(g.inner, g.innerFrom, ',').filter((p, i, all) => !(p.text === '' && i === all.length - 1 && all.length > 1));
    for (const item of items) {
      const parts = splitTop(item.text, item.span.from, '/');
      if (parts.length !== 3) {
        throw new ParseError(`Expected x/y/name in \\tkzDefPoints, got "${item.text}"`, item.span.from, item.span.to);
      }
      const x = checkNumber(parts[0]!, 'x');
      const y = checkNumber(parts[1]!, 'y');
      const name = checkName(parts[2]!);
      this.pushDef({ op: 'free', args: [], out: [name], x, y }, item.span, [], [parts[2]!.span]);
    }
  }

  private defPointBy(t: Extract<Token, { t: 'cmd' }>) {
    const opt = this.readGroup('[', 'allow', 'tkzDefPointBy');
    const m = /^\s*projection\s*=\s*onto\s+(\S+?)\s*--\s*(\S+?)\s*$/d.exec(opt.inner);
    if (!m) {
      throw new ParseError(
        'Only [projection=onto A--B] is supported for \\tkzDefPointBy',
        opt.from,
        opt.to,
      );
    }
    const piece = (k: 1 | 2): Piece => {
      const [s0, e0] = m.indices![k]!;
      return { text: m[k]!, span: { from: opt.innerFrom + s0, to: opt.innerFrom + e0 } };
    };
    const pa = piece(1);
    const pb = piece(2);
    const a = checkName(pa);
    const b = checkName(pb);
    const g = this.readGroup('(', 'forbid', 'tkzDefPointBy');
    const p = nameList(g, 1, 1, 'tkzDefPointBy');
    this.finishDef(
      t,
      (out) => ({ op: 'projection', args: [p.names[0]!, a, b], out: out as [string] }),
      [p.spans[0]!, pa.span, pb.span],
      1,
    );
  }

  private defLine(t: Extract<Token, { t: 'cmd' }>) {
    const opt = this.readGroup('[', 'allow', 'tkzDefLine');
    const m = /^\s*(orthogonal|perpendicular|parallel)\s*=\s*through\s+(\S+?)\s*$/d.exec(opt.inner);
    if (!m) {
      throw new ParseError(
        'Only [orthogonal=through C] and [parallel=through C] are supported for \\tkzDefLine',
        opt.from,
        opt.to,
      );
    }
    const [s0, e0] = m.indices![2]!;
    const cSpan = { from: opt.innerFrom + s0, to: opt.innerFrom + e0 };
    const c = checkName({ text: m[2]!, span: cSpan });
    const g = this.readGroup('(', 'forbid', 'tkzDefLine');
    const l = nameList(g, 2, 2, 'tkzDefLine');
    const op = m[1] === 'parallel' ? 'parLine' : 'orthLine';
    this.finishDef(
      t,
      (out) => ({ op, args: [c, l.names[0]!, l.names[1]!], out: out as [string] }),
      [cSpan, ...l.spans],
      1,
    );
  }

  /** Read the mandatory \tkzGetPoint{..} / \tkzGetPoints{..}{..} that follows a definition. */
  private finishDef(
    t: Extract<Token, { t: 'cmd' }>,
    make: (out: PointId[]) => Construction,
    argSpans: Span[],
    count: 1 | 2,
  ) {
    const defName = t.name;
    const want = count === 1 ? 'tkzGetPoint' : 'tkzGetPoints';
    const hint = count === 1 ? '\\tkzGetPoint{M}' : '\\tkzGetPoints{P}{Q}';
    const save = this.pos;
    const next = this.skipWs();
    if (!next || next.t !== 'cmd' || !next.name.startsWith('tkzGet')) {
      this.pos = save;
      throw new ParseError(`\\${defName} must be followed by ${hint}`, t.from, t.to);
    }
    if (next.name !== want) {
      const why =
        next.name === 'tkzGetFirstPoint' || next.name === 'tkzGetSecondPoint'
          ? `\\${next.name} is not supported yet; use ${hint}`
          : `\\${defName} defines ${count === 1 ? 'one point' : 'two points'}: use ${hint}`;
      this.pos++;
      throw new ParseError(why, next.from, next.to);
    }
    this.pos++;
    const outs: Piece[] = [];
    let end = next.to;
    for (let k = 0; k < count; k++) {
      const g = this.readGroup('{', 'allow', want);
      const pieces = splitTop(g.inner, g.innerFrom, ',');
      if (pieces.length !== 1) throw new ParseError(`\\${want} expects one name per {…}`, g.from, g.to);
      outs.push(pieces[0]!);
      end = g.to;
    }
    const names = outs.map(checkName);
    if (count === 2 && names[0] === names[1]) {
      throw new ParseError(`Both intersection points are named "${names[0]}"`, outs[1]!.span.from, outs[1]!.span.to);
    }
    this.pushDef(make(names), { from: t.from, to: end }, argSpans, outs.map((o) => o.span));
  }

  private pushDef(c: Construction, span: Span, argSpans: Span[], outSpans: Span[]) {
    const st: DefStatement = { type: 'def', c, span, argSpans, outSpans };
    this.statements.push(st);
  }

  // ---------------------------------------------------------------- drawings

  private draw(t: Extract<Token, { t: 'cmd' }>, cmd: DrawCmd, min: number, max: number) {
    const opt = this.optGroup();
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', cmd);
    const l = nameList(g, min, max, cmd);
    const st: DrawStatement = {
      type: 'draw',
      d: { cmd, options: opt ? opt.inner.trim() : null, groups: [l.names] },
      span: { from: t.from, to: g.to },
      refSpans: [l.spans],
    };
    this.statements.push(st);
  }

  private drawSegments(t: Extract<Token, { t: 'cmd' }>) {
    const cmd = 'tkzDrawSegments';
    const opt = this.optGroup();
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', cmd);
    const items = splitWs(g.inner, g.innerFrom);
    if (items.length === 0) throw new ParseError('\\tkzDrawSegments needs at least one pair A,B', g.from, g.to);
    const groups: PointId[][] = [];
    const refSpans: Span[][] = [];
    for (const it of items) {
      const parts = splitTop(it.text, it.span.from, ',');
      if (parts.length !== 2 || parts.some((p) => p.text === '')) {
        throw new ParseError(
          `\\tkzDrawSegments expects space-separated pairs like "A,B B,C" (no spaces inside a pair); got "${it.text}"`,
          it.span.from,
          it.span.to,
        );
      }
      groups.push(parts.map(checkName));
      refSpans.push(parts.map((p) => p.span));
    }
    this.statements.push({
      type: 'draw',
      d: { cmd, options: opt ? opt.inner.trim() : null, groups },
      span: { from: t.from, to: g.to },
      refSpans,
    });
  }

  // ---------------------------------------------------------------- wrappers

  private env(t: Extract<Token, { t: 'cmd' }>) {
    const g = this.readGroup('{', 'allow', t.name);
    const envName = g.inner.trim();
    if (!IGNORED_ENVS.has(envName)) {
      throw new ParseError(`Unsupported environment "${envName}"`, t.from, g.to);
    }
    if (t.name === 'begin' && envName === 'tikzpicture') {
      const save = this.pos;
      const opt = this.optGroup();
      if (opt && opt.inner.trim() !== '') {
        this.diag('warning', 'tikzpicture options (scale, rotate, …) are ignored by the preview', opt.from, opt.to);
      } else if (!opt) {
        this.pos = save;
      }
    }
  }
}

export function parse(src: string): ParseResult {
  return new Parser(src).run();
}
