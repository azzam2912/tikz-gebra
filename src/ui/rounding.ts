/** Round a dragged coordinate: 2 decimals, or the 0.5 grid when snapping. Never returns -0. */
export function roundCoord(n: number, snap: boolean): number {
  const r = snap ? Math.round(n * 2) / 2 : Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}
