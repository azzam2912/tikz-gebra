// Tokenizer + recursive-descent parser for the Asymptote subset.
// Offsets are absolute positions in the editor text (`base` is added to every span).

import type { Diagnostic, Span } from '../parser/ast';
import { makeLineIndex } from '../parser/parser';
import { TYPES, type Declarator, type Expr, type Stmt } from './ast';

type Tok =
  | { t: 'num'; v: number; from: number; to: number }
  | { t: 'str'; v: string; from: number; to: number }
  | { t: 'id'; v: string; from: number; to: number }
  | { t: 'op'; v: string; from: number; to: number }
  | { t: 'eof'; from: number; to: number };

const OPS = ['^^', '--', '..', '::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '++', '+', '-', '*', '/', '^', '(', ')', '[', ']', '{', '}', ',', ';', '=', '.', '<', '>', '!', '?', ':', '&', '|', '%', '#', '@'];

export class AsyError extends Error {
  constructor(
    message: string,
    public from: number,
    public to: number,
  ) {
    super(message);
  }
}

export function lex(src: string, base: number): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    const start = i;
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      toks.push({ t: 'num', v: Number(m[0]), from: base + start, to: base + i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      while (i < n && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      toks.push({ t: 'id', v: src.slice(start, i), from: base + start, to: base + i });
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      let v = '';
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && src[i + 1] === c) {
          v += c;
          i += 2;
          continue;
        }
        v += src[i];
        i++;
      }
      if (i >= n) throw new AsyError('Unclosed string', base + start, base + start + 1);
      i++;
      toks.push({ t: 'str', v, from: base + start, to: base + i });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new AsyError(`Unexpected character "${c}"`, base + i, base + i + 1);
    i += op.length;
    toks.push({ t: 'op', v: op, from: base + start, to: base + i });
  }
  toks.push({ t: 'eof', from: base + n, to: base + n });
  return toks;
}

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
  '^^': 5, '--': 6, '..': 6, '+': 7, '-': 7, '*': 8, '/': 8, '%': 8,
};

export interface AsyParse {
  stmts: Stmt[];
  diagnostics: Diagnostic[];
}

class P {
  private i = 0;
  constructor(private toks: Tok[]) {}

