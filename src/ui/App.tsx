import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractAsyBody, fullAsyDocument, generateAsy } from '../codegen/asy';
import { fullDocument, generate } from '../codegen/codegen';
import { extractBody } from '../codegen/export';
import { EXAMPLES } from '../examples';
import { evaluate } from '../geom/evaluate';
import type { Vec } from '../geom/vec';
import type { Graph, PointId } from '../graph/types';
import { isAux as isAuxName, type Span } from '../parser/ast';
import { compile, detectLang, type Lang } from '../pipeline';
import { Canvas } from './Canvas';
import { targetAt, type HoverTarget } from './hover';
import { Editor, type EditorHandle } from './Editor';
import { applyEdits, moveEdits, paramEdits, segmentOnly } from './literal';
import { ToolIcon } from './ToolIcons';
import { PropsPanel, type Selection } from './PropsPanel';
import { TOOL_TEXT, TOOLS, crossings, curveOfDrawing, handlePick, hintOf, initialState, nextInput, selectionOf, toolSpec, type Target, type ToolState } from './tools';

const PARSE_DEBOUNCE_MS = 150;

export type LangChoice = 'auto' | Lang;

export const LANG_NAMES: Record<Lang, string> = { tkz: 'tkz-euclide / TikZ', asy: 'Asymptote' };

