import { useCallback, useMemo, useState } from 'react';
import { generate } from '../codegen/codegen';
import { EXAMPLES } from '../examples';
import { evaluate } from '../geom/evaluate';
import type { Vec } from '../geom/vec';
import { moveFreePoint, type Graph, type PointId } from '../graph/types';
import { compile } from '../pipeline';
import { Canvas, type HoverTarget } from './Canvas';
import { roundCoord } from './rounding';

export function App() {
  const [code, setCode] = useState(EXAMPLES[0]!.code);
  const [fitToken, setFitToken] = useState(0);
  const [hover, setHover] = useState<HoverTarget>(null);
  const [snap, setSnap] = useState(false);

  const result = useMemo(() => compile(code), [code]);
  const [lastGraph, setLastGraph] = useState<Graph | null>(null);
  const graph = result.graph ?? lastGraph;
  if (result.graph && result.graph !== lastGraph) setLastGraph(result.graph);
  const pos = useMemo(() => (graph ? evaluate(graph) : new Map()), [graph]);
  const hasErrors = result.graph === null;

  const onDrag = useCallback(
    (name: PointId, p: Vec) => {
      if (!result.graph) return;
      const x = roundCoord(p.x, snap);
      const y = roundCoord(p.y, snap);
      const step = result.graph.steps.find((s) => s.c.op === 'free' && s.c.out[0] === name);
      if (step?.c.op === 'free' && step.c.x === x && step.c.y === y) return;
      setCode(generate(moveFreePoint(result.graph, name, x, y)));
    },
    [result.graph, snap],
  );

  return (
    <div className="app">
      <div className="toolbar">
        <span className="brand">TikZGeo</span>
        <select
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) {
              setCode(ex.code);
              setFitToken((t) => t + 1);
            }
          }}
        >
          <option value="">Load example…</option>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
        <button onClick={() => setFitToken((t) => t + 1)}>Fit view</button>
        <label title="Round dragged points to multiples of 0.5">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to 0.5
        </label>
      </div>
      <div className="panes">
        <div className="left">
          <textarea className="plain-editor" value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
          <div className="status">
            {hasErrors && <div className="stale">Showing the last valid figure — dragging is disabled until the errors are fixed.</div>}
            {result.diagnostics.length === 0 ? (
              <div className="ok">✓ No problems</div>
            ) : (
              result.diagnostics.map((d, i) => (
                <div key={i} className={`row ${d.severity}`}>
                  <b>Line {d.line}:</b> {d.message}
                </div>
              ))
            )}
            <div className="note">
              Dragging a point regenerates the code in canonical form (definitions → drawings → labels); comments and
              custom formatting are dropped.
            </div>
          </div>
        </div>
        <Canvas
          graph={graph}
          pos={pos}
          fitToken={fitToken}
          hover={hover}
          onHover={setHover}
          onDrag={hasErrors ? undefined : onDrag}
        />
      </div>
    </div>
  );
}
