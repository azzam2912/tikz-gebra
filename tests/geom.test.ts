import { describe, expect, it } from 'vitest';
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
} from '../src/geom/constructions';
import { v, type Vec } from '../src/geom/vec';

const close = (p: Vec | null | undefined, x: number, y: number) => {
  expect(p).not.toBeNull();
  expect(p!.x).toBeCloseTo(x, 9);
  expect(p!.y).toBeCloseTo(y, 9);
};

describe('basic constructions', () => {
  it('midpoint', () => close(midpoint(v(0, 0), v(4, 2)), 2, 1));
  it('projection', () => close(projection(v(1, 3), v(0, 0), v(4, 0)), 1, 0));
  it('projection onto a degenerate line is undefined', () => expect(projection(v(1, 1), v(2, 2), v(2, 2))).toBeNull());
  it('orthogonal through C is C + rot90(B−A)', () => close(orthogonalThrough(v(1, 1), v(0, 0), v(2, 0)), 1, 3));
  it('parallel through C is C + (B−A)', () => close(parallelThrough(v(1, 1), v(0, 0), v(2, 1)), 3, 2));
});

describe('line–line', () => {
  it('intersecting lines', () => close(interLL(v(0, 0), v(2, 2), v(0, 2), v(2, 0)), 1, 1));
  it('parallel lines are undefined', () => expect(interLL(v(0, 0), v(1, 1), v(0, 1), v(1, 2))).toBeNull());
  it('identical lines are undefined', () => expect(interLL(v(0, 0), v(1, 1), v(2, 2), v(3, 3))).toBeNull());
  it('degenerate line is undefined', () => expect(interLL(v(0, 0), v(0, 0), v(0, 1), v(1, 2))).toBeNull());
});

describe('line–circle', () => {
  const h = Math.sqrt(0.75);
  it('order: centre LEFT of A→B → first point comes first along A→B', () => {
    // line y=0.5 drawn left→right, centre (0,1) above it = on its left
    const r = interLC(v(-5, 0.5), v(5, 0.5), v(0, 1), v(0, 0))!;
    close(r[0], -h, 0.5);
    close(r[1], h, 0.5);
  });
  it('order: centre RIGHT of A→B → first point comes last along A→B', () => {
    // same line, centre (0,0) below it = on its right
    const r = interLC(v(-5, 0.5), v(5, 0.5), v(0, 0), v(1, 0))!;
    close(r[0], h, 0.5);
    close(r[1], -h, 0.5);
  });
  it('order depends on the direction of the line', () => {
    // line drawn right→left: centre (0,0) below it is now on its left
    const r = interLC(v(5, 0.5), v(-5, 0.5), v(0, 0), v(1, 0))!;
    close(r[0], h, 0.5); // first along A→B, i.e. the right-hand point
    close(r[1], -h, 0.5);
  });
  it('matches the tkz-euclide manual example (§18.2.2): D is the point near Lb', () => {
    const [D, E] = interLC(v(-2, 4), v(5, 0), v(1, 1), v(3, 3))!;
    expect(Math.hypot(D.x - 5, D.y)).toBeLessThan(Math.hypot(E.x - 5, E.y));
  });
  it('line through the centre: first = O − r·û', () => {
    const r = interLC(v(-3, 0), v(3, 0), v(0, 0), v(0, 2))!;
    close(r[0], -2, 0);
    close(r[1], 2, 0);
  });
  it('tangent line gives a double point', () => {
    const r = interLC(v(-3, 1), v(3, 1), v(0, 0), v(1, 0))!;
    close(r[0], 0, 1);
    close(r[1], 0, 1);
  });
  it('no intersection is undefined', () => expect(interLC(v(-3, 2), v(3, 2), v(0, 0), v(1, 0))).toBeNull());
});

describe('circle–circle', () => {
  it('order: first point is left of O1→O2 (manual §18.3.3 and the A/B example)', () => {
    const r = interCC(v(1, 1), v(5, 1), v(5, 1), v(1, 1))!;
    close(r[0], 3, 1 + Math.sqrt(12));
    close(r[1], 3, 1 - Math.sqrt(12));
    const [D, E] = interCC(v(0, 0), v(5, -1), v(2, 2), v(2, -1))!;
    expect(D.y).toBeGreaterThan(E.y); // D is the upper point in the manual figure
  });
  it('externally tangent circles give a double point', () => {
    const r = interCC(v(0, 0), v(1, 0), v(2, 0), v(3, 0))!;
    close(r[0], 1, 0);
    close(r[1], 1, 0);
  });
  it('internally tangent circles give a double point', () => {
    const r = interCC(v(0, 0), v(2, 0), v(1, 0), v(2, 0))!;
    close(r[0], 2, 0);
    close(r[1], 2, 0);
  });
  it('disjoint circles are undefined', () => expect(interCC(v(0, 0), v(1, 0), v(5, 0), v(6, 0))).toBeNull());
  it('nested circles are undefined', () => expect(interCC(v(0, 0), v(5, 0), v(1, 0), v(2, 0))).toBeNull());
  it('concentric circles are undefined', () => expect(interCC(v(0, 0), v(1, 0), v(0, 0), v(0, 1))).toBeNull());
});

describe('triangle centres', () => {
  const A = v(0, 0);
  const B = v(4, 0);
  const C = v(0, 3);
  it('circumcenter', () => close(circumcenter(A, B, C), 2, 1.5));
  it('incenter', () => close(incenter(A, B, C), 1, 1));
  it('centroid', () => close(centroid(A, B, C), 4 / 3, 1));
  it('orthocenter', () => close(orthocenter(A, B, C), 0, 0));
  it('collinear points are undefined', () => {
    const D = v(8, 0);
    expect(circumcenter(A, B, D)).toBeNull();
    expect(incenter(A, B, D)).toBeNull();
    expect(orthocenter(A, B, D)).toBeNull();
  });
});
