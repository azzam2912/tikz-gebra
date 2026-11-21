// Hand-written parser for the supported tkz-euclide + plain TikZ subset.
// No macro expansion, no \foreach, no \def. Errors inside supported commands are reported
// with line numbers; unknown commands are skipped with a warning so the rest still renders.

import type {
  CenterKind,
  Construction,
  DefStatement,
  Diagnostic,
  DrawCmd,
  DrawingSpec,
  DrawStatement,
  InterArgs,
  Literal,
  ParseResult,
  PointId,
  Severity,
  Span,
  Statement,
} from './ast';
import { blankComments, tokenize, type Token } from './tokenizer';
import { matching, parseCoordInner, parseNum, parsePath, TikzError, type TCoord } from './tikzpath';

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

type CmdToken = Extract<Token, { t: 'cmd' }>;

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

/** A number or a simple fraction "a/b" (homothety ratios, rotation angles). */
function checkValue(p: Piece, what: string): number {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*\/\s*(\d+\.?\d*|\.\d+))?$/.exec(p.text);
  if (m) {
    const v = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
    if (Number.isFinite(v)) return v;
  }
  throw new ParseError(`Only a number or a fraction a/b is supported as ${what} (got "${p.text}")`, p.span.from, Math.max(p.span.to, p.span.from + 1));
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
  ex: 'ex',
  centroid: 'centroid',
  median: 'centroid',
  ortho: 'ortho',
  orthic: 'ortho',
  euler: 'euler',
};

/** Triangle-centre shortcuts: \tkzCircumCenter(A,B,C)\tkzGetPoint{O} etc. */
const CENTER_CMDS: Record<string, CenterKind> = {
  tkzCircumCenter: 'circum',
  tkzDefCircumCenter: 'circum',
  tkzInCenter: 'in',
  tkzDefInCenter: 'in',
  tkzExCenter: 'ex',
  tkzDefExCenter: 'ex',
  tkzOrthoCenter: 'ortho',
  tkzCentroid: 'centroid',
  tkzBaryCenter: 'centroid',
  tkzEulerCenter: 'euler',
};

/** Environments whose content is parsed as if they were not there. */
const TRANSPARENT_ENVS = new Set([
  'tikzpicture', 'document', 'center', 'scope', 'figure', 'flushleft', 'flushright', 'minipage',
  'scriptsize', 'footnotesize', 'small', 'tiny', 'normalsize', 'large', 'Large',
]);

/** Commands that change only the look (or the page) and are skipped silently, with their arguments. */
const STYLE_CMDS: Record<string, string> = {
  // name → argument pattern: o = optional [..], m = {..}, p = (..)
  usetikzlibrary: 'm', tikzset: 'm', tkzInit: 'o', tkzClip: 'o', tkzShowBB: 'o', tkzSetUpPoint: 'o',
  tkzSetUpLine: 'o', tkzSetUpCompass: 'o', tkzSetUpLabel: 'o', tkzSetUpArc: 'o', tkzSetUpStyle: 'om',
  tkzSetUpColors: 'o', tkzGrid: 'o', tkzAxeXY: 'o', tkzAxeX: 'o', tkzAxeY: 'o', centering: '', noindent: '',
  scriptsize: '', footnotesize: '', small: '', tiny: '', normalsize: '', large: '', Large: '', par: '',
  tikzstyle: '', pgfmathsetmacro: '', newcommand: '',
};

/** Fill-in for \tkzDrawCircle[R] and friends: commands we parse but don't draw. */
const IGNORED_DRAW_CMDS = new Set(['tkzMarkAngles', 'tkzLabelAngle', 'tkzLabelAngles', 'tkzLabelSegment', 'tkzLabelSegments', 'tkzLabelLine', 'tkzLabelCircle', 'tkzFillAngle', 'tkzFillAngles', 'tkzDrawArc', 'tkzDrawSector', 'tkzDrawSemiCircle', 'tkzDrawSemiCircles', 'tkzMarkArc', 'tkzPicAngle', 'tkzPicRightAngle']);

const COLOR_MODELS: Record<string, (v: number[]) => string | null> = {
  rgb: (v) => (v.length === 3 ? rgbCss(v[0]!, v[1]!, v[2]!) : null),
  RGB: (v) => (v.length === 3 ? rgbCss(v[0]! / 255, v[1]! / 255, v[2]! / 255) : null),
  gray: (v) => (v.length === 1 ? rgbCss(v[0]!, v[0]!, v[0]!) : null),
};

