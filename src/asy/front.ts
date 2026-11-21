// Asymptote → construction graph statements.
//
// A small symbolic interpreter: pair variables become construction steps. Calls that have a
// tkz-euclide counterpart (foot, extension, midpoint, circumcenter, rotate(..)*P, 2*I-A, …)
// become the matching construction; any other pair expression becomes an `expr` step that is
// evaluated numerically. Literal pairs ((x,y), dir(a), r*dir(a)) are the draggable free points.

import type { Construction, DefStatement, Diagnostic, DrawCmd, DrawingSpec, InterOrder, Literal, ParseResult, PointId, Span, Statement } from '../parser/ast';
import { makeLineIndex } from '../parser/parser';
import { ASY_PEN_FUNCTIONS, ASY_PEN_WORDS } from '../style';
import type { Expr, Stmt } from './ast';
import { COMPASS, evalNum, isVec, NUMERIC_FUNCTIONS, type NumVal } from './expr';
import { AsyError, parseAsy } from './parser';

type Val =
  | { t: 'num'; v: number }
  /** real depending on points; e uses k:'pt' nodes */
  | { t: 'real'; e: Expr; deps: Set<PointId> }
  | { t: 'pt'; name: PointId; point?: boolean }
  /** pair expression not (yet) a graph point; deps empty = constant */
  | { t: 'vec'; e: Expr; deps: Set<PointId>; point?: boolean }
  /** `third`: for a triangle side (t.BC), the opposite vertex */
  | { t: 'line'; a: PointId; b: PointId; seg: boolean; third?: PointId }
  /** circle centre c through th; geo = geometry.asy `circle` object, otherwise a path */
  | { t: 'circle'; c: PointId; th: PointId; geo: boolean }
  | { t: 'path'; pts: PointId[]; cycle: boolean }
  | { t: 'multi'; items: Val[] }
  | { t: 'tri'; v: [PointId, PointId, PointId] }
  | { t: 'arr'; items: Val[] }
  | { t: 'mark'; kind: 'right' | 'angle'; pts: [PointId, PointId, PointId] }
  | { t: 'tr'; kind: 'rotate'; angle: number; c: Val | null }
  | { t: 'tr'; kind: 'reflect'; a: PointId; b: PointId }
  | { t: 'tr'; kind: 'shift'; v: Val }
  | { t: 'tr'; kind: 'scale'; k: number; c: Val | null }
  | { t: 'pen'; text: string }
  | { t: 'str'; v: string }
  | { t: 'void' };

/** Statement-level calls that only set up the picture. */
const SETUP_CALLS = new Set([
  'size', 'unitsize', 'defaultpen', 'clip', 'add', 'shipout', 'xaxis', 'yaxis', 'xlimits', 'ylimits', 'usepackage',
  'texpreamble', 'settings', 'pathpen', 'pointpen', 'erase', 'newpage', 'layer', 'label_size', 'currentprojection',
]);
/** Asymptote length units, in bp (only their ratio matters for us). */
const UNITS: Record<string, number> = { pt: 72 / 72.27, bp: 1, cm: 72 / 2.54, mm: 72 / 25.4, inch: 72, inches: 72 };
const ARROWS = new Set(['Arrow', 'Arrows', 'EndArrow', 'BeginArrow', 'MidArrow', 'ArcArrow', 'ArcArrows', 'EndArcArrow', 'BeginArcArrow', 'Bar', 'Bars', 'EndBar', 'BeginBar', 'None', 'NoFill', 'Fill', 'FillDraw', 'UnFill']);

class Fail extends Error {
  constructor(
    message: string,
    public span: Span,
  ) {
    super(message);
  }
}

const pt = (name: PointId, span: Span): Expr => ({ k: 'pt', name, span });
const isNumLit = (e: Expr): boolean => e.k === 'num' || (e.k === 'unary' && e.op === '-' && e.e.k === 'num');
const numLitValue = (e: Expr): number => (e.k === 'num' ? e.v : -(e as { e: { v: number } }).e.v);

/** Linear form Σ k·P + c of a pair expression, or null when it is not linear in the points. */
interface Lin {
  terms: Map<PointId, number>;
  c: { x: number; y: number };
}

function linear(e: Expr): Lin | { real: number } | null {
  switch (e.k) {
    case 'num':
      return { real: e.v };
    case 'pt':
      return { terms: new Map([[e.name, 1]]), c: { x: 0, y: 0 } };
    case 'pair': {
      const x = linear(e.x);
      const y = linear(e.y);
      if (x && y && 'real' in x && 'real' in y) return { terms: new Map(), c: { x: x.real, y: y.real } };
      return null;
    }
    case 'unary': {
      const a = linear(e.e);
      if (!a || e.op === '!') return null;
      return e.op === '+' ? a : scaleLin(a, -1);
    }
    case 'cast':
      return linear(e.e);
    case 'bin': {
      if (e.op === '+' || e.op === '-') {
        const a = linear(e.a);
        const b = linear(e.b);
        if (!a || !b) return null;
        if ('real' in a && 'real' in b) return { real: e.op === '+' ? a.real + b.real : a.real - b.real };
        if ('real' in a || 'real' in b) return null;
        return addLin(a, e.op === '+' ? b : (scaleLin(b, -1) as Lin));
      }
      if (e.op === '*') {
        const a = linear(e.a);
        const b = linear(e.b);
        if (!a || !b) return null;
        if ('real' in a && 'real' in b) return { real: a.real * b.real };
        if ('real' in a) return scaleLin(b, a.real);
        if ('real' in b) return scaleLin(a, b.real);
        return null;
      }
      if (e.op === '/') {
        const a = linear(e.a);
        const b = linear(e.b);
        if (!a || !b || !('real' in b) || b.real === 0) return null;
        return scaleLin(a, 1 / b.real);
      }
      return null;
    }
    case 'id':
    case 'call': {
      const v = evalNum(e, new Map());
      if (typeof v === 'number') return { real: v };
      if (isVec(v)) return { terms: new Map(), c: v };
      return null;
    }
    default:
      return null;
  }
}

function scaleLin(a: Lin | { real: number }, k: number): Lin | { real: number } {
  if ('real' in a) return { real: a.real * k };
  return { terms: new Map([...a.terms].map(([n, v]) => [n, v * k])), c: { x: a.c.x * k, y: a.c.y * k } };
}

