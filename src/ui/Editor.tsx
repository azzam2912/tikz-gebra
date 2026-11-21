import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { c as clike } from '@codemirror/legacy-modes/mode/clike';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  type DecorationSet,
} from '@codemirror/view';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Diagnostic, Span } from '../parser/ast';
import { minimalChange } from './textdiff';

export interface EditorHandle {
  /** Replace the whole text (not reported through onUserChange). */
  setText(text: string, opts?: { history?: boolean }): void;
  /** Start a batch of external edits (a drag): intermediate edits don't enter the undo history. */
  beginBatch(): void;
  /** Close the batch: the whole batch becomes one undoable change. */
  endBatch(): void;
  /** Move the cursor to a range and focus. */
  reveal(from: number, to: number): void;
  getText(): string;
}

export interface EditorProps {
  initial: string;
  onUserChange: (text: string) => void;
  diagnostics: Diagnostic[];
  /** Ranges to highlight (hover from the canvas). */
  highlight: Span[];
  /** Offset under the mouse, or null. */
  onHoverOffset: (offset: number | null) => void;
  /** Syntax highlighting: TeX (tkz-euclide / TikZ) or Asymptote. */
  language?: 'tex' | 'asy';
}

const languageConf = new Compartment();
const modeOf = (l: 'tex' | 'asy' | undefined) => StreamLanguage.define(l === 'asy' ? clike : stex);

const External = Annotation.define<boolean>();
/** Marks drag edits that must be merged into the current undo event. */
const DragJoin = Annotation.define<boolean>();


// ------------------------------------------------------------ hover highlight field
const setHighlight = StateEffect.define<Span[]>();
const hotLine = Decoration.line({ class: 'hot-line' });
const hotMark = Decoration.mark({ class: 'hot-span' });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHighlight)) continue;
      const doc = tr.state.doc;
      const spans = e.value
        .filter((s) => s.from < s.to && s.to <= doc.length)
        .sort((a, b) => a.from - b.from);
      const b = new RangeSetBuilder<Decoration>();
      // line decorations must come in order and before marks starting at the same position
      const entries: { from: number; to: number; d: Decoration }[] = [];
      const seenLines = new Set<number>();
      for (const s of spans) {
        for (let l = doc.lineAt(s.from).number; l <= doc.lineAt(s.to).number; l++) {
          if (seenLines.has(l)) continue;
          seenLines.add(l);
          const line = doc.line(l);
          entries.push({ from: line.from, to: line.from, d: hotLine });
        }
        entries.push({ from: s.from, to: s.to, d: hotMark });
      }
      entries.sort((x, y) => x.from - y.from || (x.d === hotLine ? -1 : 1));
      for (const en of entries) b.add(en.from, en.to, en.d);
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '.hot-span': { backgroundColor: '#fed7aa', borderRadius: '2px' },
  '.cm-line.hot-line': { backgroundColor: '#fff4eb' },
  '.cm-gutters': { backgroundColor: '#fafbfc', borderRight: '1px solid #eceef1' },
});

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const batch = useRef<{ time: number; first: boolean } | null>(null);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.initial,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history({ joinToEvent: (tr, adjacent) => adjacent || tr.annotation(DragJoin) === true }),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          languageConf.of(modeOf(props.language)),
          syntaxHighlighting(defaultHighlightStyle),
          lintGutter(),
          highlightField,
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (u.transactions.some((t) => t.annotation(External))) return;
            cb.current.onUserChange(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            mousemove(e, ev) {
              const p = ev.posAtCoords({ x: e.clientX, y: e.clientY }, false);
              cb.current.onHoverOffset(p);
            },
            mouseleave() {
              cb.current.onHoverOffset(null);
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      setText(text, opts) {
        const v = view.current;
        if (!v) return;
        const change = minimalChange(v.state.doc.toString(), text);
        if (!change) return;
        const b = batch.current;
        if (b) {
          // every edit of a drag goes into ONE undo event
          v.dispatch({
            changes: change,
            annotations: [
              External.of(true),
              Transaction.time.of(b.time),
              ...(b.first ? [isolateHistory.of('before' as const)] : [DragJoin.of(true)]),
            ],
          });
          b.first = false;
        } else {
          v.dispatch({
            changes: change,
            annotations: [
              External.of(true),
              Transaction.addToHistory.of(opts?.history !== false),
              isolateHistory.of('full' as const),
            ],
          });
        }
      },
      beginBatch() {
        batch.current = { time: Date.now(), first: true };
      },
      endBatch() {
        if (!batch.current) return;
        batch.current = null;
        view.current?.dispatch({ annotations: isolateHistory.of('after' as const) });
      },
      reveal(from, to) {
        const v = view.current;
        if (!v) return;
        const len = v.state.doc.length;
        v.dispatch({
          selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
          scrollIntoView: true,
        });
        v.focus();
      },
      getText() {
        return view.current?.state.doc.toString() ?? '';
      },
    }),
    [],
  );

  // diagnostics → lint underline
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const len = v.state.doc.length;
    const ds: CmDiagnostic[] = props.diagnostics.map((d) => {
      const from = Math.min(d.from, len);
      return { from, to: Math.max(from, Math.min(d.to, len)), severity: d.severity, message: d.message };
    });
    v.dispatch(setDiagnostics(v.state, ds));
  }, [props.diagnostics]);

  // language
  useEffect(() => {
    view.current?.dispatch({ effects: languageConf.reconfigure(modeOf(props.language)) });
  }, [props.language]);

  // hover highlight
  useEffect(() => {
    view.current?.dispatch({ effects: setHighlight.of(props.highlight) });
  }, [props.highlight]);

  return <div ref={host} className="editor-host" />;
});