export function App() {
  const editor = useRef<EditorHandle>(null);
  /** Text that has been parsed (lags the editor by the debounce delay). */
  const [code, setCode] = useState(EXAMPLES[0]!.code);
  const [langChoice, setLangChoice] = useState<LangChoice>('auto');
  const lang: Lang = langChoice === 'auto' ? detectLang(code) : langChoice;
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
  const [tool, setTool] = useState<ToolState>(initialState('move'));
  /** Selected object (move mode), kept by its command and points so it survives edits. */
  const [selKey, setSelKey] = useState<{ kind: 'point'; name: PointId } | { kind: 'drawing'; sig: string; side: [PointId, PointId] | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const result = useMemo(() => compile(code, lang), [code, lang]);
  const [lastGraph, setLastGraph] = useState<Graph | null>(null);
  const graph = result.graph ?? lastGraph;
  if (result.graph && result.graph !== lastGraph) setLastGraph(result.graph);
  const pos = useMemo(() => (graph ? evaluate(graph) : new Map()), [graph]);
  const hasErrors = result.graph === null;

  const say = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

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
  // Dragging rewrites only the numbers of the dragged point, in place.
  const onDrag = useCallback(
    (name: PointId, p: Vec) => {
      if (!result.graph || editor.current?.getText() !== code) return;
      const step = result.graph.steps.find((s) => s.c.out.length === 1 && s.c.out[0] === name);
      if (!step?.lit) return;
      let edits;
      if (step.c.op === 'free') edits = moveEdits(step.lit, p.x, p.y, snap)?.edits;
      else {
        const clamp = step.c.op === 'onLine' && segmentOnly(result.graph, step.c.args[0], step.c.args[1]);
        edits = paramEdits(step.c, step.lit, pos, p, snap, clamp)?.edits;
      }
      if (!edits) return;
      const next = applyEdits(code, edits);
      if (next !== code) replaceCode(next);
    },
    [result.graph, code, snap, replaceCode, pos],
  );

  // ------------------------------------------------------------ selection & properties
  const sigOf = (d: Graph['drawings'][number]) => `${d.d.cmd}:${d.d.groups.map((g) => g.join(',')).join(' ')}`;
  const selection: Selection = useMemo(() => {
    if (!selKey || !result.graph) return null;
    if (selKey.kind === 'point') return pos.get(selKey.name) ? selKey : null;
    const d = result.graph.drawings.find((x) => sigOf(x) === selKey.sig);
    return d ? { kind: 'drawing', id: d.id, side: selKey.side } : null;
  }, [selKey, result.graph, pos]);
  const onSelect = useCallback(
    (t: { kind: 'point'; name: PointId } | { kind: 'drawing'; id: string; at: Vec } | null) => {
      if (!t || !result.graph) return setSelKey(null);
      if (t.kind === 'point') return setSelKey(isAuxName(t.name) ? null : t);
      const d = result.graph.drawings.find((x) => x.id === t.id);
      if (!d) return setSelKey(null);
      const c = curveOfDrawing(result.graph, pos, t.id, t.at);
      setSelKey({ kind: 'drawing', sig: sigOf(d), side: c?.kind === 'line' ? [c.a, c.b] : null });
    },
    [result.graph, pos],
  );
  const editFromPanel = useCallback(
    (text: string) => {
      if (editor.current?.getText() !== code) return;
      replaceCode(text);
    },
    [code, replaceCode],
  );

  // ------------------------------------------------------------ construction tools
  const picking = tool.tool !== 'move' && !hasErrors;
  const crossingMarks = useMemo(
    () => (picking && graph && nextInput(tool) !== 'object' && nextInput(tool) !== 'circle' ? crossings(graph, pos).map((x) => x.at) : []),
    [picking, graph, pos, tool],
  );
  const onPick = useCallback(
    (t: Target) => {
      const current = editor.current?.getText() ?? code;
      const out = handlePick(tool, t, current, lang, snap);
      setTool(out.state);
      if (out.text !== undefined) replaceCode(out.text);
      if (out.undefinedPoints?.length) say(`${out.undefinedPoints.join(', ')}: not defined here (the objects don't meet)`);
      else if (out.rejected) say(hintOf(tool));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, code, lang, snap, replaceCode],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTool((s) => initialState(s.tool, s.param));
        setSelKey(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // ------------------------------------------------------------ export & convert
  const exportBody = (): { body: string; note: string } => {
    const text = editor.current?.getText() ?? code;
    if (lang === 'asy') return { body: extractAsyBody(text), note: result.graph ? '' : ' — note: the code has errors' };
    const r = text === code ? result : compile(text, lang);
    if (r.graph && r.diagnostics.some((d) => d.code === 'forward-ref')) {
      return { body: generate(r.graph), note: ' (reordered so every point is defined before use)' };
    }
    return { body: extractBody(text), note: r.graph ? '' : ' — note: the code has errors' };
  };
  const copy = async (what: 'body' | 'document') => {
    const { body, note } = exportBody();
    const text = what === 'body' ? body : lang === 'asy' ? fullAsyDocument(body) : fullDocument(body);
    const ok = await copyToClipboard(text);
    say(ok ? `Copied ${what === 'body' ? 'code' : 'full document'}${note}` : 'Copy failed: clipboard not available');
  };
  const convert = (to: Lang) => {
    if (!result.graph) return;
    const notes: string[] = [];
    const text = to === 'asy' ? generateAsy(result.graph, { pos, notes, precise: true }) : generate(result.graph, { pos, notes, precise: true });
    setLangChoice('auto');
    replaceCode(text);
    editor.current?.reveal(0, 0); // focus the editor so Ctrl+Z undoes the conversion
    setFitToken((t) => t + 1);
    say(`Converted to ${LANG_NAMES[to]}${notes.length ? ` (${notes.length} note${notes.length > 1 ? 's' : ''}: ${notes[0]})` : ''}. Ctrl+Z brings the original back.`);
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
        <select value={langChoice} onChange={(e) => setLangChoice(e.target.value as LangChoice)} title="Language of the code">
          <option value="auto">Auto ({LANG_NAMES[detectLang(code)]})</option>
          <option value="tkz">{LANG_NAMES.tkz}</option>
          <option value="asy">{LANG_NAMES.asy}</option>
        </select>
        <button onClick={() => setFitToken((t) => t + 1)}>Fit view</button>
        <label title="Round dragged points to multiples of 0.5 (polar points: 5°)">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap
        </label>
        <span className="spacer" />
        {toast && <span className="toast">{toast}</span>}
        <button onClick={() => convert(lang === 'asy' ? 'tkz' : 'asy')} disabled={hasErrors} title="Rewrite the figure in the other language">
          Convert to {lang === 'asy' ? 'tkz-euclide' : 'Asymptote'}
        </button>
        <button onClick={() => copy('body')} title="Copy the drawing code only">
          Copy code
        </button>
        <button className="primary" onClick={() => copy('document')} title="Copy a compilable standalone document">
          Copy full document
        </button>
      </div>
      <div className="tools">
        {TOOLS.map((tl, i) => (
          <button
            key={tl.id}
            className={`tool${tool.tool === tl.id ? ' active' : ''}${i > 0 && TOOLS[i - 1]!.group !== tl.group ? ' sep' : ''}`}
            title={TOOL_TEXT[tl.id]}
            aria-label={TOOL_TEXT[tl.id]}
            aria-pressed={tool.tool === tl.id}
            onClick={() => {
              setTool(initialState(tl.id));
              setSelKey(null);
            }}
          >
            <ToolIcon id={tl.id} />
          </button>
        ))}
        <span className="sep" />
        <button className="tool text" onClick={() => editor.current?.undo()} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button className="tool text" onClick={() => editor.current?.redo()} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        {toolSpec(tool.tool).param && (
          <label className="param">
            {toolSpec(tool.tool).param!.kind === 'angle' ? 'Angle (°)' : 'Factor'}{' '}
            <input
              type="number"
              step={toolSpec(tool.tool).param!.kind === 'angle' ? 15 : 0.5}
              value={tool.param ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value !== '' && Number.isFinite(v)) setTool((s) => ({ ...s, param: v }));
              }}
            />
          </label>
        )}
        <span className="hint">
          {tool.tool === 'move' ? 'Move: drag points (teal ones slide along their object), click an object to edit its style.' : hintOf(tool)}
          {picking && nextInput(tool) === 'point' ? ' · Shift: on the object, not at the crossing' : ''}
        </span>
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
            language={lang === 'asy' ? 'asy' : 'tex'}
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
              Dragging a point rewrites only its numbers in the code. Points written as (angle:r) or dir(angle) move along their
              circle. Ctrl+Z undoes a whole drag.
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
          picking={picking}
          onPick={onPick}
          selected={picking ? selectionOf(tool) : selection ? (selection.kind === 'point' ? { points: [selection.name], drawings: [] } : { points: [], drawings: [selection.id] }) : undefined}
          crossings={crossingMarks}
          onSelect={tool.tool === 'move' ? onSelect : undefined}
          overlay={
            !picking && graph && selection ? (
              <PropsPanel graph={graph} selection={selection} lang={lang} code={code} onEdit={editFromPanel} onClose={() => setSelKey(null)} />
            ) : null
          }
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