function addLin(a: Lin, b: Lin): Lin {
  const terms = new Map(a.terms);
  for (const [n, v] of b.terms) terms.set(n, (terms.get(n) ?? 0) + v);
  for (const [n, v] of terms) if (Math.abs(v) < 1e-12) terms.delete(n);
  return { terms, c: { x: a.c.x + b.c.x, y: a.c.y + b.c.y } };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

class Front {
  readonly statements: Statement[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly colors: Record<string, string> = {};
  private env = new Map<string, Val>();
  /** variables declared in the code (they shadow constants such as E, N, S, W) */
  private declared = new Set<string>();
  /** names used by graph points */
  private names = new Set<PointId>();
  private aux = 0;
  /** anonymous constant points, by value */
  private constants = new Map<string, DefStatement>();
  private lineOf: (o: number) => number;

  /** olympiad.asy is available: imported, or nothing imported at all (AoPS-style snippets) */
  private olympiad: boolean;

  constructor(private text: string) {
    this.lineOf = makeLineIndex(text);
    this.olympiad = /\bimport\s+olympiad\b/.test(text) || !/\bimport\s+geometry\b/.test(text);
  }

  private diag(severity: 'error' | 'warning', message: string, span: Span, code?: Diagnostic['code']) {
    this.diagnostics.push({ severity, message, from: span.from, to: Math.max(span.to, span.from + 1), line: this.lineOf(span.from), ...(code ? { code } : {}) });
  }

  private src(span: Span): string {
    return this.text.slice(span.from, span.to);
  }

  private freshAux(hint = ''): PointId {
    let n: PointId;
    do n = `~${hint}${++this.aux}`;
    while (this.names.has(n));
    return n;
  }

  // ---------------------------------------------------------------- graph output

  private def(c: Construction, span: Span, argSpans: Span[] = [], lit?: Literal): PointId {
    for (const o of c.out) this.names.add(o);
    const st: DefStatement = { type: 'def', c, span, argSpans, outSpans: c.out.map(() => span), ...(lit ? { lit } : {}) };
    this.statements.push(st);
    return c.out[0];
  }

  private draw(d: Omit<DrawingSpec, 'src'>, span: Span) {
    this.statements.push({ type: 'draw', d: { ...d, src: 'asy' }, span, refSpans: d.groups.map((g) => g.map(() => span)) });
  }

  /** Give the point `name` (an internal name) the user's variable name `to`. */
  private rename(name: PointId, to: PointId) {
    if (this.names.has(to)) return;
    const sub = (n: PointId) => (n === name ? to : n);
    for (const st of this.statements) {
      if (st.type === 'def') {
        st.c.out = st.c.out.map(sub) as typeof st.c.out;
        st.c.args = st.c.args.map(sub) as typeof st.c.args;
        if (st.c.op === 'expr') st.c.expr = renameExpr(st.c.expr as Expr, name, to);
      } else {
        st.d.groups = st.d.groups.map((g) => g.map(sub));
        if (st.d.dir && 'of' in st.d.dir && st.d.dir.of === name) st.d.dir = { ...st.d.dir, of: to };
      }
    }
    for (const [k, v] of this.env) this.env.set(k, renameVal(v, name, to));
    this.names.delete(name);
    this.names.add(to);
  }

  // ---------------------------------------------------------------- statements

  run(stmts: Stmt[]): void {
    for (const s of stmts) {
      try {
        this.statement(s);
      } catch (e) {
        if (e instanceof Fail) this.diag('error', e.message, e.span);
        else if (e instanceof AsyError) this.diag('error', e.message, { from: e.from, to: e.to });
        else throw e;
      }
    }
  }

  private statement(s: Stmt) {
    switch (s.k) {
      case 'import':
        return;
      case 'unsupported':
        this.diag('warning', `"${s.what}" is not supported; this part is skipped`, s.span, 'ignored');
        return;
      case 'decl':
        for (const d of s.decls) {
          if (!d.init) {
            if (s.type === 'pen' || s.type === 'string') continue;
            this.env.delete(d.name);
            this.declared.add(d.name);
            continue;
          }
          this.bind(s.type, d.name, d.nameSpan, d.init, d.array, s.span);
        }
        return;
      case 'assign': {
        if (s.target.k !== 'id') throw new Fail('Only assignments to plain variables are supported', s.target.span);
        const name = s.target.name;
        if (name === 'markscalefactor' || name === 'dotfactor' || name === 'arrowsize' || name === 'defaultpen') return;
        const prev = this.env.get(name);
        const type = prev?.t === 'num' || prev?.t === 'real' ? 'real' : prev?.t === 'pen' ? 'pen' : prev?.t === 'circle' ? 'circle' : prev?.t === 'line' ? 'line' : 'auto';
        this.bind(type, name, s.target.span, s.value, false, s.span);
        return;
      }
      case 'expr':
        if (s.e.k !== 'call') {
          this.diag('warning', 'This statement has no effect on the figure', s.span, 'ignored');
          return;
        }
        try {
          this.command(s.e, s.span);
        } catch (e) {
          // a drawing we can't follow is skipped; the rest of the figure still shows
          if (!(e instanceof Fail)) throw e;
          this.diag('warning', `${e.message}; ${s.e.fn}(…) is not drawn`, e.span, 'ignored');
        }
        return;
    }
  }

  private bind(type: string, name: string, nameSpan: Span, init: Expr, array: boolean, span: Span) {
    if (type === 'pen') {
      this.colors[name] = `pen:${this.src(init.span)}`;
      this.env.set(name, { t: 'pen', text: name });
      return;
    }
    const v = this.value(init);
    if (array) {
      if (v.t !== 'arr') throw new Fail(`${name}[] must be initialised with an array (e.g. intersectionpoints(…))`, init.span);
      // give the elements readable internal names (~X0, ~X1 for "pair X[]")
      const items = v.items.map((it, i) => {
        if (it.t !== 'pt' || !it.name.startsWith('~') || this.names.has(`~${name}${i}`)) return it;
        this.rename(it.name, `~${name}${i}`);
        return { t: 'pt' as const, name: `~${name}${i}` };
      });
      this.declared.add(name);
      this.env.set(name, { t: 'arr', items });
      return;
    }
    void nameSpan;
    void span;
    this.declared.add(name);
    if (type === 'pair' || type === 'point' || (type === 'auto' && (v.t === 'vec' || v.t === 'pt'))) {
      const p = this.point(v, init.span, name);
      const isPoint = type === 'point' || ((v.t === 'pt' || v.t === 'vec') && !!v.point);
      this.env.set(name, { t: 'pt', name: p, ...(isPoint ? { point: true } : {}) });
      return;
    }
    if ((type === 'real' || type === 'int') && v.t !== 'num' && v.t !== 'real') throw new Fail(`${name} should be a number`, init.span);
    this.env.set(name, v);
  }

  /** Turn a pair-like value into a graph point. `name` is the variable it is assigned to, if any. */
  private point(v: Val, span: Span, name?: string): PointId {
    if (v.t === 'pt') {
      if (!name || v.name === name) return v.name;
      if (v.name.startsWith('~')) {
        // a computed point gets the name of the variable it is assigned to
        if (this.names.has(name)) this.rename(name, this.freshAux(name));
        this.rename(v.name, name);
        return name;
      }
      // an alias of an already named point: one point, both variables refer to it
      return v.name;
    }
    if (v.t !== 'vec') throw new Fail(`Expected a point here, got ${describe(v)}`, span);
    const out = this.claimName(name);
    // constants: literal → free point (draggable), otherwise a fixed free point
    if (v.deps.size === 0) {
      const lit = literalOf(v.e);
      const val = evalNum(v.e, new Map());
      if (!isVec(val)) throw new Fail('This point evaluates to nothing (degenerate)', span);
      if (!name) {
        const key = `${val.x},${val.y}`;
        const known = this.constants.get(key);
        if (known) {
          if (known.lit?.kind === 'xy' && lit?.kind === 'xy') {
            known.lit.xs.push(...lit.xs);
            known.lit.ys.push(...lit.ys);
          }
          return known.c.out[0];
        }
      }
      const c: Construction = lit?.kind === 'angle'
        ? { op: 'free', args: [], out: [out], x: val.x, y: val.y, polar: true }
        : { op: 'free', args: [], out: [out], x: val.x, y: val.y };
      this.def(c, span, [], lit ?? undefined);
      if (!name) this.constants.set(`${val.x},${val.y}`, this.statements[this.statements.length - 1] as DefStatement);
      return out;
    }
    return this.def(this.construction(v.e, out, span), span);
  }

  private claimName(name?: string): PointId {
    if (!name) return this.freshAux();
    if (this.names.has(name)) {
      // reassigned variable: the old point keeps existing under an internal name
      this.rename(name, this.freshAux(name));
    }
    return name;
  }

  /** Recognise a pair expression (with k:'pt' leaves) as a tkz-euclide construction. */
  private construction(e: Expr, out: PointId, span: Span): Construction {
    const text = this.src(span);
    // C + rotate(90)*(B-A)  → orthogonal through C
    const m1 = matchOrth(e);
    if (m1) return { op: 'orthLine', args: m1, out: [out] };
    const m2 = matchTangent(e);
    if (m2) return { op: 'tangentAt', args: m2, out: [out] };
    const lin = linear(e);
    if (lin && !('real' in lin)) {
      const t = [...lin.terms];
      const c0 = near(lin.c.x, 0) && near(lin.c.y, 0);
      if (t.length === 1 && near(t[0]![1], 1) && !c0) return { op: 'shift', args: [t[0]![0]], out: [out], dx: lin.c.x, dy: lin.c.y };
      if (t.length === 2 && c0 && near(t[0]![1] + t[1]![1], 1)) {
        const [[a, ka], [b, kb]] = t as [[PointId, number], [PointId, number]];
        if (near(ka, 0.5)) return { op: 'midpoint', args: [a, b], out: [out] };
        if (near(ka, 2)) return { op: 'symmetry', args: [b, a], out: [out] };
        if (near(kb, 2)) return { op: 'symmetry', args: [a, b], out: [out] };
        return { op: 'homothety', args: [b, a], out: [out], k: kb };
      }
      if (t.length === 3 && c0) {
        const neg = t.filter(([, k]) => near(k, -1));
        const pos = t.filter(([, k]) => near(k, 1));
        if (neg.length === 1 && pos.length === 2) return { op: 'translation', args: [pos[0]![0], neg[0]![0], pos[1]![0]], out: [out] };
      }
    }
    const deps = new Set<PointId>();
    collectPts(e, deps);
    return { op: 'expr', args: [...deps], out: [out], expr: e, text };
  }

  // ---------------------------------------------------------------- expressions

  /** Evaluate an expression to a symbolic value. */
  value(e: Expr): Val {
    switch (e.k) {
      case 'num':
        return { t: 'num', v: e.v };
      case 'str':
        return { t: 'str', v: e.v };
      case 'pt':
        return { t: 'pt', name: e.name };
      case 'cycle':
        throw new Fail('"cycle" can only end a path', e.span);
      case 'id': {
        const v = this.env.get(e.name);
        if (v) return v;
        if (this.declared.has(e.name)) throw new Fail(`${e.name} is used before it gets a value`, e.span);
        if (e.name in UNITS) return { t: 'num', v: UNITS[e.name]! };
        if (e.name in COMPASS || ['origin', 'up', 'down', 'left', 'right'].includes(e.name)) return { t: 'vec', e, deps: new Set() };
        if (e.name === 'pi') return { t: 'num', v: Math.PI };
        if (e.name === 'unitcircle') return this.circleValue({ t: 'vec', e: { k: 'id', name: 'origin', span: e.span }, deps: new Set() }, { t: 'num', v: 1 }, false, e.span);
        if (ASY_PEN_WORDS.has(e.name) || this.colors[e.name]) return { t: 'pen', text: e.name };
        if (ARROWS.has(e.name)) return { t: 'void' };
        if (e.name === 'markscalefactor') return { t: 'num', v: 0.03 };
        throw new Fail(`Unknown name "${e.name}"`, e.span);
      }
      case 'pair': {
        const x = this.value(e.x);
        const y = this.value(e.y);
        const part = (v: Val, src: Expr): Expr => {
          if (v.t === 'num') return isNumLit(src) ? src : { k: 'num', v: v.v, span: src.span };
          if (v.t === 'real') return v.e;
          throw new Fail('A coordinate must be a number', src.span);
        };
        const deps = new Set<PointId>([...(x.t === 'real' ? x.deps : []), ...(y.t === 'real' ? y.deps : [])]);
        return { t: 'vec', e: { k: 'pair', x: part(x, e.x), y: part(y, e.y), span: e.span }, deps };
      }
      case 'cast': {
        const v = this.value(e.e);
        if (e.type === 'point' && (v.t === 'pt' || v.t === 'vec')) return { ...v, point: true };
        return v;
      }
      case 'unary': {
        const v = this.value(e.e);
        if (e.op === '+') return v;
        if (v.t === 'num') return { t: 'num', v: -v.v };
        if (v.t === 'real' || v.t === 'vec' || v.t === 'pt') return this.arith({ k: 'unary', op: '-', e: this.exprOf(v, e.e.span), span: e.span }, [v]);
        throw new Fail(`Cannot negate ${describe(v)}`, e.span);
      }
      case 'bin':
        return this.binary(e);
      case 'call':
        return this.call(e);
      case 'index': {
        const o = this.value(e.obj);
        const i = this.value(e.index);
        if (o.t !== 'arr' || i.t !== 'num') throw new Fail('Only constant indices into point arrays are supported', e.span);
        const item = o.items[i.v];
        if (!item) throw new Fail(`Index ${i.v} is out of range (the array has ${o.items.length} entries)`, e.span);
        return item;
      }
      case 'member': {
        const o = this.value(e.obj);
        if (o.t === 'circle' && e.name === 'C') return { t: 'pt', name: o.c };
        if (o.t === 'tri' && ['A', 'B', 'C', 'VA', 'VB', 'VC'].includes(e.name)) return { t: 'pt', name: o.v['ABC'.indexOf(e.name.slice(-1))]! };
        if (o.t === 'tri' && /^(AB|BC|CA|BA|CB|AC)$/.test(e.name)) {
          const [i, j] = [...e.name].map((ch) => 'ABC'.indexOf(ch)) as [number, number];
          return { t: 'line', a: o.v[i]!, b: o.v[j]!, seg: true, third: o.v[3 - i - j]! };
        }
        if (o.t === 'line' && (e.name === 'A' || e.name === 'B')) return { t: 'pt', name: e.name === 'A' ? o.a : o.b };
        if ((o.t === 'pt' || o.t === 'vec') && (e.name === 'x' || e.name === 'y')) {
          return this.arith({ k: 'member', obj: this.exprOf(o, e.obj.span), name: e.name, span: e.span }, [o]);
        }
        throw new Fail(`".${e.name}" is not supported here`, e.span);
      }
    }
  }

  /** The expression (k:'pt' leaves) of a pair/real value. */
  private exprOf(v: Val, span: Span): Expr {
    if (v.t === 'num') return { k: 'num', v: v.v, span };
    if (v.t === 'pt') return pt(v.name, span);
    if (v.t === 'vec' || v.t === 'real') return v.e;
    throw new Fail(`Expected a number or a point, got ${describe(v)}`, span);
  }

  /** Build a real/pair result of an arithmetic expression `e` whose operands are `vs`. */
  private arith(e: Expr, vs: Val[]): Val {
    const deps = new Set<PointId>();
    for (const v of vs) {
      if (v.t === 'pt') deps.add(v.name);
      if (v.t === 'vec' || v.t === 'real') v.deps.forEach((d) => deps.add(d));
    }
    // type: evaluate with dummy points to see whether the result is a number or a pair
    const env = new Map<string, NumVal>();
    [...deps].forEach((d, i) => env.set(d, { x: 0.37 + 1.13 * i + 0.7 * i * i, y: 0.61 + 1.9 * Math.sin(2.1 * i + 0.4) }));
    const probe = evalNum(e, env);
    if (typeof probe === 'number') return deps.size ? { t: 'real', e, deps } : { t: 'num', v: probe };
    if (isVec(probe)) return { t: 'vec', e, deps };
    throw new Fail(`Cannot evaluate "${this.src(e.span).slice(0, 40)}"`, e.span);
  }

  private binary(e: Extract<Expr, { k: 'bin' }>): Val {
    if (e.op === '--' || e.op === '..') {
      const left = this.value(e.a);
      const pts: PointId[] = left.t === 'path' ? [...left.pts] : [this.point(left, e.a.span)];
      if (left.t === 'path' && left.cycle) throw new Fail('Nothing can follow "cycle"', e.b.span);
      if (e.b.k === 'cycle') return { t: 'path', pts, cycle: true };
      const right = this.value(e.b);
      if (right.t === 'path') pts.push(...right.pts);
      else pts.push(this.point(right, e.b.span));
      return { t: 'path', pts, cycle: false };
    }
    if (e.op === '^^') {
      const a = this.value(e.a);
      const b = this.value(e.b);
      const items = [...(a.t === 'multi' ? a.items : [a]), ...(b.t === 'multi' ? b.items : [b])];
      return { t: 'multi', items };
    }
    const a = this.value(e.a);
    const b = this.value(e.b);
    if (a.t === 'pen' || b.t === 'pen') return { t: 'pen', text: this.src(e.span) };
    if (e.op === '*' && a.t === 'tr') {
      if (b.t === 'str') return b;
      // rotate(θ)*(B - A): a rotated vector, not a construction on a point
      if (b.t === 'vec' && b.deps.size > 0 && a.kind === 'rotate' && !a.c) {
        const rot: Expr = { k: 'call', fn: 'rotate', args: [{ k: 'num', v: a.angle, span: e.a.span }], span: e.a.span, fnSpan: e.a.span };
        return this.arith({ k: 'bin', op: '*', a: rot, b: b.e, span: e.span }, [b]);
      }
      return this.transform(a, b, e);
    }
    if (e.op === '*' && b.t === 'str') return b;
    if (a.t === 'num' && b.t === 'num') {
      const v = evalNum({ ...e, a: { k: 'num', v: a.v, span: e.a.span }, b: { k: 'num', v: b.v, span: e.b.span } }, new Map());
      if (typeof v !== 'number') throw new Fail('Division by zero', e.span);
      return { t: 'num', v };
    }
    const ex: Expr = { ...e, a: this.exprOf(a, e.a.span), b: this.exprOf(b, e.b.span) };
    return this.arith(ex, [a, b]);
  }

  private transform(tr: Extract<Val, { t: 'tr' }>, v: Val, e: Expr): Val {
    if (v.t === 'path' || v.t === 'circle' || v.t === 'line' || v.t === 'tri') throw new Fail('Transforming paths is not supported; transform the points', e.span);
    const p = this.point(v, e.span);
    switch (tr.kind) {
      case 'rotate': {
        const c = tr.c ? this.point(tr.c, e.span) : this.origin(e.span);
        return { t: 'pt', name: this.def({ op: 'rotation', args: [p, c], out: [this.freshAux()], angle: tr.angle }, e.span) };
      }
      case 'reflect':
        return { t: 'pt', name: this.def({ op: 'reflection', args: [p, tr.a, tr.b], out: [this.freshAux()] }, e.span) };
      case 'scale': {
        const c = tr.c ? this.point(tr.c, e.span) : this.origin(e.span);
        return { t: 'pt', name: this.def({ op: 'homothety', args: [p, c], out: [this.freshAux()], k: tr.k }, e.span) };
      }
      case 'shift': {
        const d = tr.v;
        return this.arith({ k: 'bin', op: '+', a: pt(p, e.span), b: this.exprOf(d, e.span), span: e.span }, [{ t: 'pt', name: p }, d]);
      }
    }
  }

  private origin(span: Span): PointId {
    return this.point({ t: 'vec', e: { k: 'pair', x: { k: 'num', v: 0, span }, y: { k: 'num', v: 0, span }, span }, deps: new Set() }, span);
  }

  /** A circle value from a centre and a radius (number or point-dependent real). */
  private circleValue(centre: Val, r: Val, geo: boolean, span: Span): Val {
    const c = this.point(centre, span);
    if (r.t === 'num') {
      return { t: 'circle', c, th: this.def({ op: 'shift', args: [c], out: [this.freshAux()], dx: r.v, dy: 0 }, span), geo };
    }
    if (r.t === 'real') {
      // abs(X - C) or abs(C - X) with C the centre: the circle goes through X
      const re = r.e;
      if (re.k === 'call' && re.fn === 'abs' && re.args.length === 1 && re.args[0]!.k === 'bin' && re.args[0]!.op === '-') {
        const { a, b } = re.args[0]!;
        if (a.k === 'pt' && b.k === 'pt' && (a.name === c || b.name === c)) return { t: 'circle', c, th: a.name === c ? b.name : a.name, geo };
      }
      const e: Expr = { k: 'bin', op: '+', a: pt(c, span), b: { k: 'pair', x: re, y: { k: 'num', v: 0, span }, span }, span };
      const deps = new Set([c, ...r.deps]);
      return { t: 'circle', c, th: this.def({ op: 'expr', args: [...deps], out: [this.freshAux()], expr: e, text: this.src(span) }, span), geo };
    }
    throw new Fail(`Expected a radius, got ${describe(r)}`, span);
  }

  private pts(args: Expr[], n: number, fn: string, span: Span): PointId[] {
    if (args.length < n) throw new Fail(`${fn} expects ${n} points`, span);
    return args.slice(0, n).map((a) => this.point(this.value(a), a.span));
  }

  private asLine(v: Val, span: Span): Extract<Val, { t: 'line' }> {
    if (v.t === 'line') return v;
    if (v.t === 'path' && v.pts.length === 2 && !v.cycle) return { t: 'line', a: v.pts[0]!, b: v.pts[1]!, seg: true };
    throw new Fail(`Expected a line, got ${describe(v)}`, span);
  }

  private call(e: Extract<Expr, { k: 'call' }>): Val {
    const fn = e.fn;
    const args = e.args;
    const span = e.span;
    const P = (n: number) => this.pts(args, n, fn, span);
    const userVal = this.env.get(fn);
    if (userVal) throw new Fail(`"${fn}" is a variable, not a function`, e.fnSpan);
    switch (fn) {
      case 'foot': {
        const [p, a, b] = P(3);
        return { t: 'pt', name: this.def({ op: 'projection', args: [p!, a!, b!], out: [this.freshAux()] }, span) };
      }
      case 'extension': {
        const [a, b, c, d] = P(4);
        return { t: 'pt', name: this.def({ op: 'interLL', args: [a!, b!, c!, d!], out: [this.freshAux()] }, span) };
      }
      case 'midpoint': {
        const v = args[0] ? this.value(args[0]) : null;
        if (args.length === 1 && v?.t === 'path' && v.pts.length === 2) {
          return { t: 'pt', name: this.def({ op: 'midpoint', args: [v.pts[0]!, v.pts[1]!], out: [this.freshAux()] }, span) };
        }
        if (args.length === 1 && v?.t === 'line') return { t: 'pt', name: this.def({ op: 'midpoint', args: [v.a, v.b], out: [this.freshAux()] }, span) };
        if (args.length === 2) {
          const [a, b] = P(2);
          return { t: 'pt', name: this.def({ op: 'midpoint', args: [a!, b!], out: [this.freshAux()] }, span) };
        }
        throw new Fail('midpoint expects a segment A--B', span);
      }
      case 'circumcenter':
      case 'incenter':
      case 'orthocenter':
      case 'centroid':
      case 'excenter': {
        let v: PointId[];
        const first = args.length === 1 ? this.value(args[0]!) : null;
        if (first?.t === 'tri') v = [...first.v];
        else if (fn === 'excenter' && first?.t === 'line' && first.third) {
          // geometry.asy excenter(side): the excircle tangent to that side (opposite the third vertex)
          return { t: 'pt', name: this.def({ op: 'center', kind: 'ex', args: [first.a, first.third, first.b], out: [this.freshAux()] }, span) };
        } else v = P(3);
        const kind = ({ circumcenter: 'circum', incenter: 'in', orthocenter: 'ortho', centroid: 'centroid', excenter: 'ex' } as const)[fn];
        // geometry.asy excenter(A,B,C) is opposite C; tkz-euclide's [ex](A,B,C) is opposite B
        const a3 = (fn === 'excenter' ? [v[0]!, v[2]!, v[1]!] : v) as [PointId, PointId, PointId];
        return { t: 'pt', name: this.def({ op: 'center', kind, args: a3, out: [this.freshAux()] }, span) };
      }
      case 'interp': {
        const [a, b] = P(2);
        const t = args[2] ? this.value(args[2]) : null;
        if (t?.t !== 'num') throw new Fail('interp(A,B,t) needs a constant t', span);
        if (near(t.v, 0.5)) return { t: 'pt', name: this.def({ op: 'midpoint', args: [a!, b!], out: [this.freshAux()] }, span) };
        return { t: 'pt', name: this.def({ op: 'homothety', args: [b!, a!], out: [this.freshAux()], k: t.v }, span) };
      }
      case 'line':
      case 'segment': {
        if (args.length === 1) {
          const v = this.value(args[0]!);
          const l = this.asLine(v, span);
          return { ...l, seg: fn === 'segment' };
        }
        const [a, b] = P(2);
        return { t: 'line', a: a!, b: b!, seg: fn === 'segment' };
      }
      case 'perpendicular':
      case 'parallel': {
        if (args.length !== 2) throw new Fail(`${fn}(M, line) expects two arguments`, span);
        const m = this.point(this.value(args[0]!), args[0]!.span);
        const l = this.asLine(this.value(args[1]!), args[1]!.span);
        const op = fn === 'perpendicular' ? 'orthLine' : 'parLine';
        const q = this.def({ op, args: [m, l.a, l.b], out: [this.freshAux()] }, span);
        return { t: 'line', a: m, b: q, seg: false };
      }
      case 'triangle': {
        const [a, b, c] = P(3);
        return { t: 'tri', v: [a!, b!, c!] };
      }
      case 'circle':
      case 'Circle': {
        if (fn === 'circle' && args.length === 3) {
          const [a, b, c] = P(3);
          const o = this.def({ op: 'center', kind: 'circum', args: [a!, b!, c!], out: [this.freshAux()] }, span);
          return { t: 'circle', c: o, th: a!, geo: true };
        }
        if (args.length < 2) throw new Fail(`${fn}(centre, radius) expects two arguments`, span);
        const centre = this.value(args[0]!);
        const r = this.value(args[1]!);
        // geometry's circle(point, real) is an object; plain's circle(pair, real) / Circle(...) are paths
        const geo = fn === 'circle' && (centre.t === 'pt' || centre.t === 'vec') && !!centre.point;
        return this.circleValue(centre, r, geo, span);
      }
      case 'circumcircle':
      case 'incircle': {
        const first = args.length === 1 ? this.value(args[0]!) : null;
        // olympiad.asy's circumcircle(pair,pair,pair) is a path; geometry.asy's (triangle, or points
        // when olympiad is not imported) is a circle object
        const geo = first?.t === 'tri' || !this.olympiad;
        const v = first?.t === 'tri' ? first.v : (P(3) as [PointId, PointId, PointId]);
        if (fn === 'circumcircle') {
          const o = this.def({ op: 'center', kind: 'circum', args: [...v], out: [this.freshAux()] }, span);
          return { t: 'circle', c: o, th: v[0], geo };
        }
        const i = this.def({ op: 'center', kind: 'in', args: [...v], out: [this.freshAux()] }, span);
        const touch = this.def({ op: 'projection', args: [i, v[1], v[2]], out: [this.freshAux()] }, span);
        return { t: 'circle', c: i, th: touch, geo };
      }
      case 'intersectionpoint':
      case 'intersectionpoints':
        return this.intersections(e);
      case 'MP':
      case 'Drawing': {
        // cse5 helpers (azzam.sty / evan.sty): MP labels a point "$s$"; Drawing also dots it, or draws a path
        const vs = args.map((a) => this.value(a));
        if (fn === 'Drawing' && vs[0] && vs[0].t !== 'str' && vs[0].t !== 'vec' && vs[0].t !== 'pt') {
          const pen = args.find((_, i) => vs[i]!.t === 'pen');
          this.drawValue(vs[0], pen ? this.src(pen.span) : null, null, true, span);
          return vs[0];
        }
        const textIdx = vs[0]?.t === 'str' ? 0 : -1;
        const posIdx = textIdx + 1;
        const at = vs[posIdx];
        if (!at) throw new Fail(`${fn} needs a point`, span);
        const p = this.point(at, args[posIdx]!.span);
        const dirArg = vs[posIdx + 1] && vs[posIdx + 1]!.t !== 'pen' ? posIdx + 1 : -1;
        const pen = args.find((_, i) => vs[i]!.t === 'pen');
        const penText = pen ? this.src(pen.span) : null;
        if (fn === 'Drawing') this.draw({ cmd: 'tkzDrawPoint', options: penText, groups: [[p]] }, span);
        const text = textIdx === 0 ? (vs[0] as { v: string }).v : '';
        if (text) {
          // default direction: plain.S
          const dir = dirArg >= 0 ? this.direction(vs[dirArg]) : { angle: -90, k: 1 };
          this.draw({ cmd: 'tkzLabelPoint', options: dirArg >= 0 ? this.src(args[dirArg]!.span) : 'S', groups: [[p]], text: `$${text}$`, dir }, span);
        }
        return { t: 'pt', name: p };
      }
      case 'rightanglemark':
      case 'anglemark': {
        const [a, b, c] = P(3);
        return { t: 'mark', kind: fn === 'rightanglemark' ? 'right' : 'angle', pts: [a!, b!, c!] };
      }
      case 'rotate': {
        const a = args[0] ? this.value(args[0]) : null;
        if (a?.t !== 'num') throw new Fail('rotate(angle, centre) needs a constant angle', span);
        const c = args[1] ? this.value(args[1]) : null;
        return { t: 'tr', kind: 'rotate', angle: a.v, c };
      }
      case 'reflect': {
        const [a, b] = P(2);
        return { t: 'tr', kind: 'reflect', a: a!, b: b! };
      }
      case 'shift': {
        const v = args.length === 2 ? this.value({ k: 'pair', x: args[0]!, y: args[1]!, span }) : this.value(args[0]!);
        return { t: 'tr', kind: 'shift', v };
      }
      case 'scale': {
        const k = args[0] ? this.value(args[0]) : null;
        if (k?.t !== 'num') throw new Fail('scale(k) needs a constant factor', span);
        return { t: 'tr', kind: 'scale', k: k.v, c: args[1] ? this.value(args[1]) : null };
      }
      default:
        break;
    }
    if (ASY_PEN_FUNCTIONS.has(fn)) return { t: 'pen', text: this.src(span) };
    if (fn === 'Label' || fn === 'minipage' || fn === 'scale') {
      const s = args[0] ? this.value(args[0]) : null;
      if (s?.t === 'str') return s;
    }
    if (NUMERIC_FUNCTIONS.has(fn)) {
      const vs = args.map((a) => this.value(a));
      if (vs.every((v) => v.t === 'num' || v.t === 'real' || v.t === 'vec' || v.t === 'pt')) {
        const ex: Expr = { ...e, args: vs.map((v, i) => this.exprOf(v, args[i]!.span)) };
        return this.arith(ex, vs);
      }
    }
    throw new Fail(`Function "${fn}" is not supported`, e.fnSpan);
  }

  /** intersectionpoint(s) of lines, circles and paths. */
  private intersections(e: Extract<Expr, { k: 'call' }>): Val {
    const single = e.fn === 'intersectionpoint';
    if (e.args.length !== 2) throw new Fail(`${e.fn} expects two arguments`, e.span);
    const a = this.value(e.args[0]!);
    const b = this.value(e.args[1]!);
    const span = e.span;
    const lineLike = (v: Val) => v.t === 'line' || (v.t === 'path' && v.pts.length === 2 && !v.cycle);
    if (lineLike(a) && lineLike(b)) {
      const l1 = this.asLine(a, e.args[0]!.span);
      const l2 = this.asLine(b, e.args[1]!.span);
      const p = this.def({ op: 'interLL', args: [l1.a, l1.b, l2.a, l2.b], out: [this.freshAux()] }, span);
      return single ? { t: 'pt', name: p } : { t: 'arr', items: [{ t: 'pt', name: p }] };
    }
    let c: Construction;
    const outs: [PointId, PointId] = [this.freshAux(), this.freshAux()];
    if ((a.t === 'circle' && lineLike(b)) || (lineLike(a) && b.t === 'circle')) {
      const circ = (a.t === 'circle' ? a : b) as Extract<Val, { t: 'circle' }>;
      const lv = lineLike(a) ? a : b;
      const l = this.asLine(lv, span);
      const lineIsPath = lv.t === 'path';
      let order: InterOrder;
      if (circ.geo && !lineIsPath) order = 'asy-y';
      else if (a.t === 'circle' || lv.t === 'line') order = 'asy-path1'; // time along the circle path
      else order = 'asy-path2'; // the segment comes first
      const seg = lineIsPath || (lv.t === 'line' && lv.seg);
      c = { op: 'interLC', args: [l.a, l.b, circ.c, circ.th], out: outs, order, ...(seg ? { seg: true as const } : {}) };
    } else if (a.t === 'circle' && b.t === 'circle') {
      c = { op: 'interCC', args: [a.c, a.th, b.c, b.th], out: outs, order: a.geo && b.geo ? 'asy-y' : 'asy-path1' };
    } else {
      throw new Fail(`${e.fn} of ${describe(a)} and ${describe(b)} is not supported`, span);
    }
    this.def(c, span);
    const items: Val[] = outs.map((name) => ({ t: 'pt', name }));
    return single ? items[0]! : { t: 'arr', items };
  }

  // ---------------------------------------------------------------- drawing commands

  private command(e: Extract<Expr, { k: 'call' }>, span: Span) {
    const fn = e.fn;
    if (SETUP_CALLS.has(fn)) return;
    switch (fn) {
      case 'Drawing':
      case 'MP':
        this.call(e);
        return;
      case 'draw':
      case 'filldraw':
      case 'fill':
        return this.drawCall(e, span);
      case 'dot':
        return this.dotCall(e, span);
      case 'label':
        return this.labelCall(e, span);
      default:
        this.diag('warning', `${fn}(…) is not drawn by the preview`, span, 'ignored');
    }
  }

  /** Split call arguments into the drawable, pens and the rest. */
  private classify(args: Expr[]): { vals: { v: Val; e: Expr }[]; pens: Expr[] } {
    const vals: { v: Val; e: Expr }[] = [];
    const pens: Expr[] = [];
    for (const a of args) {
      const v = this.value(a);
      if (v.t === 'pen') pens.push(a);
      else if (v.t !== 'void') vals.push({ v, e: a });
    }
    return { vals, pens };
  }

  private drawCall(e: Extract<Expr, { k: 'call' }>, span: Span) {
    const { vals, pens } = this.classify(e.args);
    const shape = vals.find((x) => x.v.t !== 'str');
    if (!shape) throw new Fail(`${e.fn} needs something to draw`, span);
    const penText = (p: Expr | undefined) => (p ? this.src(p.span) : null);
    let fillPen: string | null = null;
    let strokePen: string | null = penText(pens[0]);
    if (e.fn === 'filldraw') {
      fillPen = penText(pens[0]) ?? 'black';
      strokePen = penText(pens[1]);
    } else if (e.fn === 'fill') {
      fillPen = penText(pens[0]) ?? 'black';
    }
    const stroke = e.fn !== 'fill';
    const items = shape.v.t === 'multi' ? shape.v.items : [shape.v];
    for (const v of items) this.drawValue(v, stroke ? strokePen : null, fillPen, stroke, span);
  }

  private drawValue(v: Val, pen: string | null, fill: string | null, stroke: boolean, span: Span) {
    const out = (cmd: DrawCmd, groups: PointId[][], extra: Partial<DrawingSpec> = {}) => this.draw({ cmd, options: pen, groups, ...extra }, span);
    const fillOut = (cmd: DrawCmd, groups: PointId[][]) => this.draw({ cmd, options: fill, groups }, span);
    switch (v.t) {
      case 'path': {
        if (v.cycle) {
          if (fill) fillOut('tkzFillPolygon', [v.pts]);
          if (stroke) out('tkzDrawPolygon', [v.pts]);
        } else if (stroke) {
          out(v.pts.length === 2 ? 'tkzDrawSegment' : 'tkzDrawPolySeg', [v.pts]);
        }
        return;
      }
      case 'line':
        if (stroke) out(v.seg ? 'tkzDrawSegment' : 'tkzDrawLine', [[v.a, v.b]], v.seg ? {} : { infinite: true });
        return;
      case 'circle':
        if (fill) fillOut('tkzFillCircle', [[v.c, v.th]]);
        if (stroke) out('tkzDrawCircle', [[v.c, v.th]]);
        return;
      case 'tri':
        if (fill) fillOut('tkzFillPolygon', [[...v.v]]);
        if (stroke) out('tkzDrawPolygon', [[...v.v]]);
        return;
      case 'mark':
        out(v.kind === 'right' ? 'tkzMarkRightAngle' : 'tkzMarkAngle', [[...v.pts]]);
        return;
      default:
        throw new Fail(`Cannot draw ${describe(v)}`, span);
    }
  }

  /** Direction argument of dot/label → stored direction. */
  private direction(v: Val | undefined): DrawingSpec['dir'] {
    if (!v) return null;
    if (v.t === 'vec' && v.deps.size === 0) {
      const d = evalNum(v.e, new Map());
      if (isVec(d)) {
        const k = Math.hypot(d.x, d.y);
        return k === 0 ? null : { angle: (Math.atan2(d.y, d.x) * 180) / Math.PI, k };
      }
    }
    if (v.t === 'vec') {
      // dir(P) or k*dir(P)
      const e = v.e;
      const dirOf = (x: Expr): PointId | null => (x.k === 'call' && x.fn === 'dir' && x.args.length === 1 && x.args[0]!.k === 'pt' ? x.args[0]!.name : null);
      const p = dirOf(e);
      if (p) return { of: p, k: 1 };
      if (e.k === 'bin' && e.op === '*' && e.a.k === 'num') {
        const q = dirOf(e.b);
        if (q) return { of: q, k: e.a.v };
      }
    }
    if (v.t === 'pt') return { of: v.name, k: 1 };
    return null;
  }

  private dotCall(e: Extract<Expr, { k: 'call' }>, span: Span) {
    const { vals, pens } = this.classify(e.args);
    const pen = pens[0] ? this.src(pens[0].span) : null;
    let i = 0;
    const text = vals[0]?.v.t === 'str' ? (vals[i++]!.v as { v: string }).v : null;
    const target = vals[i++];
    if (!target) throw new Fail('dot needs a point', span);
    const dir = this.direction(vals[i]?.v);
    const targets: Val[] = target.v.t === 'multi' ? target.v.items : target.v.t === 'arr' ? target.v.items : target.v.t === 'path' ? target.v.pts.map((name) => ({ t: 'pt', name })) : [target.v];
    for (const tv of targets) {
      const p = this.point(tv, target.e.span);
      this.draw({ cmd: 'tkzDrawPoint', options: pen, groups: [[p]] }, span);
      if (text !== null) this.draw({ cmd: 'tkzLabelPoint', options: dir ? this.src(vals[i]!.e.span) : null, groups: [[p]], text, dir }, span);
    }
  }

  private labelCall(e: Extract<Expr, { k: 'call' }>, span: Span) {
    const { vals } = this.classify(e.args);
    const text = vals[0]?.v.t === 'str' ? (vals[0].v as { v: string }).v : null;
    if (text === null) throw new Fail('label needs a text "…" first', span);
    const at = vals[1];
    if (!at) {
      this.diag('warning', 'A label without a position is not drawn', span, 'ignored');
      return;
    }
    const p = this.point(at.v, at.e.span);
    const dirArg = vals[2];
    const dir = this.direction(dirArg?.v);
    this.draw({ cmd: 'tkzLabelPoint', options: dirArg ? this.src(dirArg.e.span) : null, groups: [[p]], text, dir }, span);
  }
}

// ------------------------------------------------------------------ helpers

function describe(v: Val): string {
  return { num: 'a number', real: 'a number', pt: 'a point', vec: 'a point', line: 'a line', circle: 'a circle', path: 'a path', multi: 'several paths', tri: 'a triangle', arr: 'an array', mark: 'an angle mark', tr: 'a transform', pen: 'a pen', str: 'a string', void: 'nothing' }[v.t];
}

function collectPts(e: Expr, out: Set<PointId>) {
  if (e.k === 'pt') out.add(e.name);
  for (const v of Object.values(e)) {
    if (v && typeof v === 'object' && 'k' in v) collectPts(v as Expr, out);
    if (Array.isArray(v)) for (const x of v) if (x && typeof x === 'object' && 'k' in x) collectPts(x as Expr, out);
  }
}

function renameExpr(e: Expr, from: PointId, to: PointId): Expr {
  if (e.k === 'pt') return e.name === from ? { ...e, name: to } : e;
  const copy: Record<string, unknown> = { ...e };
  for (const [key, v] of Object.entries(e)) {
    if (v && typeof v === 'object' && 'k' in v) copy[key] = renameExpr(v as Expr, from, to);
    else if (Array.isArray(v)) copy[key] = v.map((x) => (x && typeof x === 'object' && 'k' in x ? renameExpr(x as Expr, from, to) : x));
  }
  return copy as Expr;
}

function renameVal(v: Val, from: PointId, to: PointId): Val {
  const r = (n: PointId) => (n === from ? to : n);
  switch (v.t) {
    case 'pt':
      return { ...v, name: r(v.name) };
    case 'vec':
    case 'real':
      return { ...v, e: renameExpr(v.e, from, to), deps: new Set([...v.deps].map(r)) } as Val;
    case 'line':
      return { ...v, a: r(v.a), b: r(v.b) };
    case 'circle':
      return { ...v, c: r(v.c), th: r(v.th) };
    case 'path':
      return { ...v, pts: v.pts.map(r) };
    case 'tri':
      return { ...v, v: v.v.map(r) as [PointId, PointId, PointId] };
    case 'mark':
      return { ...v, pts: v.pts.map(r) as [PointId, PointId, PointId] };
    case 'arr':
      return { ...v, items: v.items.map((x) => renameVal(x, from, to)) };
    case 'multi':
      return { ...v, items: v.items.map((x) => renameVal(x, from, to)) };
    case 'tr':
      if (v.kind === 'reflect') return { ...v, a: r(v.a), b: r(v.b) };
      if (v.kind === 'shift') return { ...v, v: renameVal(v.v, from, to) };
      return { ...v, c: v.c ? renameVal(v.c, from, to) : null } as Val;
    default:
      return v;
  }
}


/** Spans of the numbers of a literal point: (x,y), dir(a), r*dir(a). */
function literalOf(e: Expr): Literal | null {
  if (e.k === 'pair' && isNumLit(e.x) && isNumLit(e.y)) return { kind: 'xy', xs: [e.x.span], ys: [e.y.span] };
  const dirLit = (x: Expr): Span | null => (x.k === 'call' && x.fn === 'dir' && x.args.length === 1 && isNumLit(x.args[0]!) ? x.args[0]!.span : null);
  const d = dirLit(e);
  if (d) return { kind: 'angle', spans: [d], r: 1 };
  if (e.k === 'bin' && e.op === '*' && isNumLit(e.a)) {
    const d2 = dirLit(e.b);
    if (d2) return { kind: 'angle', spans: [d2], r: numLitValue(e.a) };
  }
  return null;
}

/** C + rotate(90)*(B - A) → [C, A, B] */
function matchOrth(e: Expr): [PointId, PointId, PointId] | null {
  if (e.k !== 'bin' || e.op !== '+' || e.a.k !== 'pt') return null;
  const r = e.b;
  if (r.k !== 'bin' || r.op !== '*') return null;
  if (r.a.k !== 'call' || r.a.fn !== 'rotate' || r.a.args.length !== 1 || r.a.args[0]!.k !== 'num' || r.a.args[0]!.v !== 90) return null;
  const d = r.b;
  if (d.k !== 'bin' || d.op !== '-' || d.a.k !== 'pt' || d.b.k !== 'pt') return null;
  return [e.a.name, d.b.name, d.a.name];
}

/** C - rotate(90)*unit(O - C) → [C, O] */
function matchTangent(e: Expr): [PointId, PointId] | null {
  if (e.k !== 'bin' || e.op !== '-' || e.a.k !== 'pt') return null;
  const r = e.b;
  if (r.k !== 'bin' || r.op !== '*') return null;
  if (r.a.k !== 'call' || r.a.fn !== 'rotate' || r.a.args.length !== 1 || r.a.args[0]!.k !== 'num' || r.a.args[0]!.v !== 90) return null;
  const u = r.b;
  if (u.k !== 'call' || u.fn !== 'unit' || u.args.length !== 1) return null;
  const d = u.args[0]!;
  if (d.k !== 'bin' || d.op !== '-' || d.a.k !== 'pt' || d.b.k !== 'pt' || d.b.name !== e.a.name) return null;
  return [e.a.name, d.a.name];
}

/** Where the Asymptote code is: inside \begin{asy}…\end{asy}, or the whole text. */
export function asyRegion(text: string): { code: string; base: number } {
  const begin = /\\begin\s*\{asy\}(\s*\[[^\]]*\])?/.exec(text);
  if (!begin) return { code: text, base: 0 };
  const start = begin.index + begin[0].length;
  const end = text.indexOf('\\end{asy}', start);
  return { code: text.slice(start, end < 0 ? undefined : end), base: start };
}

/** Parse Asymptote source into construction statements. */
export function parseAsymptote(text: string): ParseResult {
  const { code, base } = asyRegion(text);
  const parsed = parseAsy(code, base, text);
  const front = new Front(text);
  front.run(parsed.stmts);
  const diagnostics = [...parsed.diagnostics, ...front.diagnostics].sort((a, b) => a.from - b.from);
  return { statements: front.statements, diagnostics, colors: front.colors };
}
