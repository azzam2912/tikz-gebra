import { useMemo, useState } from 'react';
import { EXAMPLES } from '../examples';
import { evaluate } from '../geom/evaluate';
import type { Graph } from '../graph/types';
import { compile } from '../pipeline';
import { Canvas, type HoverTarget } from './Canvas';

export function App() {
  const [code, setCode] = useState(EXAMPLES[0]!.code);
  const [fitToken, setFitToken] = useState(0);
  const [hover, setHover] = useState<HoverTarget>(null);

  const result = useMemo(() => compile(code), [code]);
  const [lastGraph, setLastGraph] = useState<Graph | null>(null);
  const graph = result.graph ?? lastGraph;
  if (result.graph && result.graph !== lastGraph) setLastGraph(result.graph);
  const pos = useMemo(() => (graph ? evaluate(graph) : new Map()), [graph]);

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
      </div>
      <div className="panes">
        <div className="left">
          <textarea className="plain-editor" value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
          <div className="status">
            {result.diagnostics.length === 0 ? (
              <div className="ok">✓ No problems</div>
            ) : (
              result.diagnostics.map((d, i) => (
                <div key={i} className={`row ${d.severity}`}>
                  <b>Line {d.line}:</b> {d.message}
                </div>
              ))
            )}
          </div>
        </div>
        <Canvas graph={graph} pos={pos} fitToken={fitToken} hover={hover} onHover={setHover} />
      </div>
    </div>
  );
}
