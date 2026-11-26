import { evalPointExpr } from '../asy/expr';
import type { Graph, PointId } from '../graph/types';
import {
  centroid,
  circumcenter,
  eulerCenter,
  excenterOpposite2nd,
  homothety,
  incenter,
  interCC,
  interLC,
  interLL,
  midArc,
  midpoint,
  orthocenter,
  orthogonalThrough,
  parallelThrough,
  projection,
  reflection,
  reorder,
  rotation,
  symmetry,
  tangentAt,
  translation,
} from './constructions';
import { dist, isFiniteVec, rot90, sub, type Vec } from './vec';

/** Coordinates of every point; null = undefined (degenerate construction). Never NaN. */
export type Evaluated = Map<PointId, Vec | null>;

const CENTERS = { circum: circumcenter, in: incenter, ex: excenterOpposite2nd, centroid, ortho: orthocenter, euler: eulerCenter };

export function evaluate(g: Graph): Evaluated {
  const pos: Evaluated = new Map();
  for (const { c } of g.steps) {
    if (c.op === 'free') {
      pos.set(c.out[0], { x: c.x, y: c.y });
      continue;
    }
    const args = c.args.map((a) => pos.get(a) ?? null);
    if (args.some((a) => a === null)) {
      for (const o of c.out) pos.set(o, null);
      continue;
    }
    const p = args as Vec[];
    const set = (v: Vec | null) => pos.set(c.out[0], v && isFiniteVec(v) ? v : null);
    switch (c.op) {
      case 'midpoint':
        set(midpoint(p[0]!, p[1]!));
        break;
      case 'onLine':
        set(dist(p[0]!, p[1]!) > 0 ? { x: p[0]!.x + c.t * (p[1]!.x - p[0]!.x), y: p[0]!.y + c.t * (p[1]!.y - p[0]!.y) } : null);
        break;
      case 'projection':
        set(projection(p[0]!, p[1]!, p[2]!));
        break;
      case 'reflection':
        set(reflection(p[0]!, p[1]!, p[2]!));
        break;
      case 'symmetry':
        set(symmetry(p[0]!, p[1]!));
        break;
      case 'homothety':
        set(homothety(p[0]!, p[1]!, c.k));
        break;
      case 'rotation':
        set(rotation(p[0]!, p[1]!, c.angle));
        break;
      case 'translation':
        set(translation(p[0]!, p[1]!, p[2]!));
        break;
      case 'shift':
        set({ x: p[0]!.x + c.dx, y: p[0]!.y + c.dy });
        break;
      case 'orthLine':
        set(orthogonalThrough(p[0]!, p[1]!, p[2]!));
        break;
      case 'parLine':
        set(parallelThrough(p[0]!, p[1]!, p[2]!));
        break;
      case 'tangentAt':
        set(tangentAt(p[0]!, p[1]!));
        break;
      case 'midArc':
        set(midArc(p[0]!, p[1]!, p[2]!));
        break;
      case 'interLL':
        set(interLL(p[0]!, p[1]!, p[2]!, p[3]!));
        break;
      case 'interLC':
      case 'interCC': {
        const r = c.op === 'interLC' ? interLC(p[0]!, p[1]!, p[2]!, p[3]!) : interCC(p[0]!, p[1]!, p[2]!, p[3]!);
        // direction of the line (interLC) or of the radical line (interCC)
        const dir = c.op === 'interLC' ? sub(p[1]!, p[0]!) : rot90(sub(p[2]!, p[0]!));
        const centre = c.op === 'interLC' ? p[2]! : p[0]!;
        let o = r ? reorder(r, c.order, dir, centre, p[0]!) : null;
        if (o && c.order === 'common' && p[4]) {
          // tkz-euclide: keep when the second point is the common one (1pt for LC, 0.05pt for CC), else swap
          const tol = c.op === 'interLC' ? 2.54 / 72.27 : (0.05 * 2.54) / 72.27;
          if (dist(o[1], p[4]) >= tol) o = [o[1], o[0]];
        }
        if (o && c.op === 'interLC' && c.seg) {
          // Asymptote path A--B: only points on the segment count; the rest move up
          const d = sub(p[1]!, p[0]!);
          const l2 = d.x * d.x + d.y * d.y;
          const t = (v: Vec) => ((v.x - p[0]!.x) * d.x + (v.y - p[0]!.y) * d.y) / l2;
          const kept = o.filter((v) => t(v) >= -1e-9 && t(v) <= 1 + 1e-9);
          pos.set(c.out[0], kept[0] ?? null);
          pos.set(c.out[1], kept[1] ?? null);
          break;
        }
        pos.set(c.out[0], o ? o[0] : null);
        pos.set(c.out[1], o ? o[1] : null);
        break;
      }
      case 'center':
        set(CENTERS[c.kind](p[0]!, p[1]!, p[2]!));
        break;
      case 'expr': {
        const env = new Map<PointId, Vec>();
        c.args.forEach((a, i) => env.set(a, p[i]!));
        set(evalPointExpr(c.expr, env));
        break;
      }
    }
  }
  return pos;
}
