import type { Graph, PointId } from '../graph/types';
import {
  centroid,
  circumcenter,
  incenter,
  interCC,
  interLC,
  interLL,
  midpoint,
  orthocenter,
  orthogonalThrough,
  parallelThrough,
  projection,
} from './constructions';
import type { Vec } from './vec';

/** Coordinates of every point; null = undefined (degenerate construction). Never NaN. */
export type Evaluated = Map<PointId, Vec | null>;

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
    switch (c.op) {
      case 'midpoint':
        pos.set(c.out[0], midpoint(p[0]!, p[1]!));
        break;
      case 'projection':
        pos.set(c.out[0], projection(p[0]!, p[1]!, p[2]!));
        break;
      case 'orthLine':
        pos.set(c.out[0], orthogonalThrough(p[0]!, p[1]!, p[2]!));
        break;
      case 'parLine':
        pos.set(c.out[0], parallelThrough(p[0]!, p[1]!, p[2]!));
        break;
      case 'interLL':
        pos.set(c.out[0], interLL(p[0]!, p[1]!, p[2]!, p[3]!));
        break;
      case 'interLC':
      case 'interCC': {
        const r = c.op === 'interLC' ? interLC(p[0]!, p[1]!, p[2]!, p[3]!) : interCC(p[0]!, p[1]!, p[2]!, p[3]!);
        pos.set(c.out[0], r ? r[0] : null);
        pos.set(c.out[1], r ? r[1] : null);
        break;
      }
      case 'center': {
        const [a, b, cc] = [p[0]!, p[1]!, p[2]!];
        const f = { circum: circumcenter, in: incenter, centroid, ortho: orthocenter }[c.kind];
        pos.set(c.out[0], f(a, b, cc));
        break;
      }
    }
  }
  return pos;
}
