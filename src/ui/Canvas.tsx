import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Evaluated } from '../geom/evaluate';
import type { Vec } from '../geom/vec';
import type { Graph, PointId } from '../graph/types';
import { isAux } from '../parser/ast';
import { boundingBox, labelsOf, pointHandles, rightAnglePath, shapesOf, texRuns, type LabelSpec, type StyledShape } from './shapes';
import { fitBox, gridStep, panBy, toMath, toScreen, zoomAt, type Viewport } from './viewport';

import type { HoverTarget } from './hover';
import type { Target } from './tools';

export type { HoverTarget };

export interface CanvasProps {
  graph: Graph | null;
  pos: Evaluated;
  /** Increment to re-fit the view to the figure. */
  fitToken: number;
  hover: HoverTarget;
  onHover: (h: HoverTarget) => void;
  /** Called continuously while a free point is dragged (math coords, unrounded). */
  onDrag?: (name: PointId, p: Vec) => void;
  onDragStart?: (name: PointId) => void;
  onDragEnd?: () => void;
  /** A construction tool is active: a click picks a point / object / spot instead of dragging. */
  picking?: boolean;
  onPick?: (t: Target) => void;
  /** Points and drawings already picked by the active tool (highlighted). */
  selected?: { points: PointId[]; drawings: string[] };
  /** Crossings of drawn objects a click can snap to (shown as small × marks). */
  crossings?: Vec[];
  /** Move mode: a click without dragging selects a point or a drawing (null = empty spot). */
  onSelect?: (t: { kind: 'point'; name: PointId } | { kind: 'drawing'; id: string; at: Vec } | null) => void;
  /** Shown over the canvas (the properties panel). */
  overlay?: React.ReactNode;
}

const POINT_R_FREE = 5.5;
const POINT_R_DERIVED = 3.5;
const POINT_R_GLIDER = 4.5;