export function rgbCss(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

class Parser {
  private toks: Token[];
  private pos = 0;
  readonly statements: Statement[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly colors: Record<string, string> = {};
  private lineOf: (o: number) => number;
  private clean: string;
  private auxCount = 0;
  /** numeric TikZ coordinate "x,y" → name of the anonymous free point standing for it */
  private literalPoints = new Map<string, DefStatement>();

  constructor(
    private src: string,
    private auxPrefix = '~',
  ) {
    this.clean = blankComments(src);
    this.toks = tokenize(this.clean);
    this.lineOf = makeLineIndex(src);
  }

  // ---------------------------------------------------------------- helpers

  private diag(severity: Severity, message: string, from: number, to: number, code?: Diagnostic['code']) {
    this.diagnostics.push({ severity, message, from, to: Math.max(to, from + 1), line: this.lineOf(from), ...(code ? { code } : {}) });
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

  private aux(): PointId {
    return `${this.auxPrefix}${++this.auxCount}`;
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

  /** Optional {..} group. */
  private optBrace(): Group | null {
    const save = this.pos;
    const t = this.skipWs();
    if (t?.t === 'open' && t.ch === '{') return this.readGroup('{', 'allow', '');
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

  /** Raw text from the current position up to the next top-level ";" (consumed). */
  private untilSemicolon(cmd: string): { text: string; from: number; end: number } {
    const start = this.pos < this.toks.length ? this.toks[this.pos]!.from : this.endOffset();
    let depth = 0;
    for (let i = start; i < this.clean.length; i++) {
      const c = this.clean[i]!;
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') depth--;
      else if (c === ';' && depth <= 0) {
        while (this.pos < this.toks.length && this.toks[this.pos]!.from <= i) this.pos++;
        return { text: this.clean.slice(start, i), from: start, end: i + 1 };
      }
    }
    throw new ParseError(`Missing ";" at the end of \\${cmd}`, start, Math.min(start + 1, this.endOffset()));
  }

  // ---------------------------------------------------------------- driver

  run(): ParseResult {
    while (this.pos < this.toks.length) {
      const t = this.toks[this.pos]!;
      if (t.t === 'ws' || (t.t === 'close' && t.ch === '}') || (t.t === 'open' && t.ch === '{')) {
        // stray braces come from groups like {\scriptsize ...}: harmless
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
        this.diag('error', `Unexpected text "${this.src.slice(from, Math.min(to, from + 30)).trim()}" (only tkz-euclide and TikZ drawing commands are supported)`, from, to);
        continue;
      }
      this.pos++;
      try {
        this.command(t as CmdToken);
      } catch (e) {
        if (e instanceof TikzError) {
          this.diag('error', e.message, e.from, e.to);
          this.recover();
          continue;
        }
        if (!(e instanceof ParseError)) throw e;
        this.diag('error', e.message, e.from, e.to);
        this.recover();
      }
    }
    return { statements: this.statements, diagnostics: this.diagnostics, colors: this.colors };
  }

  private command(t: CmdToken) {
    const name = t.name;
    const center = CENTER_CMDS[name];
    if (center) {
      const g = this.readGroup('(', 'allow', name);
      const l = nameList(g, 3, 3, name);
      return this.finishDef(t, (out) => ({ op: 'center', kind: center, args: l.names as [string, string, string], out: out as [string] }), l.spans, 1);
    }
    if (name in STYLE_CMDS) return this.skipArgs(STYLE_CMDS[name]!);
    if (IGNORED_DRAW_CMDS.has(name)) return this.ignoreDraw(t);
    switch (name) {
      case 'tkzDefPoint':
        return this.defPoint(t);
      case 'tkzDefPoints':
        return this.defPoints(t);
      case 'tkzDefShiftPoint':
        return this.defShiftPoint(t);
      case 'tkzDefMidPoint': {
        const g = this.readGroup('(', 'allow', name);
        const a = nameList(g, 2, 2, name);
        return this.finishDef(t, (out) => ({ op: 'midpoint', args: a.names as [string, string], out: out as [string] }), a.spans, 1);
      }
      case 'tkzDefMidArc': {
        const g = this.readGroup('(', 'allow', name);
        const a = nameList(g, 3, 3, name);
        return this.finishDef(t, (out) => ({ op: 'midArc', args: a.names as [string, string, string], out: out as [string] }), a.spans, 1);
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
        let order: 'common' | 'near' | null = null;
        let common: Piece | null = null;
        if (opt && opt.inner.trim() !== '') {
          const m = /^\s*common\s*=\s*(\S+?)\s*$/d.exec(opt.inner);
          if (m) {
            const [s0, e0] = m.indices![1]!;
            common = { text: m[1]!, span: { from: opt.innerFrom + s0, to: opt.innerFrom + e0 } };
            checkName(common);
            order = 'common';
          } else if (opt.inner.trim() === 'near' && name === 'tkzInterLC') {
            order = 'near';
          } else {
            throw new ParseError(`Options of \\${name} ("${opt.inner.trim()}") are not supported yet (supported: common=X${name === 'tkzInterLC' ? ', near' : ''})`, opt.from, opt.to);
          }
        }
        const g1 = this.readGroup('(', opt ? 'forbid' : 'allow', name);
        const g2 = this.readGroup('(', 'forbid', name);
        const l1 = nameList(g1, 2, 2, name);
        const l2 = nameList(g2, 2, 2, name);
        const args = [...l1.names, ...l2.names, ...(common ? [common.text] : [])] as InterArgs;
        const op = name === 'tkzInterLC' ? 'interLC' : 'interCC';
        const spans = [...l1.spans, ...l2.spans, ...(common ? [common.span] : [])];
        return this.finishDef(t, (out) => ({ op, args, out: out as [string, string], ...(order ? { order } : {}) }), spans, 2);
      }
      case 'tkzDefTriangleCenter': {
        const opt = this.optGroup();
        let kind: CenterKind = 'circum'; // tkz-euclide default key is "circum"
        if (opt) {
          const key = opt.inner.trim();
          const k = CENTER_KINDS[key];
          if (!k) {
            throw new ParseError(
              `Unsupported triangle center "${key}" (supported: ${Object.keys(CENTER_KINDS).join(', ')})`,
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
      case 'tkzFillCircle':
      case 'tkzMarkSegment':
        return this.draw(t, name, 2, 2);
      case 'tkzDrawPolygon':
      case 'tkzFillPolygon':
      case 'tkzDrawPolySeg':
        return this.draw(t, name, 2, Infinity);
      case 'tkzMarkRightAngle':
      case 'tkzMarkAngle':
        return this.draw(t, name, 3, 3);
      case 'tkzDrawPoint':
        return this.draw(t, name, 1, 1);
      case 'tkzDrawPoints':
      case 'tkzLabelPoints':
        return this.draw(t, name, 1, Infinity);
      case 'tkzLabelPoint':
        return this.labelPoint(t);
      case 'tkzDrawSegments':
      case 'tkzDrawLines':
      case 'tkzDrawCircles':
      case 'tkzMarkSegments':
        return this.drawPairs(t, name);
      case 'begin':
      case 'end':
        return this.env(t);
      case 'documentclass':
      case 'usepackage':
        this.optGroup();
        this.readGroup('{', 'allow', name);
        return;
      case 'definecolor':
        return this.defineColor(t);
      case 'coordinate':
        return this.tikzCoordinate(t);
      case 'node':
        return this.tikzNode(t);
      case 'draw':
      case 'fill':
      case 'filldraw':
      case 'path':
        return this.tikzPath(t);
      case 'clip':
        this.untilSemicolon(name);
        return;
      case 'pic':
        return this.tikzPic(t);
      case 'foreach':
        return this.foreach(t);
      case 'def':
      case 'let':
        throw new ParseError(`\\${name} is not supported (no loops or macros)`, t.from, t.to);
      default:
        return this.unknown(t);
    }
  }

  /**
   * \foreach \x in {A,B,C} <command or {body}>: the only loop form supported. The body is
   * repeated with \x replaced by each item; its objects map back to the \foreach line.
   */
  private foreach(t: CmdToken) {
    const head = /^\s*(\\[A-Za-z]+)\s+in\s*\{([^{}]*)\}\s*/.exec(this.clean.slice(t.to));
    if (!head) throw new ParseError('Only \\foreach \\x in {A,B,…} is supported', t.from, t.to);
    const v = head[1]!;
    const items = head[2]!.split(',').map((s) => s.trim()).filter((s) => s);
    if (items.some((s) => s.includes('...'))) throw new ParseError('\\foreach ranges (1,...,n) are not supported', t.from, t.to + head[0].length);
    let bodyFrom = t.to + head[0].length;
    let bodyTo: number;
    let body: string;
    if (this.clean[bodyFrom] === '{') {
      const close = matching(this.clean, bodyFrom);
      if (close < 0) throw new ParseError('Unclosed "{" after \\foreach', bodyFrom, bodyFrom + 1);
      body = this.clean.slice(bodyFrom + 1, close);
      bodyTo = close + 1;
    } else {
      const semi = this.clean.indexOf(';', bodyFrom);
      const nextCmd = /\\[A-Za-z]+/.exec(this.clean.slice(bodyFrom + 1));
      // a tkz command has no ";": the body is the next command with its arguments
      bodyTo = semi >= 0 && /^\s*\\(draw|fill|filldraw|node|path|coordinate)/.test(this.clean.slice(bodyFrom)) ? semi + 1 : bodyFrom + 1 + (nextCmd ? nextCmd.index : this.clean.length);
      body = this.clean.slice(bodyFrom, bodyTo);
    }
    const span = { from: t.from, to: bodyTo };
    const re = new RegExp(v.replace(/\\/g, '\\\\') + '(?![A-Za-z])', 'g');
    for (const item of items) {
      const sub = new Parser(body.replace(re, item), `${this.auxPrefix}f${++this.auxCount}_`);
      const r = sub.run();
      for (const d of r.diagnostics) this.diag(d.severity, `in \\foreach (${v}=${item}): ${d.message}`, t.from, span.to, d.code);
      for (const st of r.statements) {
        if (st.type === 'def') {
          delete st.lit;
          st.span = span;
          st.argSpans = st.argSpans.map(() => span);
          st.outSpans = st.outSpans.map(() => span);
        } else {
          st.span = span;
          st.refSpans = st.refSpans.map((g) => g.map(() => span));
        }
        this.statements.push(st);
      }
      Object.assign(this.colors, r.colors);
    }
    while (this.pos < this.toks.length && this.toks[this.pos]!.from < bodyTo) this.pos++;
  }

  /** Skip a command we don't understand, with a warning; its arguments are skipped too. */
  private unknown(t: CmdToken) {
    const start = this.pos;
    // swallow directly attached arguments ([..], (..), {..})
    for (;;) {
      const k = this.peek();
      if (k?.t === 'open') {
        try {
          this.readGroup(k.ch, 'allow', t.name);
          continue;
        } catch {
          this.pos = start;
        }
      }
      break;
    }
    const end = this.toks[this.pos - 1]?.to ?? t.to;
    this.diag('warning', `\\${t.name} is not supported and is ignored`, t.from, Math.max(t.to, end), 'ignored');
  }

  private ignoreDraw(t: CmdToken) {
    const save = this.pos;
    try {
      this.optGroup();
      for (let k = 0; k < 3; k++) {
        const n = this.peek();
        if (n?.t === 'open' && (n.ch === '(' || n.ch === '{')) this.readGroup(n.ch, 'forbid', t.name);
        else break;
      }
    } catch {
      this.pos = save;
    }
    this.diag('warning', `\\${t.name} is not drawn by the preview (kept in the code)`, t.from, this.toks[this.pos - 1]?.to ?? t.to, 'ignored');
  }

  private skipArgs(pattern: string) {
    for (const p of pattern) {
      if (p === 'o') this.optGroup();
      else if (p === 'm') this.optBrace();
    }
  }

  // ---------------------------------------------------------------- definitions

  private defPoint(t: CmdToken) {
    const opt = this.optGroup();
    if (opt && opt.inner.trim() !== '') {
      throw new ParseError('Options of \\tkzDefPoint are not supported', opt.from, opt.to);
    }
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', 'tkzDefPoint');
    let c: Construction;
    let lit: Literal;
    const colon = g.inner.indexOf(':');
    if (colon >= 0 && !g.inner.includes(',')) {
      const ap: Piece = splitTop(g.inner.slice(0, colon), g.innerFrom, '\0')[0]!;
      const rp: Piece = splitTop(g.inner.slice(colon + 1), g.innerFrom + colon + 1, '\0')[0]!;
      const angle = checkNumber(ap, 'angle');
      const r = checkNumber(rp, 'radius');
      const t0 = (angle * Math.PI) / 180;
      c = { op: 'free', args: [], out: [''], x: r * Math.cos(t0), y: r * Math.sin(t0), polar: true };
      lit = { kind: 'angle', spans: [ap.span], r };
    } else {
      const parts = splitTop(g.inner, g.innerFrom, ',');
      if (parts.length !== 2) throw new ParseError('\\tkzDefPoint expects (x,y) or (angle:radius)', g.from, g.to);
      const x = checkNumber(parts[0]!, 'x');
      const y = checkNumber(parts[1]!, 'y');
      c = { op: 'free', args: [], out: [''], x, y };
      lit = { kind: 'xy', xs: [parts[0]!.span], ys: [parts[1]!.span] };
    }
    const ng = this.readGroup('{', 'allow', 'tkzDefPoint');
    const np = splitTop(ng.inner, ng.innerFrom, ',');
    if (np.length !== 1) throw new ParseError('\\tkzDefPoint defines exactly one point', ng.from, ng.to);
    c.out[0] = checkName(np[0]!);
    this.pushDef(c, { from: t.from, to: ng.to }, [], [np[0]!.span], lit);
  }

  private defPoints(_t: CmdToken) {
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
      this.pushDef({ op: 'free', args: [], out: [name], x, y }, item.span, [], [parts[2]!.span], {
        kind: 'xy',
        xs: [parts[0]!.span],
        ys: [parts[1]!.span],
      });
    }
  }

  /** \tkzDefShiftPoint[A](x,y){B} or \tkzDefShiftPoint[A](angle:r){B} */
  private defShiftPoint(t: CmdToken) {
    const opt = this.readGroup('[', 'allow', 'tkzDefShiftPoint');
    const ref = splitTop(opt.inner, opt.innerFrom, ',');
    if (ref.length !== 1) throw new ParseError('\\tkzDefShiftPoint expects [A]', opt.from, opt.to);
    const a = checkName(ref[0]!);
    const g = this.readGroup('(', 'forbid', 'tkzDefShiftPoint');
    let dx: number;
    let dy: number;
    let polar = false;
    const colon = g.inner.indexOf(':');
    if (colon >= 0 && !g.inner.includes(',')) {
      const angle = checkNumber(splitTop(g.inner.slice(0, colon), g.innerFrom, '\0')[0]!, 'angle');
      const r = checkNumber(splitTop(g.inner.slice(colon + 1), g.innerFrom + colon + 1, '\0')[0]!, 'radius');
      dx = r * Math.cos((angle * Math.PI) / 180);
      dy = r * Math.sin((angle * Math.PI) / 180);
      polar = true;
    } else {
      const parts = splitTop(g.inner, g.innerFrom, ',');
      if (parts.length !== 2) throw new ParseError('\\tkzDefShiftPoint expects (x,y) or (angle:radius)', g.from, g.to);
      dx = checkNumber(parts[0]!, 'x');
      dy = checkNumber(parts[1]!, 'y');
    }
    const ng = this.readGroup('{', 'allow', 'tkzDefShiftPoint');
    const np = splitTop(ng.inner, ng.innerFrom, ',');
    const name = checkName(np[0]!);
    const c: Construction = { op: 'shift', args: [a], out: [name], dx, dy, ...(polar ? { polar: true as const } : {}) };
    this.pushDef(c, { from: t.from, to: ng.to }, [ref[0]!.span], [np[0]!.span]);
  }

  private defPointBy(t: CmdToken) {
    const opt = this.readGroup('[', 'allow', 'tkzDefPointBy');
    const inner = opt.inner;
    const piece = (m: RegExpExecArray, k: number): Piece => {
      const [s0, e0] = m.indices![k]!;
      return { text: m[k]!, span: { from: opt.innerFrom + s0, to: opt.innerFrom + e0 } };
    };
    let make: (p: PointId, out: PointId[]) => Construction;
    let spans: Span[];
    let m: RegExpExecArray | null;
    if ((m = /^\s*projection\s*=\s*onto\s+(\S+?)\s*--\s*(\S+?)\s*$/d.exec(inner)) || (m = /^\s*reflection\s*=\s*over\s+(\S+?)\s*--\s*(\S+?)\s*$/d.exec(inner))) {
      const op = inner.trim().startsWith('projection') ? 'projection' : 'reflection';
      const pa = piece(m, 1);
      const pb = piece(m, 2);
      const a = checkName(pa);
      const b = checkName(pb);
      make = (p, out) => ({ op, args: [p, a, b], out: out as [string] });
      spans = [pa.span, pb.span];
    } else if ((m = /^\s*symmetry\s*=\s*center\s+(\S+?)\s*$/d.exec(inner))) {
      const pc = piece(m, 1);
      const c = checkName(pc);
      make = (p, out) => ({ op: 'symmetry', args: [p, c], out: out as [string] });
      spans = [pc.span];
    } else if ((m = /^\s*homothety\s*=\s*center\s+(\S+?)\s+ratio\s+(.+?)\s*$/d.exec(inner))) {
      const pc = piece(m, 1);
      const c = checkName(pc);
      const k = checkValue(piece(m, 2), 'homothety ratio');
      make = (p, out) => ({ op: 'homothety', args: [p, c], out: out as [string], k });
      spans = [pc.span];
    } else if ((m = /^\s*rotation\s*=\s*center\s+(\S+?)\s+angle\s+(.+?)\s*$/d.exec(inner))) {
      const pc = piece(m, 1);
      const c = checkName(pc);
      const angle = checkValue(piece(m, 2), 'rotation angle');
      make = (p, out) => ({ op: 'rotation', args: [p, c], out: out as [string], angle });
      spans = [pc.span];
    } else if ((m = /^\s*translation\s*=\s*from\s+(\S+?)\s+to\s+(\S+?)\s*$/d.exec(inner))) {
      const pa = piece(m, 1);
      const pb = piece(m, 2);
      const a = checkName(pa);
      const b = checkName(pb);
      make = (p, out) => ({ op: 'translation', args: [p, a, b], out: out as [string] });
      spans = [pa.span, pb.span];
    } else {
      throw new ParseError(
        '\\tkzDefPointBy supports [projection=onto A--B], [reflection=over A--B], [symmetry=center C], [homothety=center C ratio k], [rotation=center C angle a] and [translation=from A to B]',
        opt.from,
        opt.to,
      );
    }
    const g = this.readGroup('(', 'forbid', 'tkzDefPointBy');
    const p = nameList(g, 1, 1, 'tkzDefPointBy');
    this.finishDef(t, (out) => make(p.names[0]!, out), [p.spans[0]!, ...spans], 1);
  }

  private defLine(t: CmdToken) {
    const opt = this.readGroup('[', 'allow', 'tkzDefLine');
    const tangent = /^\s*tangent\s+at\s*=\s*(\S+?)\s*$/d.exec(opt.inner);
    if (tangent) {
      const [s0, e0] = tangent.indices![1]!;
      const cSpan = { from: opt.innerFrom + s0, to: opt.innerFrom + e0 };
      const c = checkName({ text: tangent[1]!, span: cSpan });
      const g = this.readGroup('(', 'forbid', 'tkzDefLine');
      const l = nameList(g, 1, 1, 'tkzDefLine');
      return this.finishDef(t, (out) => ({ op: 'tangentAt', args: [c, l.names[0]!], out: out as [string] }), [cSpan, ...l.spans], 1);
    }
    const m = /^\s*(orthogonal|perpendicular|parallel)\s*=\s*through\s+(\S+?)\s*$/d.exec(opt.inner);
    if (!m) {
      throw new ParseError(
        'Only [orthogonal=through C], [parallel=through C] and [tangent at=C] are supported for \\tkzDefLine',
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
  private finishDef(t: CmdToken, make: (out: PointId[]) => Construction, argSpans: Span[], count: 1 | 2) {
    const defName = t.name;
    const want = count === 1 ? 'tkzGetPoint' : 'tkzGetPoints';
    const hint = count === 1 ? '\\tkzGetPoint{M}' : '\\tkzGetPoints{P}{Q}';
    const save = this.pos;
    const next = this.skipWs();
    if (!next || next.t !== 'cmd' || !next.name.startsWith('tkzGet')) {
      this.pos = save;
      throw new ParseError(`\\${defName} must be followed by ${hint}`, t.from, t.to);
    }
    const single = next.name === 'tkzGetFirstPoint' || next.name === 'tkzGetSecondPoint';
    if (next.name !== want && !(count === 2 && single)) {
      const why = single
        ? `\\${defName} defines one point: use ${hint}`
        : `\\${defName} defines ${count === 1 ? 'one point' : 'two points'}: use ${hint}`;
      this.pos++;
      throw new ParseError(why, next.from, next.to);
    }
    this.pos++;
    const outs: Piece[] = [];
    let end = next.to;
    for (let k = 0; k < (single ? 1 : count); k++) {
      const g = this.readGroup('{', 'allow', next.name);
      const pieces = splitTop(g.inner, g.innerFrom, ',');
      if (pieces.length !== 1) throw new ParseError(`\\${next.name} expects one name per {…}`, g.from, g.to);
      outs.push(pieces[0]!);
      end = g.to;
    }
    let names = outs.map(checkName);
    let outSpans = outs.map((o) => o.span);
    if (single) {
      // the other intersection point gets an internal name
      const first = next.name === 'tkzGetFirstPoint';
      names = first ? [names[0]!, this.aux()] : [this.aux(), names[0]!];
      outSpans = first ? [outSpans[0]!, outSpans[0]!] : [outSpans[0]!, outSpans[0]!];
    }
    if (count === 2 && names[0] === names[1]) {
      throw new ParseError(`Both intersection points are named "${names[0]}"`, outs[1]!.span.from, outs[1]!.span.to);
    }
    this.pushDef(make(names), { from: t.from, to: end }, argSpans, outSpans);
  }

  private pushDef(c: Construction, span: Span, argSpans: Span[], outSpans: Span[], lit?: Literal) {
    const st: DefStatement = { type: 'def', c, span, argSpans, outSpans, ...(lit ? { lit } : {}) };
    this.statements.push(st);
  }

  // ---------------------------------------------------------------- drawings

  private draw(t: CmdToken, cmd: DrawCmd, min: number, max: number) {
    const opt = this.optGroup();
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', cmd);
    const l = nameList(g, min, max, cmd);
    this.pushDraw({ cmd, options: opt ? opt.inner.trim() : null, groups: [l.names] }, { from: t.from, to: g.to }, [l.spans]);
  }

  private labelPoint(t: CmdToken) {
    const cmd = 'tkzLabelPoint';
    const opt = this.optGroup();
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', cmd);
    const l = nameList(g, 1, 1, cmd);
    const tg = this.readGroup('{', 'allow', cmd);
    this.pushDraw(
      { cmd, options: opt ? opt.inner.trim() : null, groups: [l.names], text: tg.inner.trim() },
      { from: t.from, to: tg.to },
      [l.spans],
    );
  }

  /** \tkzDrawSegments(A,B B,C) and the other commands taking space-separated pairs. */
  private drawPairs(t: CmdToken, cmd: DrawCmd) {
    const opt = this.optGroup();
    const g = this.readGroup('(', opt ? 'forbid' : 'allow', cmd);
    const items = splitWs(g.inner, g.innerFrom);
    if (items.length === 0) throw new ParseError(`\\${cmd} needs at least one pair A,B`, g.from, g.to);
    const groups: PointId[][] = [];
    const refSpans: Span[][] = [];
    for (const it of items) {
      const parts = splitTop(it.text, it.span.from, ',');
      if (parts.length !== 2 || parts.some((p) => p.text === '')) {
        throw new ParseError(
          `\\${cmd} expects space-separated pairs like "A,B B,C" (no spaces inside a pair); got "${it.text}"`,
          it.span.from,
          it.span.to,
        );
      }
      groups.push(parts.map(checkName));
      refSpans.push(parts.map((p) => p.span));
    }
    this.pushDraw({ cmd, options: opt ? opt.inner.trim() : null, groups }, { from: t.from, to: g.to }, refSpans);
  }

  private pushDraw(d: DrawingSpec, span: Span, refSpans: Span[][]) {
    const st: DrawStatement = { type: 'draw', d, span, refSpans };
    this.statements.push(st);
  }

  // ---------------------------------------------------------------- plain TikZ

  private defineColor(t: CmdToken) {
    const n = this.readGroup('{', 'allow', 'definecolor');
    const model = this.readGroup('{', 'allow', 'definecolor');
    const val = this.readGroup('{', 'allow', 'definecolor');
    const m = model.inner.trim();
    let css: string | null = null;
    if (m === 'HTML') css = /^[0-9A-Fa-f]{6}$/.test(val.inner.trim()) ? `#${val.inner.trim()}` : null;
    else {
      const nums = val.inner.split(',').map((x) => Number(x.trim()));
      if (nums.every(Number.isFinite)) css = COLOR_MODELS[m]?.(nums) ?? null;
    }
    if (!css) {
      this.diag('warning', `Colour model "${m}" is not supported; ${n.inner.trim()} is drawn black`, t.from, val.to, 'ignored');
      return;
    }
    this.colors[n.inner.trim()] = css;
  }

  /** Resolve a TikZ coordinate to a point name, creating steps for literals and calc expressions. */
  private coordPoint(c: TCoord, prev: PointId | null, name?: PointId): PointId {
    const def = (cons: Construction, args: Span[]) => {
      cons.out[0] = name ?? this.aux();
      this.pushDef(cons, c.span, args, [c.span]);
      return cons.out[0];
    };
    switch (c.k) {
      case 'name':
        if (name) return def({ op: 'shift', args: [c.name], out: [''], dx: 0, dy: 0 }, [c.span]);
        return c.name;
      case 'xy': {
        const x = c.x.value;
        const y = c.y.value;
        const lit = c.x.span && c.y.span ? { xs: [c.x.span], ys: [c.y.span] } : null;
        if (!name) {
          const key = `${x},${y}`;
          const known = this.literalPoints.get(key);
          if (known) {
            if (known.lit?.kind === 'xy' && lit) {
              known.lit.xs.push(...lit.xs);
              known.lit.ys.push(...lit.ys);
            }
            return known.c.out[0];
          }
        }
        const st: DefStatement = {
          type: 'def',
          c: { op: 'free', args: [], out: [name ?? this.aux()], x, y },
          span: c.span,
          argSpans: [],
          outSpans: [c.span],
          ...(lit ? { lit: { kind: 'xy' as const, ...lit } } : {}),
        };
        this.statements.push(st);
        if (!name) this.literalPoints.set(`${x},${y}`, st);
        return st.c.out[0];
      }
      case 'polar': {
        const a = (c.angle.value * Math.PI) / 180;
        const r = c.r.value;
        const cons: Construction = { op: 'free', args: [], out: [name ?? this.aux()], x: r * Math.cos(a), y: r * Math.sin(a), polar: true };
        this.pushDef(cons, c.span, [], [c.span], c.angle.span ? { kind: 'angle', spans: [c.angle.span], r } : undefined);
        return cons.out[0];
      }
      case 'partway': {
        const a = this.coordPoint(c.a, prev);
        const b = this.coordPoint(c.b, prev);
        if (c.t === 0.5) return def({ op: 'midpoint', args: [a, b], out: [''] }, [c.a.span, c.b.span]);
        return def({ op: 'homothety', args: [b, a], out: [''], k: c.t }, [c.b.span, c.a.span]);
      }
      case 'proj': {
        const a = this.coordPoint(c.a, prev);
        const p = this.coordPoint(c.p, prev);
        const b = this.coordPoint(c.b, prev);
        return def({ op: 'projection', args: [p, a, b], out: [''] }, [c.p.span, c.a.span, c.b.span]);
      }
      case 'add':
      case 'rel': {
        const base = c.k === 'add' ? this.coordPoint(c.a, prev) : prev;
        if (!base) throw new ParseError('A relative coordinate needs a previous point', c.span.from, c.span.to);
        const d = c.d;
        if (d.k === 'xy') return def({ op: 'shift', args: [base], out: [''], dx: d.x.value, dy: d.y.value }, [c.span]);
        if (d.k === 'polar') {
          const a = (d.angle.value * Math.PI) / 180;
          return def({ op: 'shift', args: [base], out: [''], dx: d.r.value * Math.cos(a), dy: d.r.value * Math.sin(a), polar: true }, [c.span]);
        }
        throw new ParseError('Only (x,y) and (angle:r) offsets are supported', d.span.from, d.span.to);
      }
      case 'inter': {
        const [a, b, cc, d] = c.pts.map((q) => this.coordPoint(q, prev));
        return def({ op: 'interLL', args: [a!, b!, cc!, d!], out: [''] }, c.pts.map((q) => q.span));
      }
    }
  }

  /** "label=above right:$A$" inside the options of \coordinate. */
  private labelOption(options: string | null, at: PointId, span: Span) {
    if (!options) return;
    const m = /(?:^|,)\s*label\s*=\s*(?:\{([^}]*)\}|([^,]*))/.exec(options);
    if (!m) return;
    const spec = (m[1] ?? m[2] ?? '').trim();
    const colon = spec.indexOf(':');
    const pos = colon >= 0 ? spec.slice(0, colon).trim() : 'above';
    const text = colon >= 0 ? spec.slice(colon + 1).trim() : spec;
    if (!text) return;
    this.pushDraw({ cmd: 'tkzLabelPoint', options: pos, groups: [[at]], text, src: 'tikz' }, span, [[span]]);
  }

  private tikzCoordinate(t: CmdToken) {
    const body = this.untilSemicolon('coordinate');
    const m = /^\s*(?:\[([^\]]*)\])?\s*\(\s*([A-Za-z0-9_']+)\s*\)\s*at\s*\(/.exec(body.text);
    if (!m) throw new ParseError('Expected \\coordinate (name) at (…);', t.from, body.end);
    const open = body.text.indexOf('(', m[0].length - 1);
    const close = matching(body.text, open);
    if (close < 0) throw new ParseError('Unclosed "(" in \\coordinate', body.from + open, body.from + open + 1);
    const c = parseCoordInner(body.text.slice(open + 1, close), body.from + open + 1, { from: body.from + open, to: body.from + close + 1 });
    const name = m[2]!;
    const span = { from: t.from, to: body.end };
    this.coordPoint(c, null, name);
    // the statement span covers the whole command for hover
    const last = this.statements[this.statements.length - 1];
    if (last?.type === 'def') last.span = span;
    this.labelOption(m[1] ?? null, name, span);
  }

  private tikzNode(t: CmdToken) {
    const body = this.untilSemicolon('node');
    const span = { from: t.from, to: body.end };
    const items = parsePath(`node${body.text}`, body.from - 4);
    const node = items[0];
    if (!node || node.k !== 'node' || !node.at) throw new ParseError('Expected \\node[…] at (…) {text};', t.from, body.end);
    const at = this.coordPoint(node.at, null);
    if (node.text) this.pushDraw({ cmd: 'tkzLabelPoint', options: node.options, groups: [[at]], text: node.text, src: 'tikz' }, span, [[node.at.span]]);
  }

  private tikzPic(t: CmdToken) {
    const body = this.untilSemicolon('pic');
    const span = { from: t.from, to: body.end };
    const m = /^\s*(?:\[([^\]]*)\])?\s*\{\s*(right angle|angle)\s*=\s*([A-Za-z0-9_']+)\s*--\s*([A-Za-z0-9_']+)\s*--\s*([A-Za-z0-9_']+)\s*\}\s*$/.exec(body.text);
    if (!m) {
      this.diag('warning', 'Only \\pic {angle = A--B--C} and {right angle = A--B--C} are drawn', t.from, body.end, 'ignored');
      return;
    }
    const names = [m[3]!, m[4]!, m[5]!];
    const refs = names.map((n) => {
      const i = body.text.indexOf(n, body.text.indexOf('='));
      return { from: body.from + i, to: body.from + i + n.length };
    });
    this.pushDraw(
      { cmd: m[2] === 'angle' ? 'tkzMarkAngle' : 'tkzMarkRightAngle', options: m[1]?.trim() || null, groups: [names], src: 'tikz' },
      span,
      [refs],
    );
  }

  /** \draw / \fill / \filldraw / \path with a path made of coordinates, --, cycle, circle and nodes. */
  private tikzPath(t: CmdToken) {
    const body = this.untilSemicolon(t.name);
    const span = { from: t.from, to: body.end };
    let text = body.text;
    let from = body.from;
    let options: string | null = null;
    const lead = /^\s*\[/.exec(text);
    if (lead) {
      const open = lead[0].length - 1;
      const close = matching(text, open);
      if (close < 0) throw new ParseError(`Unclosed "[" in \\${t.name}`, from + open, from + open + 1);
      options = text.slice(open + 1, close).trim();
      text = text.slice(close + 1);
      from += close + 1;
    }
    if (options && /(^|,)\s*(shift|xshift|yshift|scale|rotate|decorate|postaction)\b/.test(options)) {
      this.diag('warning', `\\${t.name} with "${options.match(/(shift|xshift|yshift|scale|rotate|decorate|postaction)/)![0]}" is not drawn by the preview`, t.from, body.end, 'ignored');
      return;
    }
    let items;
    try {
      items = parsePath(text, from);
    } catch (e) {
      if (e instanceof TikzError && /arc|rectangle|controls|to|grid|parabola|sin|cos|-\||\|-|\.\./.test(e.message)) {
        this.diag('warning', `${e.message}; this \\${t.name} is not drawn`, t.from, body.end, 'ignored');
        return;
      }
      throw e;
    }
    const fill = t.name === 'fill' || t.name === 'filldraw' || /(^|,)\s*fill\s*=/.test(options ?? '');
    const stroke = t.name !== 'fill' && t.name !== 'path';
    const opts = t.name === 'fill' ? (options ? `fill, ${options}` : 'fill') : options;
    let run: { name: PointId; span: Span }[] = [];
    let prev: PointId | null = null;
    let pendingLine = false;
    const flush = (closed: boolean) => {
      if (run.length >= 2 && (stroke || fill)) {
        const names = run.map((r) => r.name);
        const refs = run.map((r) => r.span);
        let cmd: DrawCmd;
        if (closed) cmd = stroke ? 'tkzDrawPolygon' : 'tkzFillPolygon';
        else cmd = run.length === 2 ? 'tkzDrawSegment' : 'tkzDrawPolySeg';
        this.pushDraw({ cmd, options: opts, groups: [names], src: 'tikz' }, span, [refs]);
      }
      run = [];
    };
    for (const it of items) {
      switch (it.k) {
        case 'coord': {
          const name = this.coordPoint(it.c, prev);
          if (!pendingLine) flush(false);
          run.push({ name, span: it.c.span });
          prev = name;
          pendingLine = false;
          break;
        }
        case 'line':
          pendingLine = true;
          break;
        case 'cycle':
          flush(true);
          pendingLine = false;
          break;
        case 'circle': {
          if (!prev) throw new ParseError('"circle" needs a centre before it', it.span.from, it.span.to);
          flush(false);
          const small = it.r <= 0.1 && fill;
          if (small) {
            // a filled dot: \fill (A) circle (1pt)
            this.pushDraw({ cmd: 'tkzDrawPoint', options: opts, groups: [[prev]], src: 'tikz' }, span, [[it.span]]);
          } else {
            const through = this.aux();
            this.pushDef({ op: 'shift', args: [prev], out: [through], dx: it.r, dy: 0 }, it.span, [it.span], [it.span]);
            this.pushDraw({ cmd: stroke ? 'tkzDrawCircle' : 'tkzFillCircle', options: opts, groups: [[prev, through]], src: 'tikz' }, span, [[it.span, it.span]]);
          }
          break;
        }
        case 'node': {
          const at = it.at ? this.coordPoint(it.at, prev) : prev;
          if (!at) throw new ParseError('A node needs a position', it.span.from, it.span.to);
          if (it.text) {
            const lo = [options, it.options].filter((o) => o).join(', ') || null;
            this.pushDraw({ cmd: 'tkzLabelPoint', options: lo, groups: [[at]], text: it.text, src: 'tikz' }, span, [[it.span]]);
          }
          break;
        }
      }
    }
    flush(false);
  }

  // ---------------------------------------------------------------- wrappers

  private env(t: CmdToken) {
    const g = this.readGroup('{', 'allow', t.name);
    const envName = g.inner.trim();
    if (envName === 'asy' || envName === 'asydef') {
      throw new ParseError('Asymptote code: switch the language to Asymptote', t.from, g.to);
    }
    if (!TRANSPARENT_ENVS.has(envName)) {
      this.diag('warning', `Environment "${envName}" is ignored (its content is still read)`, t.from, g.to, 'ignored');
    }
    if (t.name === 'begin' && (envName === 'tikzpicture' || envName === 'scope')) {
      const save = this.pos;
      const opt = this.optGroup();
      if (opt && opt.inner.trim() !== '') {
        // a uniform scale doesn't change the figure (the preview fits it to the view anyway)
        const keys = opt.inner.match(/\b(xscale|yscale|rotate|shift|xshift|yshift)\b/g);
        if (keys) {
          this.diag('warning', `${envName} options (${[...new Set(keys)].join(', ')}) are ignored by the preview`, opt.from, opt.to);
        }
      } else if (!opt) {
        this.pos = save;
      }
    } else if (t.name === 'begin' && envName === 'minipage') {
      this.optGroup();
      this.optBrace();
    }
  }
}

export function parse(src: string): ParseResult {
  return new Parser(src).run();
}

/** Point-name helper also used by other front ends. */
export { parseNum };
