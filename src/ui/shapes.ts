// Drawing commands + evaluated coordinates → primitive shapes in math coordinates.
// Shapes that reference an undefined point are dropped (hidden).

import type { Evaluated } from '../geom/evaluate';
import { dist, lerp, type Vec } from '../geom/vec';
import type { Drawing, Graph, PointId } from '../graph/types';
import type { BBox } from './viewport';

export type Shape =
  | { type: 'segment'; a: Vec; b: Vec }
  | { type: 'polygon'; pts: Vec[] }
  | { type: 'circle'; c: Vec; r: number };

export interface LabelSpec {
  name: PointId;
  at: Vec;
  /** Position option such as "above right"; default "below" (tkz-euclide label style). */
  pos: LabelPos;
}

export type LabelPos = { v: 'above' | 'below' | 'center'; h: 'left' | 'right' | 'center' };

/** tkz-euclide's `line style` uses `add = .2 and .2`: extend by 20 % of |AB| on both sides. */
export const LINE_ADD = 0.2;

export function shapesOf(d: Drawing, pos: Evaluated): Shape[] {
  const get = (n: PointId) => pos.get(n) ?? null;
  const all = (names: PointId[]) => {
    const pts = names.map(get);
    return pts.every((p): p is Vec => p !== null) ? pts : null;
  };
  const out: Shape[] = [];
  switch (d.d.cmd) {
    case 'tkzDrawSegment':
    case 'tkzDrawSegments':
      for (const g of d.d.groups) {
        const p = all(g);
        if (p) out.push({ type: 'segment', a: p[0]!, b: p[1]! });
      }
      break;
    case 'tkzDrawLine': {
      const p = all(d.d.groups[0]!);
      if (p && dist(p[0]!, p[1]!) > 0) {
        out.push({ type: 'segment', a: lerp(p[0]!, p[1]!, -LINE_ADD), b: lerp(p[1]!, p[0]!, -LINE_ADD) });
      }
      break;
    }
    case 'tkzDrawPolygon': {
      const p = all(d.d.groups[0]!);
      if (p) out.push({ type: 'polygon', pts: p });
      break;
    }
    case 'tkzDrawCircle': {
      const p = all(d.d.groups[0]!);
      if (p) out.push({ type: 'circle', c: p[0]!, r: dist(p[0]!, p[1]!) });
      break;
    }
    default:
      break;
  }
  return out;
}

/** Parse the first position keyword out of a label option string. */
export function labelPos(options: string | null): LabelPos {
  const def: LabelPos = { v: 'below', h: 'center' };
  if (!options) return def;
  for (const raw of options.split(',')) {
    const key = raw.split('=')[0]!.trim();
    const m = /^(above|below)?\s*(left|right)?$/.exec(key);
    if (m && (m[1] || m[2])) {
      return { v: (m[1] as 'above' | 'below' | undefined) ?? 'center', h: (m[2] as 'left' | 'right' | undefined) ?? 'center' };
    }
  }
  return def;
}

export function labelsOf(d: Drawing, pos: Evaluated): LabelSpec[] {
  if (d.d.cmd !== 'tkzLabelPoints') return [];
  const p = labelPos(d.d.options);
  return d.d.groups[0]!.flatMap((name) => {
    const at = pos.get(name);
    return at ? [{ name, at, pos: p }] : [];
  });
}

/** Points listed in any \tkzDrawPoints. */
export function drawnPoints(g: Graph): Set<PointId> {
  const s = new Set<PointId>();
  for (const d of g.drawings) if (d.d.cmd === 'tkzDrawPoints') for (const n of d.d.groups[0]!) s.add(n);
  return s;
}

/** Bounding box of every defined point and every drawn circle. */
export function boundingBox(g: Graph, pos: Evaluated): BBox | null {
  let box: BBox | null = null;
  const addPt = (x: number, y: number) => {
    if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
    else {
      box.minX = Math.min(box.minX, x);
      box.minY = Math.min(box.minY, y);
      box.maxX = Math.max(box.maxX, x);
      box.maxY = Math.max(box.maxY, y);
    }
  };
  for (const p of pos.values()) if (p) addPt(p.x, p.y);
  for (const d of g.drawings) {
    for (const s of shapesOf(d, pos)) {
      if (s.type === 'circle') {
        addPt(s.c.x - s.r, s.c.y - s.r);
        addPt(s.c.x + s.r, s.c.y + s.r);
      } else if (s.type === 'segment') {
        addPt(s.a.x, s.a.y);
        addPt(s.b.x, s.b.y);
      }
    }
  }
  return box;
}