export function Canvas({ graph, pos, fitToken, hover, onHover, onDrag, onDragStart, onDragEnd, picking, onPick, selected, crossings, onSelect, overlay }: CanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ cx: 0, cy: 0, scale: 50, width: 800, height: 600 });
  const sized = useRef(false);

  // track size
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setVp((v) => ({ ...v, width: r.width, height: r.height }));
      sized.current = true;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit when asked (and once the size is known)
  const graphRef = useRef(graph);
  const posRef = useRef(pos);
  graphRef.current = graph;
  posRef.current = pos;
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const g = graphRef.current;
      setVp((v) => fitBox(v, g ? boundingBox(g, posRef.current) : null));
    });
    return () => cancelAnimationFrame(id);
  }, [fitToken]);

  // wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      setVp((v) => zoomAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, factor));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // ------------------------------------------------------------ pointer: pan + drag
  const action = useRef<
    | { type: 'pan'; last: Vec; id: number; start?: Vec; target?: Element; moved?: boolean }
    | { type: 'drag'; name: PointId; offset: Vec; id: number; moved?: boolean }
    | { type: 'click'; start: Vec; last: Vec; id: number; target: Element }
    | null
  >(null);
  const [cursor, setCursor] = useState<'grab' | 'grabbing' | 'move' | 'default'>('grab');

  const local = (e: React.PointerEvent): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = (e.target as Element).closest('[data-free-point]');
    const s = local(e);
    if (picking) {
      // a click picks; moving more than a few pixels pans instead
      action.current = { type: 'click', start: s, last: s, id: e.pointerId, target: e.target as Element };
    } else if (target && onDrag) {
      const name = target.getAttribute('data-free-point')!;
      const p = pos.get(name);
      if (!p) return;
      const m = toMath(vp, s);
      action.current = { type: 'drag', name, offset: { x: p.x - m.x, y: p.y - m.y }, id: e.pointerId };
      setCursor('move');
      onDragStart?.(name);
    } else {
      // a pan that doesn't move is a click: it selects (move mode)
      action.current = { type: 'pan', last: s, id: e.pointerId, start: s, target: e.target as Element };
      setCursor('grabbing');
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const a = action.current;
    if (!a || a.id !== e.pointerId) return;
    const s = local(e);
    if (a.type === 'click') {
      if (Math.hypot(s.x - a.start.x, s.y - a.start.y) > 4) {
        action.current = { type: 'pan', last: a.last, id: a.id };
        setCursor('grabbing');
      } else a.last = s;
      return;
    }
    if (a.type === 'pan') {
      if (a.start && Math.hypot(s.x - a.start.x, s.y - a.start.y) > 4) a.moved = true;
      const dx = s.x - a.last.x;
      const dy = s.y - a.last.y;
      a.last = s;
      setVp((v) => panBy(v, dx, dy));
    } else {
      a.moved = true;
      const m = toMath(vp, s);
      onDrag?.(a.name, { x: m.x + a.offset.x, y: m.y + a.offset.y });
    }
  };

  const endAction = (e: React.PointerEvent) => {
    const a = action.current;
    if (!a || a.id !== e.pointerId) return;
    action.current = null;
    setCursor('grab');
    if (a.type === 'drag') {
      onDragEnd?.();
      if (!a.moved) onSelect?.({ kind: 'point', name: a.name });
    }
    if (a.type === 'pan' && !a.moved && a.start && a.target && onSelect) {
      const pt = a.target.closest('[data-point]');
      const dr = a.target.closest('[data-drawing]');
      if (pt) onSelect({ kind: 'point', name: pt.getAttribute('data-point')! });
      else if (dr) onSelect({ kind: 'drawing', id: dr.getAttribute('data-drawing')!, at: toMath(vp, a.start) });
      else onSelect(null);
    }
    if (a.type === 'click' && onPick) {
      const pt = a.target.closest('[data-point]');
      const dr = a.target.closest('[data-drawing]');
      const at = toMath(vp, a.start);
      // a click within 10 px of a crossing snaps to it; Shift puts the point on the object instead
      const tol = 10 / vp.scale;
      const shift = e.shiftKey;
      if (pt) onPick({ kind: 'point', name: pt.getAttribute('data-point')! });
      else if (dr) onPick({ kind: 'drawing', id: dr.getAttribute('data-drawing')!, at, tol, shift });
      else onPick({ kind: 'empty', at, tol, shift });
    }
  };

  // ------------------------------------------------------------ rendering
  const S = useCallback((p: Vec) => toScreen(vp, p), [vp]);
  const colors = graph?.colors ?? {};
  const handles = useMemo(() => (graph ? pointHandles(graph, pos) : []), [graph, pos]);

  const hoveredStep = hover?.kind === 'step' ? hover.id : null;
  const hoveredDrawing = hover?.kind === 'drawing' ? hover.id : null;
  const dragging = action.current?.type === 'drag' ? action.current.name : null;

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className="canvas"
        width={vp.width}
        height={vp.height}
        style={{ cursor: picking && cursor === 'grab' ? 'crosshair' : cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endAction}
        onPointerCancel={endAction}
        onPointerLeave={() => !action.current && onHover(null)}
      >
        <Grid vp={vp} />
        {graph?.drawings.map((d) => {
          const shapes = shapesOf(d, pos, colors);
          if (shapes.length === 0) return null;
          const sel = !!selected?.drawings.includes(d.id);
          const hot = hoveredDrawing === d.id || sel;
          return (
            <g
              key={d.id}
              data-drawing={d.id}
              className={'drawing' + (hot ? ' hot' : '') + (sel ? ' sel' : '')}
              onPointerEnter={() => !action.current && onHover({ kind: 'drawing', id: d.id })}
              onPointerLeave={() => !action.current && onHover(null)}
            >
              {shapes.map((s, i) => (
                <ShapeView key={i} s={s} S={S} vp={vp} hot={hot} />
              ))}
            </g>
          );
        })}
        {handles.map((h) => {
          const q = S(h.at);
          const hot = hoveredStep === h.stepId || dragging === h.name;
          const r = h.free ? POINT_R_FREE : h.glider ? POINT_R_GLIDER : POINT_R_DERIVED;
          const canDrag = h.draggable && !!onDrag;
          return (
            <g
              key={h.name}
              className={`pt ${h.free ? 'free' : 'derived'}${h.glider ? ' glider' : ''}${h.ghost ? ' ghost' : ''}${hot ? ' hot' : ''}${h.free && !canDrag ? ' fixed' : ''}${selected?.points.includes(h.name) ? ' sel' : ''}`}
              data-point={h.name}
              {...(canDrag && !picking ? { 'data-free-point': h.name } : {})}
              onPointerEnter={() => !action.current && onHover({ kind: 'step', id: h.stepId })}
              onPointerLeave={() => !action.current && onHover(null)}
            >
              {/* larger invisible hit area */}
              <circle cx={q.x} cy={q.y} r={h.free || h.glider ? 11 : 8} className="hit" />
              <circle cx={q.x} cy={q.y} r={hot ? r + 2 : r} className="dot" />
              {hot && (
                <text x={q.x + 10} y={q.y - 10} className="tip">
                  {isAux(h.name) ? '' : h.name}
                  {h.free ? `${isAux(h.name) ? '' : ' '}(${fmt2(h.at.x)}, ${fmt2(h.at.y)})` : ''}
                </text>
              )}
            </g>
          );
        })}
        {graph?.drawings.flatMap((d) =>
          labelsOf(d, pos, colors).map((l, i) => <Label key={`${d.id}-${i}`} l={l} S={S} hot={hoveredDrawing === d.id} />),
        )}
        {crossings?.map((c, i) => {
          const q = S(c);
          return <path key={`x${i}`} className="crossing" d={`M${q.x - 4},${q.y - 4} L${q.x + 4},${q.y + 4} M${q.x - 4},${q.y + 4} L${q.x + 4},${q.y - 4}`} />;
        })}
      </svg>
      {overlay}
      <div className="legend">
        <span>
          <i style={{ width: 9, height: 9, background: 'var(--free)' }} />
          free (drag)
        </span>
        <span>
          <i style={{ width: 8, height: 8, background: 'var(--glider)' }} />
          on an object (drag along it)
        </span>
        <span>
          <i style={{ width: 6, height: 6, background: 'var(--derived)' }} />
          derived
        </span>
        <span>
          <i style={{ width: 6, height: 6, background: 'var(--derived)', opacity: 0.45 }} />
          not drawn as a point
        </span>
      </div>
    </div>
  );
}