  peek(o = 0): Tok {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)]!;
  }
  next(): Tok {
    return this.toks[this.i++]!;
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'op' && t.v === v;
  }
  eat(v: string): Tok {
    const t = this.peek();
    if (t.t !== 'op' || t.v !== v) {
      throw new AsyError(`Expected "${v}"${t.t === 'eof' ? ' before the end' : ''}`, t.from, Math.max(t.to, t.from + 1));
    }
    return this.next();
  }
  atEnd() {
    return this.peek().t === 'eof';
  }

  /** Skip to just after the next ";" (or "}") at depth 0 — error recovery. */
  recover() {
    let depth = 0;
    while (!this.atEnd()) {
      const t = this.next();
      if (t.t !== 'op') continue;
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') {
        depth--;
        if (depth < 0) return;
      } else if (t.v === ';' && depth <= 0) return;
    }
  }

  statement(): Stmt | null {
    const t = this.peek();
    if (t.t === 'op' && (t.v === ';' || t.v === '{' || t.v === '}')) {
      this.next();
      return null;
    }
    if (t.t === 'id' && (t.v === 'import' || t.v === 'include' || t.v === 'access' || t.v === 'from')) {
      const start = t.from;
      while (!this.atEnd() && !this.isOp(';')) this.next();
      const end = this.eat(';').to;
      return { k: 'import', span: { from: start, to: end } };
    }
    if (t.t === 'id' && ['for', 'while', 'do', 'if', 'struct', 'return', 'typedef', 'else'].includes(t.v)) {
      this.recoverBlock();
      return { k: 'unsupported', what: t.v, span: { from: t.from, to: this.toks[this.i - 1]!.to } };
    }
    // declaration: TYPE name ...   (a function definition "TYPE name(" is not supported)
    if (t.t === 'id' && TYPES.has(t.v) && this.peek(1).t === 'id' && !this.isOp('(', 2)) {
      return this.declaration(false);
    }
    // array declaration: TYPE[] name = ...
    if (t.t === 'id' && TYPES.has(t.v) && this.isOp('[', 1) && this.isOp(']', 2) && this.peek(3).t === 'id') {
      return this.declaration(true);
    }
    if (t.t === 'id' && TYPES.has(t.v) && this.peek(1).t === 'id' && this.isOp('(', 2)) {
      this.recoverBlock();
      return { k: 'unsupported', what: 'function definitions', span: { from: t.from, to: this.toks[this.i - 1]!.to } };
    }
    const e = this.expr();
    if (this.isOp('=')) {
      this.next();
      const value = this.expr();
      const end = this.eat(';').to;
      return { k: 'assign', target: e, value, span: { from: e.span.from, to: end } };
    }
    if (this.isOp('+=') || this.isOp('-=') || this.isOp('*=') || this.isOp('/=')) {
      const op = this.next();
      throw new AsyError(`"${(op as { v: string }).v}" is not supported`, op.from, op.to);
    }
    const end = this.eat(';').to;
    return { k: 'expr', e, span: { from: e.span.from, to: end } };
  }

  /** Skip a for/while/if/function construct including its body. */
  private recoverBlock() {
    let depth = 0;
    let sawBrace = false;
    while (!this.atEnd()) {
      const t = this.next();
      if (t.t !== 'op') continue;
      if (t.v === '(' || t.v === '[') depth++;
      else if (t.v === ')' || t.v === ']') depth--;
      else if (t.v === '{') {
        depth++;
        sawBrace = true;
      } else if (t.v === '}') {
        depth--;
        if (depth === 0 && sawBrace) return;
      } else if (t.v === ';' && depth === 0 && !sawBrace) return;
    }
  }

  private declaration(arrayType: boolean): Stmt {
    const typeTok = this.next() as Extract<Tok, { t: 'id' }>;
    if (arrayType) {
      this.next();
      this.next();
    }
    const decls: Declarator[] = [];
    for (;;) {
      const nt = this.next();
      if (nt.t !== 'id') throw new AsyError('Expected a variable name', nt.from, nt.to);
      let array = arrayType;
      if (this.isOp('[') && this.isOp(']', 1)) {
        this.next();
        this.next();
        array = true;
      }
      let init: Expr | null = null;
      if (this.isOp('=')) {
        this.next();
        init = this.expr();
      }
      decls.push({ name: nt.v, nameSpan: { from: nt.from, to: nt.to }, array, init });
      if (this.isOp(',')) {
        this.next();
        continue;
      }
      break;
    }
    const end = this.eat(';').to;
    return { k: 'decl', type: typeTok.v, decls, span: { from: typeTok.from, to: end } };
  }

  expr(minPrec = 0): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') break;
      // "..controls" / "::" etc. are not supported
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      if ((t.v === '--' || t.v === '..') && this.peek().t === 'id' && (this.peek() as { v: string }).v === 'cycle') {
        const c = this.next();
        left = { k: 'bin', op: t.v as '--', a: left, b: { k: 'cycle', span: { from: c.from, to: c.to } }, span: { from: left.span.from, to: c.to } };
        continue;
      }
      const right = this.expr(prec + 1);
      left = { k: 'bin', op: t.v as '+', a: left, b: right, span: { from: left.span.from, to: right.span.to } };
    }
    if (this.isOp('?')) {
      const q = this.next();
      throw new AsyError('The "? :" operator is not supported', q.from, q.to);
    }
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) {
      this.next();
      const e = this.unary();
      return { k: 'unary', op: t.v as '-', e, span: { from: t.from, to: e.span.to } };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.next();
      const exp = this.unary();
      return { k: 'bin', op: '^', a: base, b: exp, span: { from: base.span.from, to: exp.span.to } };
    }
    return base;
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp('(') && (e.k === 'id' || e.k === 'member')) {
        const open = this.next();
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            // keyword arguments "name=value": keep the value only
            if (this.peek().t === 'id' && this.isOp('=', 1)) {
              this.next();
              this.next();
            }
            args.push(this.expr());
            if (this.isOp(',')) {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.eat(')');
        void open;
        const fn = e.k === 'id' ? e.name : `${exprName(e)}`;
        e = { k: 'call', fn, args, span: { from: e.span.from, to: close.to }, fnSpan: e.span };
        continue;
      }
      if (this.isOp('[')) {
        this.next();
        const index = this.expr();
        const close = this.eat(']');
        e = { k: 'index', obj: e, index, span: { from: e.span.from, to: close.to } };
        continue;
      }
      if (this.isOp('.') && this.peek(1).t === 'id') {
        this.next();
        const nt = this.next() as Extract<Tok, { t: 'id' }>;
        e = { k: 'member', obj: e, name: nt.v, span: { from: e.span.from, to: nt.to } };
        continue;
      }
      // implicit multiplication: 2A, 3dir(45), 2(A+B)
      if (e.k === 'num') {
        const nt = this.peek();
        if ((nt.t === 'id' && !BIN_WORDS.has(nt.v)) || (nt.t === 'op' && nt.v === '(')) {
          const right = this.postfix();
          e = { k: 'bin', op: '*', a: e, b: right, span: { from: e.span.from, to: right.span.to } };
          continue;
        }
      }
      break;
    }
    return e;
  }

  private primary(): Expr {
    const t = this.next();
    const span = { from: t.from, to: t.to };
    if (t.t === 'num') return { k: 'num', v: t.v, span };
    if (t.t === 'str') return { k: 'str', v: t.v, span };
    if (t.t === 'id') {
      if (t.v === 'cycle') return { k: 'cycle', span };
      return { k: 'id', name: t.v, span };
    }
    if (t.t === 'op' && t.v === '(') {
      // cast: (point)O, (pair)P
      if (this.peek().t === 'id' && TYPES.has((this.peek() as { v: string }).v) && this.isOp(')', 1) && !this.isOp(')', 2) && !this.isBinaryAt(2)) {
        const type = (this.next() as { v: string }).v;
        this.next();
        const e = this.unary();
        return { k: 'cast', type, e, span: { from: t.from, to: e.span.to } };
      }
      const a = this.expr();
      if (this.isOp(',')) {
        this.next();
        const b = this.expr();
        const close = this.eat(')');
        return { k: 'pair', x: a, y: b, span: { from: t.from, to: close.to } };
      }
      const close = this.eat(')');
      return { ...a, span: { from: t.from, to: close.to } };
    }
    if (t.t === 'eof') throw new AsyError('Unexpected end of the code', t.from, t.to);
    throw new AsyError(`Unexpected "${(t as { v: string }).v}"`, t.from, t.to);
  }

  private isBinaryAt(o: number): boolean {
    const t = this.peek(o);
    return t.t === 'op' && (t.v in BIN_PREC || t.v === ';' || t.v === ',' || t.v === ']');
  }
}

