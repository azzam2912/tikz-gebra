// Numeric evaluation of Asymptote expressions (reals, pairs, transforms).
// Used for `expr` construction steps and for constant arguments (angles, label directions).
// Never returns NaN: anything degenerate becomes null.

import type { ExprNode } from '../parser/ast';
import type { Vec } from '../geom/vec';
import {
  centroid,
  circumcenter,
  excenterOpposite2nd,
  incenter,
  interLL,
  midpoint,
  orthocenter,
  projection,
} from '../geom/constructions';
import type { Expr } from './ast';

/** An affine map x ↦ (a·x + b·y + e, c·x + d·y + f). */
export interface Transform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type NumVal = number | Vec | Transform | string | null;

const isVec = (v: NumVal | undefined): v is Vec => typeof v === 'object' && v !== null && 'x' in v;
const isTr = (v: NumVal | undefined): v is Transform => typeof v === 'object' && v !== null && 'a' in v;
const deg = Math.PI / 180;

export const COMPASS: Record<string, number> = {
  E: 0, ENE: 22.5, NE: 45, NNE: 67.5, N: 90, NNW: 112.5, NW: 135, WNW: 157.5, W: 180,
  WSW: 202.5, SW: 225, SSW: 247.5, S: 270, SSE: 292.5, SE: 315, ESE: 337.5,
};

const CONSTANTS: Record<string, NumVal> = {
  pi: Math.PI,
  origin: { x: 0, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  infinity: null,
  I: { x: 0, y: 1 },
};

export function dirVec(a: number): Vec {
  return { x: Math.cos(a * deg), y: Math.sin(a * deg) };
}

function constant(name: string): NumVal | undefined {
  if (name in COMPASS) return dirVec(COMPASS[name]!);
  if (name in CONSTANTS) return CONSTANTS[name]!;
  return undefined;
}

const apply = (t: Transform, p: Vec): Vec => ({ x: t.a * p.x + t.b * p.y + t.e, y: t.c * p.x + t.d * p.y + t.f });
const compose = (s: Transform, t: Transform): Transform => ({
  a: s.a * t.a + s.b * t.c,
  b: s.a * t.b + s.b * t.d,
  c: s.c * t.a + s.d * t.c,
  d: s.c * t.b + s.d * t.d,
  e: s.a * t.e + s.b * t.f + s.e,
  f: s.c * t.e + s.d * t.f + s.f,
});

export function rotateT(angle: number, c: Vec = { x: 0, y: 0 }): Transform {
  const co = Math.cos(angle * deg);
  const si = Math.sin(angle * deg);
  return { a: co, b: -si, c: si, d: co, e: c.x - co * c.x + si * c.y, f: c.y - si * c.x - co * c.y };
}

export function reflectT(p: Vec, q: Vec): Transform | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return null;
  const a = (dx * dx - dy * dy) / l2;
  const b = (2 * dx * dy) / l2;
  // x' = p + R(x - p)
  return { a, b, c: b, d: -a, e: p.x - a * p.x - b * p.y, f: p.y - b * p.x + a * p.y };
}

const finite = (v: NumVal): NumVal => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (isVec(v)) return Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  return v;
};

type Fn = (args: NumVal[]) => NumVal;

const num = (v: NumVal | undefined): number | null => (typeof v === 'number' ? v : null);
const vec = (v: NumVal | undefined): Vec | null => {
  if (isVec(v ?? null)) return v as Vec;
  if (typeof v === 'number') return { x: v, y: 0 };
  return null;
};