const fmt2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** px per pt of line width, and the default width (tkz-euclide "thin" = 0.4pt → 1.4px). */
const widthPx = (w: number | undefined) => (w === undefined ? undefined : 0.9 + w * 1.25);

function strokeProps(s: StyledShape, hot: boolean): React.SVGProps<SVGElement> {
  const st = s.style;
  const props: React.SVGProps<SVGElement> & { style: React.CSSProperties } = { style: {} };
  if (!hot) {
    if (st.color) props.style.stroke = st.color;
    if (st.noStroke || s.fillOnly) props.style.stroke = 'none';
    const w = widthPx(st.width);
    if (w !== undefined) props.style.strokeWidth = w;
  }
  if (st.dash) props.style.strokeDasharray = st.dash.map((d) => Math.max(d * 2.2, 1)).join(' ');
  if (st.fill && (s.shape.type === 'polygon' || s.shape.type === 'circle' || (s.shape.type === 'arc' && s.shape.sector))) {
    props.style.fill = st.fill;
    props.style.fillOpacity = st.fillOpacity ?? (s.fillOnly ? 1 : 1);
  }
  return props;
}

/** SVG path of an arc around screen point c, radius r px, from t1 counter-clockwise to t2 (radians). */
function arcPath(c: Vec, r: number, t1: number, t2: number): string {
  const p1 = { x: c.x + r * Math.cos(t1), y: c.y - r * Math.sin(t1) };
  const p2 = { x: c.x + r * Math.cos(t2), y: c.y - r * Math.sin(t2) };
  if (t2 - t1 >= 2 * Math.PI - 1e-9) {
    const m = { x: c.x - r * Math.cos(t1), y: c.y + r * Math.sin(t1) };
    return `M${p1.x},${p1.y} A${r},${r} 0 1 0 ${m.x},${m.y} A${r},${r} 0 1 0 ${p1.x},${p1.y}`;
  }
  const large = t2 - t1 > Math.PI ? 1 : 0;
  return `M${p1.x},${p1.y} A${r},${r} 0 ${large} 0 ${p2.x},${p2.y}`;
}

function ShapeView({ s, S, vp, hot }: { s: StyledShape; S: (p: Vec) => Vec; vp: Viewport; hot: boolean }) {
  const sp = strokeProps(s, hot);
  const sh = s.shape;
  const pair = (d: string) => (
    <>
      <path d={d} className="hit" />
      <path d={d} className="stroke" {...(sp as React.SVGProps<SVGPathElement>)} />
    </>
  );
  const poly = (pts: Vec[], closed: boolean) => pts.map(S).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + (closed ? ' Z' : '');
  switch (sh.type) {
    case 'segment':
    case 'tick': {
      if (sh.type === 'tick') {
        const a = S(sh.a);
        const b = S(sh.b);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const u = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
        const n = { x: -u.y * 5, y: u.x * 5 };
        const count = sh.n ?? 1;
        const d = Array.from({ length: count }, (_, i) => {
          const off = (i - (count - 1) / 2) * 3.2;
          const c = { x: m.x + u.x * off, y: m.y + u.y * off };
          return `M${c.x - n.x},${c.y - n.y} L${c.x + n.x},${c.y + n.y}`;
        }).join(' ');
        return pair(d);
      }
      const a = S(sh.a);
      const b = S(sh.b);
      return pair(`M${a.x},${a.y} L${b.x},${b.y}`);
    }
    case 'line': {
      // long enough to cross the whole view
      const a = S(sh.a);
      const b = S(sh.b);
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = (vp.width + vp.height + Math.hypot(a.x - vp.width / 2, a.y - vp.height / 2) * 2) / l;
      return pair(`M${a.x - (b.x - a.x) * k},${a.y - (b.y - a.y) * k} L${a.x + (b.x - a.x) * k},${a.y + (b.y - a.y) * k}`);
    }
    case 'polygon':
      return pair(poly(sh.pts, true));
    case 'polyline':
      return pair(poly(sh.pts, false));
    case 'rightAngle':
      return pair(poly(rightAnglePath(sh), false));
    case 'angle': {
      const c = S(sh.b);
      const count = sh.n ?? 1;
      const d = Array.from({ length: count }, (_, i) => arcPath(c, sh.r * vp.scale + (i - (count - 1) / 2) * 3, sh.t1, sh.t2)).join(' ');
      return pair(d);
    }
    case 'arc': {
      const c = S(sh.c);
      const d = arcPath(c, sh.r * vp.scale, sh.t1, sh.t2);
      return pair(sh.sector ? `M${c.x},${c.y} L${d.slice(1)} Z` : d);
    }
    case 'circle': {
      const c = S(sh.c);
      const r = sh.r * vp.scale;
      return (
        <>
          <circle cx={c.x} cy={c.y} r={r} className="hit" />
          <circle cx={c.x} cy={c.y} r={r} className="stroke" {...(sp as React.SVGProps<SVGCircleElement>)} />
        </>
      );
    }
  }
}

