import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Evaluated } from '../geom/evaluate';
import type { Vec } from '../geom/vec';
import type { Graph, PointId } from '../graph/types';
import { boundingBox, drawnPoints, labelsOf, shapesOf, type LabelPos, type Shape } from './shapes';
import { fitBox, gridStep, panBy, toMath, toScreen, zoomAt, type Viewport } from './viewport';

import type { HoverTarget } from './hover';

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
}

const POINT_R_FREE = 5.5;
const POINT_R_DERIVED = 3.5;

export function Canvas({ graph, pos, fitToken, hover, onHover, onDrag, onDragStart, onDragEnd }: CanvasProps) {
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
    { type: 'pan'; last: Vec; id: number } | { type: 'drag'; name: PointId; offset: Vec; id: number } | null
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
    if (target && onDrag) {
      const name = target.getAttribute('data-free-point')!;
      const p = pos.get(name);
      if (!p) return;
      const m = toMath(vp, s);
      action.current = { type: 'drag', name, offset: { x: p.x - m.x, y: p.y - m.y }, id: e.pointerId };
      setCursor('move');
      onDragStart?.(name);
    } else {
      action.current = { type: 'pan', last: s, id: e.pointerId };
      setCursor('grabbing');
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const a = action.current;
    if (!a || a.id !== e.pointerId) return;
    const s = local(e);
    if (a.type === 'pan') {
      const dx = s.x - a.last.x;
      const dy = s.y - a.last.y;
      a.last = s;
      setVp((v) => panBy(v, dx, dy));
    } else {
      const m = toMath(vp, s);
      onDrag?.(a.name, { x: m.x + a.offset.x, y: m.y + a.offset.y });
    }
  };

  const endAction = (e: React.PointerEvent) => {
    const a = action.current;
    if (!a || a.id !== e.pointerId) return;
    action.current = null;
    setCursor('grab');
    if (a.type === 'drag') onDragEnd?.();
  };

  // ------------------------------------------------------------ rendering
  const drawn = useMemo(() => (graph ? drawnPoints(graph) : new Set<PointId>()), [graph]);
  const S = useCallback((p: Vec) => toScreen(vp, p), [vp]);

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
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endAction}
        onPointerCancel={endAction}
        onPointerLeave={() => !action.current && onHover(null)}
      >
        <Grid vp={vp} />
        {graph?.drawings.map((d) => {
          const shapes = shapesOf(d, pos);
          if (shapes.length === 0) return null;
          const hot = hoveredDrawing === d.id;
          return (
            <g
              key={d.id}
              className={'drawing' + (hot ? ' hot' : '')}
              onPointerEnter={() => !action.current && onHover({ kind: 'drawing', id: d.id })}
              onPointerLeave={() => !action.current && onHover(null)}
            >
              {shapes.map((s, i) => (
                <ShapeView key={i} s={s} S={S} scale={vp.scale} />
              ))}
            </g>
          );
        })}
        {graph?.steps.flatMap((step) =>
          step.c.out.map((name) => {
            const p = pos.get(name);
            if (!p) return null;
            const q = S(p);
            const free = step.c.op === 'free';
            const hot = hoveredStep === step.id || dragging === name;
            const ghost = !drawn.has(name);
            const r = free ? POINT_R_FREE : POINT_R_DERIVED;
            return (
              <g
                key={name}
                className={`pt ${free ? 'free' : 'derived'}${ghost ? ' ghost' : ''}${hot ? ' hot' : ''}`}
                {...(free && onDrag ? { 'data-free-point': name } : {})}
                onPointerEnter={() => !action.current && onHover({ kind: 'step', id: step.id })}
                onPointerLeave={() => !action.current && onHover(null)}
              >
                {/* larger invisible hit area */}
                <circle cx={q.x} cy={q.y} r={free ? 11 : 8} className="hit" />
                <circle cx={q.x} cy={q.y} r={hot ? r + 2 : r} className="dot" />
                {hot && (
                  <text x={q.x + 10} y={q.y - 10} className="tip">
                    {name}
                    {free ? ` (${fmt2(p.x)}, ${fmt2(p.y)})` : ''}
                  </text>
                )}
              </g>
            );
          }),
        )}
        {graph?.drawings.flatMap((d) =>
          labelsOf(d, pos).map((l, i) => {
            const q = S(l.at);
            return (
              <Label key={`${d.id}-${i}`} x={q.x} y={q.y} pos={l.pos} name={l.name} hot={hoveredDrawing === d.id} />
            );
          }),
        )}
      </svg>
      <div className="legend">
        <span>
          <i style={{ width: 9, height: 9, background: 'var(--free)' }} />
          free (drag)
        </span>
        <span>
          <i style={{ width: 6, height: 6, background: 'var(--derived)' }} />
          derived
        </span>
        <span>
          <i style={{ width: 6, height: 6, background: 'var(--derived)', opacity: 0.45 }} />
          not in \tkzDrawPoints
        </span>
      </div>
    </div>
  );
}

const fmt2 = (n: number) => (Math.round(n * 100) / 100).toString();

function ShapeView({ s, S }: { s: Shape; S: (p: Vec) => Vec; scale: number }) {
  switch (s.type) {
    case 'segment': {
      const a = S(s.a);
      const b = S(s.b);
      return (
        <>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="hit" />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke" />
        </>
      );
    }
    case 'polygon': {
      const d = s.pts.map(S).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') + ' Z';
      return (
        <>
          <path d={d} className="hit" />
          <path d={d} className="stroke" />
        </>
      );
    }
    case 'circle': {
      const c = S(s.c);
      const r = Math.abs(S({ x: s.c.x + s.r, y: s.c.y }).x - c.x);
      return (
        <>
          <circle cx={c.x} cy={c.y} r={r} className="hit" />
          <circle cx={c.x} cy={c.y} r={r} className="stroke" />
        </>
      );
    }
  }
}

/** Point label like LaTeX's $A$, with _x / _{xy} subscripts and primes. */
function Label({ x, y, pos, name, hot }: { x: number; y: number; pos: LabelPos; name: string; hot: boolean }) {
  const gap = 6;
  const dx = pos.h === 'right' ? gap : pos.h === 'left' ? -gap : 0;
  const dy = pos.v === 'above' ? -gap : pos.v === 'below' ? gap : 0;
  const anchor = pos.h === 'right' ? 'start' : pos.h === 'left' ? 'end' : 'middle';
  const baseline = pos.v === 'above' ? 'auto' : pos.v === 'below' ? 'hanging' : 'central';
  const m = /^([^_]*)(?:_\{?([^}]*)\}?)?$/.exec(name);
  const main = (m?.[1] ?? name).replace(/'/g, '′');
  const sub = m?.[2];
  return (
    <text
      x={x + dx}
      y={y + dy}
      textAnchor={anchor}
      dominantBaseline={baseline}
      className={'label' + (hot ? ' hot' : '')}
    >
      {main}
      {sub && (
        <tspan className="sub" baselineShift="sub">
          {sub.replace(/'/g, '′')}
        </tspan>
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