const FNS: Record<string, Fn> = {
  dir: ([a, b]) => {
    if (b !== undefined) return null;
    if (typeof a === 'number') return dirVec(a);
    const v = vec(a);
    if (!v) return null;
    const l = Math.hypot(v.x, v.y);
    return l === 0 ? null : { x: v.x / l, y: v.y / l };
  },
  expi: ([a]) => (typeof a === 'number' ? { x: Math.cos(a), y: Math.sin(a) } : null),
  unit: ([a]) => {
    const v = vec(a);
    if (!v) return null;
    const l = Math.hypot(v.x, v.y);
    return l === 0 ? null : { x: v.x / l, y: v.y / l };
  },
  abs: ([a]) => (typeof a === 'number' ? Math.abs(a) : isVec(a) ? Math.hypot(a.x, a.y) : null),
  length: ([a]) => (isVec(a) ? Math.hypot(a.x, a.y) : null),
  sqrt: ([a]) => (typeof a === 'number' && a >= 0 ? Math.sqrt(a) : null),
  sin: ([a]) => (typeof a === 'number' ? Math.sin(a) : null),
  cos: ([a]) => (typeof a === 'number' ? Math.cos(a) : null),
  tan: ([a]) => (typeof a === 'number' ? Math.tan(a) : null),
  Sin: ([a]) => (typeof a === 'number' ? Math.sin(a * deg) : null),
  Cos: ([a]) => (typeof a === 'number' ? Math.cos(a * deg) : null),
  Tan: ([a]) => (typeof a === 'number' ? Math.tan(a * deg) : null),
  asin: ([a]) => (typeof a === 'number' ? Math.asin(a) : null),
  acos: ([a]) => (typeof a === 'number' ? Math.acos(a) : null),
  atan: ([a]) => (typeof a === 'number' ? Math.atan(a) : null),
  aSin: ([a]) => (typeof a === 'number' ? Math.asin(a) / deg : null),
  aCos: ([a]) => (typeof a === 'number' ? Math.acos(a) / deg : null),
  aTan: ([a]) => (typeof a === 'number' ? Math.atan(a) / deg : null),
  atan2: ([y, x]) => (typeof y === 'number' && typeof x === 'number' ? Math.atan2(y, x) : null),
  angle: ([a]) => (isVec(a) ? Math.atan2(a.y, a.x) : null),
  degrees: ([a]) => {
    if (typeof a === 'number') return a / deg;
    if (isVec(a)) {
      const t = Math.atan2(a.y, a.x) / deg;
      return t < 0 ? t + 360 : t;
    }
    return null;
  },
  radians: ([a]) => (typeof a === 'number' ? a * deg : null),
  xpart: ([a]) => (isVec(a) ? a.x : null),
  ypart: ([a]) => (isVec(a) ? a.y : null),
  conj: ([a]) => (isVec(a) ? { x: a.x, y: -a.y } : null),
  dot: ([a, b]) => (isVec(a) && isVec(b) ? a.x * b.x + a.y * b.y : null),
  cross: ([a, b]) => (isVec(a) && isVec(b) ? a.x * b.y - a.y * b.x : null),
  min: (xs) => (xs.every((x) => typeof x === 'number') ? Math.min(...(xs as number[])) : null),
  max: (xs) => (xs.every((x) => typeof x === 'number') ? Math.max(...(xs as number[])) : null),
  floor: ([a]) => num(a) !== null ? Math.floor(a as number) : null,
  ceil: ([a]) => num(a) !== null ? Math.ceil(a as number) : null,
  round: ([a]) => num(a) !== null ? Math.round(a as number) : null,
  exp: ([a]) => num(a) !== null ? Math.exp(a as number) : null,
  log: ([a]) => num(a) !== null && (a as number) > 0 ? Math.log(a as number) : null,
  rotate: ([a, c]) => (typeof a === 'number' ? rotateT(a, c !== undefined ? vec(c) ?? undefined : undefined) : null),
  shift: ([a, b]) => {
    if (typeof a === 'number' && typeof b === 'number') return { a: 1, b: 0, c: 0, d: 1, e: a, f: b };
    const v = vec(a);
    return v ? { a: 1, b: 0, c: 0, d: 1, e: v.x, f: v.y } : null;
  },
  scale: ([k, c]) => {
    if (typeof k !== 'number') return null;
    const p = c !== undefined ? vec(c) : { x: 0, y: 0 };
    if (!p) return null;
    return { a: k, b: 0, c: 0, d: k, e: p.x - k * p.x, f: p.y - k * p.y };
  },
  xscale: ([k]) => (typeof k === 'number' ? { a: k, b: 0, c: 0, d: 1, e: 0, f: 0 } : null),
  yscale: ([k]) => (typeof k === 'number' ? { a: 1, b: 0, c: 0, d: k, e: 0, f: 0 } : null),
  reflect: ([p, q]) => (isVec(p) && isVec(q) ? reflectT(p, q) : null),
  interp: ([a, b, t]) => {
    const va = vec(a);
    const vb = vec(b);
    if (va && vb && typeof t === 'number') return { x: va.x + (vb.x - va.x) * t, y: va.y + (vb.y - va.y) * t };
    if (typeof a === 'number' && typeof b === 'number' && typeof t === 'number') return a + (b - a) * t;
    return null;
  },
  foot: ([p, a, b]) => (isVec(p) && isVec(a) && isVec(b) ? projection(p, a, b) : null),
  extension: ([a, b, c, d]) => (isVec(a) && isVec(b) && isVec(c) && isVec(d) ? interLL(a, b, c, d) : null),
  circumcenter: ([a, b, c]) => (isVec(a) && isVec(b) && isVec(c) ? circumcenter(a, b, c) : null),
  incenter: ([a, b, c]) => (isVec(a) && isVec(b) && isVec(c) ? incenter(a, b, c) : null),
  orthocenter: ([a, b, c]) => (isVec(a) && isVec(b) && isVec(c) ? orthocenter(a, b, c) : null),
  centroid: ([a, b, c]) => (isVec(a) && isVec(b) && isVec(c) ? centroid(a, b, c) : null),
  // geometry.asy: excenter(A,B,C) is the centre of the excircle tangent to (AB), i.e. opposite C
  excenter: ([a, b, c]) => (isVec(a) && isVec(b) && isVec(c) ? excenterOpposite2nd(a, c, b) : null),
  circumradius: ([a, b, c]) => {
    if (!(isVec(a) && isVec(b) && isVec(c))) return null;
    const o = circumcenter(a, b, c);
    return o ? Math.hypot(o.x - a.x, o.y - a.y) : null;
  },
  inradius: ([a, b, c]) => {
    if (!(isVec(a) && isVec(b) && isVec(c))) return null;
    const i = incenter(a, b, c);
    const h = i ? projection(i, b, c) : null;
    return i && h ? Math.hypot(i.x - h.x, i.y - h.y) : null;
  },
  bisectorpoint: ([a, b, c]) => {
    if (!(isVec(a) && isVec(b))) return null;
    if (c === undefined) {
      const m = midpoint(a, b);
      const r = apply(rotateT(90, m), a);
      const l = Math.hypot(r.x - m.x, r.y - m.y);
      return l === 0 ? null : { x: m.x + (r.x - m.x) / l, y: m.y + (r.y - m.y) / l };
    }
    if (!isVec(c)) return null;
    const ua = FNS.unit!([{ x: a.x - b.x, y: a.y - b.y }]) as Vec | null;
    const uc = FNS.unit!([{ x: c.x - b.x, y: c.y - b.y }]) as Vec | null;
    if (!ua || !uc) return null;
    const u = FNS.unit!([{ x: (ua.x + uc.x) / 2, y: (ua.y + uc.y) / 2 }]) as Vec | null;
    return u ? { x: b.x + u.x, y: b.y + u.y } : null;
  },
};