/** A label: TeX-ish text ($A_1$, $O'$, $15\dg$) placed in its direction from the point. */
function Label({ l, S, hot }: { l: LabelSpec; S: (p: Vec) => Vec; hot: boolean }) {
  const q = S(l.at);
  let x = q.x;
  let y = q.y;
  let anchor: 'start' | 'middle' | 'end' = 'middle';
  let baseline: 'auto' | 'hanging' | 'central' = 'central';
  if (l.dir) {
    const t = (l.dir.angle * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const gap = 4 + 3 * Math.min(Math.max(l.dir.k, 0.3), 3);
    x += c * gap;
    y -= s * gap;
    anchor = c > 0.35 ? 'start' : c < -0.35 ? 'end' : 'middle';
    baseline = s > 0.35 ? 'auto' : s < -0.35 ? 'hanging' : 'central';
  }
  const runs = texRuns(l.text);
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline={baseline} className={'label' + (hot ? ' hot' : '')} style={!hot && l.color ? { fill: l.color } : undefined}>
      {runs.map((r, i) =>
        r.shift ? (
          <tspan key={i} className="sub" baselineShift={r.shift}>
            {r.text}
          </tspan>
        ) : (
          <tspan key={i}>{r.text}</tspan>
        ),
      )}
    </text>
  );
}

function Grid({ vp }: { vp: Viewport }) {
  const step = gridStep(vp.scale);
  const tl = toMath(vp, { x: 0, y: 0 });
  const br = toMath(vp, { x: vp.width, y: vp.height });
  const lines: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  const x0 = Math.floor(tl.x / step) * step;
  const y0 = Math.floor(br.y / step) * step;
  const origin = toScreen(vp, { x: 0, y: 0 });
  const axisLabelY = Math.min(Math.max(origin.y + 4, 4), vp.height - 14);
  const axisLabelX = Math.min(Math.max(origin.x - 4, 24), vp.width - 4);
  const dec = step < 1 ? 1 : 0;
  for (let x = x0; x <= br.x; x += step) {
    const sx = toScreen(vp, { x, y: 0 }).x;
    const isAxis = Math.abs(x) < step / 2;
    lines.push(<line key={`x${x.toFixed(3)}`} x1={sx} x2={sx} y1={0} y2={vp.height} className={isAxis ? 'axis' : 'grid'} />);
    if (!isAxis) {
      labels.push(
        <text key={`lx${x.toFixed(3)}`} x={sx} y={axisLabelY} className="tick" textAnchor="middle" dominantBaseline="hanging">
          {x.toFixed(dec)}
        </text>,
      );
    }
  }
  for (let y = y0; y <= tl.y; y += step) {
    const sy = toScreen(vp, { x: 0, y }).y;
    const isAxis = Math.abs(y) < step / 2;
    lines.push(<line key={`y${y.toFixed(3)}`} y1={sy} y2={sy} x1={0} x2={vp.width} className={isAxis ? 'axis' : 'grid'} />);
    if (!isAxis) {
      labels.push(
        <text key={`ly${y.toFixed(3)}`} x={axisLabelX} y={sy} className="tick" textAnchor="end" dominantBaseline="central">
          {y.toFixed(dec)}
        </text>,
      );
    }
  }
  return (
    <g className="grid-layer">
      {lines}
      {labels}
    </g>
  );
}
