import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fullDocument, generate } from '../codegen/codegen';
import { extractBody } from '../codegen/export';
import { EXAMPLES } from '../examples';
import { evaluate } from '../geom/evaluate';
import type { Vec } from '../geom/vec';
import { moveFreePoint, type Graph, type PointId } from '../graph/types';
import type { Span } from '../parser/ast';
import { compile } from '../pipeline';
import { Canvas } from './Canvas';
import { targetAt, type HoverTarget } from './hover';
import { Editor, type EditorHandle } from './Editor';
import { roundCoord } from './rounding';

const PARSE_DEBOUNCE_MS = 150;

export function App() {
  const editor = useRef<EditorHandle>(null);
  /** Text that has been parsed (lags the editor by the debounce delay). */
  const [code, setCode] = useState(EXAMPLES[0]!.code);
  const [fitToken, setFitToken] = useState(0);
  const [hover, setHoverState] = useState<HoverTarget>(null);
  /** Who set the current hover; each side only clears its own (pointer events of the
   *  canvas fire before the editor's mouseleave, so a blind clear would erase them). */
  const hoverSource = useRef<'canvas' | 'editor' | null>(null);
  const setHoverFrom = useCallback((source: 'canvas' | 'editor', t: HoverTarget) => {
    if (t === null && hoverSource.current !== source) return;
    hoverSource.current = t ? source : null;
    setHoverState((h) => (h?.kind === t?.kind && h?.id === t?.id ? h : t));
  }, []);
  const onCanvasHover = useCallback((t: HoverTarget) => setHoverFrom('canvas', t), [setHoverFrom]);
  const [snap, setSnap] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const result = useMemo(() => compile(code), [code]);
  const [lastGraph, setLastGraph] = useState<Graph | null>(null);
  const graph = result.graph ?? lastGraph;
  if (result.graph && result.graph !== lastGraph) setLastGraph(result.graph);
  const pos = useMemo(() => (graph ? evaluate(graph) : new Map()), [graph]);
  const hasErrors = result.graph === null;

  // ------------------------------------------------------------ code → canvas
  const onUserChange = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCode(text), PARSE_DEBOUNCE_MS);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  /** Replace the whole text from outside (examples, drag) and parse right away. */
  const replaceCode = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current);
    editor.current?.setText(text);
    setCode(text);
  }, []);

  // ------------------------------------------------------------ canvas → code
  const onDrag = useCallback(
    (name: PointId, p: Vec) => {
      if (!result.graph) return;
      const x = roundCoord(p.x, snap);
      const y = roundCoord(p.y, snap);
      const step = result.graph.steps.find((s) => s.c.op === 'free' && s.c.out[0] === name);
      if (step?.c.op === 'free' && step.c.x === x && step.c.y === y) return;
      replaceCode(generate(moveFreePoint(result.graph, name, x, y)));
    },
    [result.graph, snap, replaceCode],
  );

  // ------------------------------------------------------------ hover linking
  // Spans only match the editor text when the shown graph was parsed from it.
  const spansValid = !hasErrors;
  const highlight = useMemo<Span[]>(() => {
    if (!hover || !graph || !spansValid) return [];
    const span =
      hover.kind === 'step' ? graph.steps.find((s) => s.id === hover.id)?.span : graph.drawings.find((d) => d.id === hover.id)?.span;
    return span ? [span] : [];
  }, [hover, graph, spansValid]);

  const onHoverOffset = useCallback(
    (offset: number | null) => {
      if (offset === null || !result.graph || editor.current?.getText() !== code) {
        setHoverFrom('editor', null);
        return;
      }
      setHoverFrom('editor', targetAt(result.graph, offset));
    },
    [result.graph, code, setHoverFrom],
  );

  // ------------------------------------------------------------ export
  const exportBody = (): { body: string; note: string } => {
    const text = editor.current?.getText() ?? code;
    const r = text === code ? result : compile(text);
    if (r.graph && r.diagnostics.some((d) => d.code === 'forward-ref')) {
      return { body: generate(r.graph), note: ' (reordered so every point is defined before use)' };
    }
    return { body: extractBody(text), note: r.graph ? '' : ' — note: the code has errors' };
  };
  const copy = async (what: 'body' | 'document') => {
    const { body, note } = exportBody();
    const text = what === 'body' ? body : fullDocument(body);
    const ok = await copyToClipboard(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(ok ? `Copied ${what === 'body' ? 'code' : 'full document'}${note}` : 'Copy failed: clipboard not available');
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  return (
    <div className="app">
      <div className="toolbar">
        <span className="brand">TikZGeo</span>
        <select
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) {
              replaceCode(ex.code);
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
        <span className="spacer" />
        {toast && <span className="toast">{toast}</span>}
        <button onClick={() => copy('body')} title="Copy the tkz-euclide commands only">
          Copy code
        </button>
        <button className="primary" onClick={() => copy('document')} title="Copy a compilable standalone document">
          Copy full document
        </button>
      </div>
      <div className="panes">
        <div className="left">
          <Editor
            ref={editor}
            initial={code}
            onUserChange={onUserChange}
            diagnostics={result.diagnostics}
            highlight={highlight}
            onHoverOffset={onHoverOffset}
          />
          <div className="status">
            {hasErrors && (
              <div className="stale">Showing the last valid figure. Dragging is disabled until the errors are fixed.</div>
            )}
            {result.diagnostics.length === 0 ? (
              <div className="ok">✓ No problems</div>
            ) : (
              result.diagnostics.map((d, i) => (
                <div key={i} className={`row ${d.severity}`} onClick={() => editor.current?.reveal(d.from, d.to)}>
                  <b>Line {d.line}:</b> {d.message}
                </div>
              ))
            )}
            <div className="note">
              Dragging a point regenerates the code in canonical form (definitions → drawings → labels); comments and
              custom formatting are dropped. Ctrl+Z undoes a whole drag.
            </div>
          </div>
        </div>
        <Canvas
          graph={graph}
          pos={pos}
          fitToken={fitToken}
          hover={hover}
          onHover={onCanvasHover}
          onDragStart={() => editor.current?.beginBatch()}
          onDrag={hasErrors ? undefined : onDrag}
          onDragEnd={() => editor.current?.endBatch()}
        />
      </div>
    </div>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