/** Functions the numeric evaluator understands (the front end uses this to decide what can be an `expr` step). */
export const NUMERIC_FUNCTIONS = new Set(Object.keys(FNS));

function binary(op: string, a: NumVal, b: NumVal): NumVal {
  if (a === null || b === null) return null;
  switch (op) {
    case '+':
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (typeof a === 'string' || typeof b === 'string') return `${a}${b}`;
      if ((isVec(a) || typeof a === 'number') && (isVec(b) || typeof b === 'number')) {
        const va = vec(a)!;
        const vb = vec(b)!;
        return { x: va.x + vb.x, y: va.y + vb.y };
      }
      return null;
    case '-':
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if ((isVec(a) || typeof a === 'number') && (isVec(b) || typeof b === 'number')) {
        const va = vec(a)!;
        const vb = vec(b)!;
        return { x: va.x - vb.x, y: va.y - vb.y };
      }
      return null;
    case '*':
      if (typeof a === 'number' && typeof b === 'number') return a * b;
      if (typeof a === 'number' && isVec(b)) return { x: a * b.x, y: a * b.y };
      if (isVec(a) && typeof b === 'number') return { x: a.x * b, y: a.y * b };
      if (isVec(a) && isVec(b)) return { x: a.x * b.x - a.y * b.y, y: a.x * b.y + a.y * b.x }; // complex product
      if (isTr(a) && isVec(b)) return apply(a, b);
      if (isTr(a) && isTr(b)) return compose(a, b);
      return null;
    case '/':
      if (typeof b === 'number') {
        if (b === 0) return null;
        if (typeof a === 'number') return a / b;
        if (isVec(a)) return { x: a.x / b, y: a.y / b };
      }
      if (isVec(a) && isVec(b)) {
        const d = b.x * b.x + b.y * b.y;
        if (d === 0) return null;
        return { x: (a.x * b.x + a.y * b.y) / d, y: (a.y * b.x - a.x * b.y) / d };
      }
      return null;
    case '^':
      return typeof a === 'number' && typeof b === 'number' ? a ** b : null;
    default:
      return null;
  }
}

/** Evaluate an expression. `env` maps graph point names (k:'pt') and other bound names to values. */
export function evalNum(e: Expr, env: Map<string, NumVal>): NumVal {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'str':
      return e.v;
    case 'pt':
      return env.get(e.name) ?? null;
    case 'id': {
      if (env.has(e.name)) return env.get(e.name)!;
      const c = constant(e.name);
      return c === undefined ? null : c;
    }
    case 'pair': {
      const x = evalNum(e.x, env);
      const y = evalNum(e.y, env);
      return typeof x === 'number' && typeof y === 'number' ? { x, y } : null;
    }
    case 'cast':
      return evalNum(e.e, env);
    case 'unary': {
      const v = evalNum(e.e, env);
      if (e.op === '+') return v;
      if (typeof v === 'number') return -v;
      if (isVec(v)) return { x: -v.x, y: -v.y };
      return null;
    }
    case 'bin':
      return finite(binary(e.op, evalNum(e.a, env), evalNum(e.b, env)));
    case 'member': {
      const o = evalNum(e.obj, env);
      if (isVec(o)) return e.name === 'x' ? o.x : e.name === 'y' ? o.y : null;
      return null;
    }
    case 'call': {
      const f = FNS[e.fn];
      if (!f) return null;
      const args = e.args.map((a) => evalNum(a, env));
      if (args.some((a) => a === null)) return null;
      return finite(f(args));
    }
    default:
      return null;
  }
}

/** Evaluate an `expr` construction step: the result must be a pair. */
export function evalPointExpr(e: ExprNode, points: Map<string, Vec>): Vec | null {
  const v = evalNum(e as Expr, points as Map<string, NumVal>);
  return isVec(v) ? v : null;
}

export { isVec };