const BIN_WORDS = new Set(['cycle']);
export type { Tok };

function exprName(e: Expr): string {
  if (e.k === 'id') return e.name;
  if (e.k === 'member') return `${exprName(e.obj)}.${e.name}`;
  return '?';
}

/** Parse a single expression (the whole token list); null when tokens are left over. */
export function parseExpression(toks: ReturnType<typeof lex>): Expr | null {
  const p = new P(toks);
  const e = p.expr();
  return p.atEnd() ? e : null;
}

/** Parse Asymptote code (already cut out of the LaTeX wrapper). `base` = offset of src[0] in the editor text. */
export function parseAsy(src: string, base: number, fullText: string): AsyParse {
  const lineOf = makeLineIndex(fullText);
  const diagnostics: Diagnostic[] = [];
  const err = (e: AsyError) =>
    diagnostics.push({ severity: 'error', message: e.message, from: e.from, to: Math.max(e.to, e.from + 1), line: lineOf(e.from) });
  let toks: Tok[];
  try {
    toks = lex(src, base);
  } catch (e) {
    if (!(e instanceof AsyError)) throw e;
    err(e);
    return { stmts: [], diagnostics };
  }
  const p = new P(toks);
  const stmts: Stmt[] = [];
  while (!p.atEnd()) {
    try {
      const s = p.statement();
      if (s) stmts.push(s);
    } catch (e) {
      if (!(e instanceof AsyError)) throw e;
      err(e);
      p.recover();
    }
  }
  return { stmts, diagnostics };
}

export type { Span };
