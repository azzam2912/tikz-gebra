// Properties of the selected object: colour, line, fill, tick marks, angle marks, label position.
// Every change rewrites the code in place (see props.ts); the panel itself holds no state.

import { useEffect, useState } from 'react';
import type { Graph, PointId } from '../graph/types';
import type { Lang } from '../pipeline';
import { asyStyle, xcolor } from '../style';
import {
  ASY_COLORS,
  ASY_DASHES,
  ASY_WIDTHS,
  drawingInfo,
  pointLabelInfo,
  setAngleLabel,
  setDrawingStyle,
  setPointLabel,
  setTicks,
  TIKZ_COLORS,
  TIKZ_DASHES,
  TIKZ_WIDTHS,
  type DrawingChange,
} from './props';

export type Selection = { kind: 'point'; name: PointId } | { kind: 'drawing'; id: string; side: [PointId, PointId] | null } | null;

export const PROPS_TEXT = {
  close: 'Close',
  point: 'Point',
  color: 'Colour',
  fillColor: 'Fill colour',
  default: 'default',
  width: 'Line width',
  dash: 'Line style',
  fill: 'Fill',
  noFill: 'none',
  opacity: 'Opacity',
  ticks: 'Equal marks on',
  arcs: 'Arcs',
  size: 'Size',
  angleLabel: 'Angle label (LaTeX)',
  angleLabelHint: 'e.g. $\\alpha$ or $40^\\circ$; empty removes it',
  labelPos: 'Label position',
  hide: 'hide',
  wholeCommand: 'Applies to the whole command ({n} objects).',
  notEditable: 'The style of this object is not written in a form the panel can edit.',
  asyNoFill: 'Fills, marks and labels of angles are edited in the code for Asymptote.',
  kinds: {
    tkzDrawSegment: 'Segment',
    tkzDrawSegments: 'Segments',
    tkzDrawLine: 'Line',
    tkzDrawLines: 'Lines',
    tkzDrawPolygon: 'Polygon',
    tkzDrawPolySeg: 'Polyline',
    tkzDrawCircle: 'Circle',
    tkzDrawCircles: 'Circles',
    tkzDrawArc: 'Arc',
    tkzDrawSemiCircle: 'Semicircle',
    tkzDrawSector: 'Sector',
    tkzFillPolygon: 'Filled polygon',
    tkzFillCircle: 'Filled circle',
    tkzFillSector: 'Filled sector',
    tkzMarkAngle: 'Angle mark',
    tkzMarkRightAngle: 'Right-angle mark',
    tkzMarkSegment: 'Segment mark',
    tkzMarkSegments: 'Segment marks',
    tkzLabelAngle: 'Angle label',
    other: 'Object',
  } as Record<string, string>,
  positions: {
    right: 'right',
    'above right': 'above right',
    above: 'above',
    'above left': 'above left',
    left: 'left',
    'below left': 'below left',
    below: 'below',
    'below right': 'below right',
  } as Record<string, string>,
};

export type PropsText = typeof PROPS_TEXT;

interface Props {
  graph: Graph;
  selection: Selection;
  lang: Lang;
  /** the current editor text (edits are computed on it) */
  code: string;
  onEdit: (text: string) => void;
  onClose: () => void;
  text?: PropsText;
}

/** Arrows for the 8 label positions, laid out as a compass. */
const ARROW: Record<string, string> = {
  right: '→', 'above right': '↗', above: '↑', 'above left': '↖', left: '←', 'below left': '↙', below: '↓', 'below right': '↘',
};
const GRID = ['above left', 'above', 'above right', 'left', null, 'right', 'below left', 'below', 'below right'];

export function PropsPanel({ graph, selection, lang, code, onEdit, onClose, text = PROPS_TEXT }: Props) {
  if (!selection) return null;
  const apply = (next: string | null) => {
    if (next !== null && next !== code) onEdit(next);
  };
  if (selection.kind === 'point') {
    const info = pointLabelInfo(graph, selection.name);
    return (
      <div className="props" role="dialog" aria-label={`${text.point} ${selection.name}`}>
        <Head title={`${text.point} ${selection.name}`} onClose={onClose} text={text} />
        <div className="props-row">
          <span className="props-label">{text.labelPos}</span>
          {info.editable ? (
            <div className="props-compass">
              {GRID.map((p, i) =>
                p ? (
                  <button
                    key={p}
                    className={info.position === p || (lang === 'asy' && info.position === ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'][i]) ? 'on' : ''}
                    title={text.positions[p]}
                    aria-label={text.positions[p]}
                    onClick={() => apply(setPointLabel(code, graph, selection.name, p, lang))}
                  >
                    {ARROW[p]}
                  </button>
                ) : info.canHide ? (
                  <button key="hide" className="hide" title={text.hide} onClick={() => apply(setPointLabel(code, graph, selection.name, 'hide', lang))}>
                    ×
                  </button>
                ) : (
                  <span key="mid" />
                ),
              )}
            </div>
          ) : (
            <span className="props-note">{text.notEditable}</span>
          )}
        </div>
      </div>
    );
  }
  const d = graph.drawings.find((x) => x.id === selection.id);
  if (!d) return null;
  const info = drawingInfo(graph, d, selection.side);
  const asy = info.lang === 'asy';
  const set = (change: DrawingChange) => apply(setDrawingStyle(code, graph, d, change));
  const colors = asy ? ASY_COLORS : TIKZ_COLORS;
  const css = (c: string) => (asy ? asyStyle(c, graph.colors).color : xcolor(c, graph.colors)) ?? 'transparent';
  const kind = text.kinds[d.d.cmd] ?? text.kinds.other!;
  const names = d.d.groups.length === 1 ? ` ${d.d.groups[0]!.filter((n) => !n.startsWith('~')).join('')}` : '';
  const isMark = d.d.cmd === 'tkzMarkAngle' || d.d.cmd === 'tkzMarkRightAngle' || d.d.cmd === 'tkzMarkSegment';
  return (
    <div className="props" role="dialog" aria-label={kind}>
      <Head title={`${kind}${names.length < 12 ? names : ''}`} onClose={onClose} text={text} />
      {!info.editable && <div className="props-note">{text.notEditable}</div>}
      {info.editable && (
        <>
          <div className="props-row">
            <span className="props-label">{info.isFill ? text.fillColor : text.color}</span>
            <Swatches colors={colors} css={css} value={info.color} onPick={(c) => set({ key: 'color', value: c })} text={text} />
          </div>
          {!info.isFill && !isMark && (
            <div className="props-row two">
              <label>
                <span className="props-label">{text.width}</span>
                <select value={info.width ?? ''} onChange={(e) => set({ key: 'width', value: e.target.value || null })}>
                  <option value="">{text.default}</option>
                  {(asy ? ASY_WIDTHS : TIKZ_WIDTHS).map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="props-label">{text.dash}</span>
                <select value={info.dash ?? 'solid'} onChange={(e) => set({ key: 'dash', value: e.target.value })}>
                  {(asy ? ASY_DASHES : TIKZ_DASHES).map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {info.canFill && (
            <div className="props-row">
              <span className="props-label">{text.fill}</span>
              <Swatches colors={colors} css={css} value={info.fill} onPick={(c) => set({ key: 'fill', value: c })} text={text} none={text.noFill} />
            </div>
          )}
          {(info.isFill || (info.canFill && info.fill)) && (
            <div className="props-row">
              <span className="props-label">{text.opacity}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={Number(info.fillOpacity ?? 1)}
                onChange={(e) => set({ key: 'fillOpacity', value: e.target.value === '1' ? null : e.target.value })}
                aria-label={text.opacity}
              />
              <span className="props-value">{Math.round(Number(info.fillOpacity ?? 1) * 100)}%</span>
            </div>
          )}
          {info.arcs !== null && (
            <div className="props-row">
              <span className="props-label">{text.arcs}</span>
              <Choice values={[1, 2, 3]} value={info.arcs} onPick={(n) => set({ key: 'arcs', value: n })} />
            </div>
          )}
          {(d.d.cmd === 'tkzMarkAngle' || d.d.cmd === 'tkzMarkRightAngle') && !asy && (
            <div className="props-row">
              <span className="props-label">{text.size}</span>
              <NumberField value={info.size} placeholder={d.d.cmd === 'tkzMarkAngle' ? '1' : '0.25'} onCommit={(v) => set({ key: 'size', value: v })} />
            </div>
          )}
          {d.d.cmd === 'tkzMarkAngle' && !asy && (
            <div className="props-row">
              <span className="props-label">{text.angleLabel}</span>
              <TextField value={info.angleLabel ?? ''} placeholder={text.angleLabelHint} onCommit={(v) => apply(setAngleLabel(code, graph, d, v))} />
            </div>
          )}
          {d.d.groups.length > 1 && <div className="props-note">{text.wholeCommand.replace('{n}', String(d.d.groups.length))}</div>}
        </>
      )}
      {info.ticks !== null && (info.side || d.d.cmd === 'tkzMarkSegment') && (
        <div className="props-row">
          <span className="props-label">
            {text.ticks} {(info.side ?? d.d.groups[0]!).join('')}
          </span>
          <Choice
            values={[0, 1, 2, 3]}
            labels={['—', '|', '||', '|||']}
            value={info.ticks}
            onPick={(n) => {
              const [a, b] = info.side ?? (d.d.groups[0] as [PointId, PointId]);
              apply(setTicks(code, graph, a, b, n));
            }}
          />
        </div>
      )}
      {asy && <div className="props-note">{text.asyNoFill}</div>}
    </div>
  );
}

function Head({ title, onClose, text }: { title: string; onClose: () => void; text: PropsText }) {
  return (
    <div className="props-head">
      <b>{title}</b>
      <button className="props-close" onClick={onClose} aria-label={text.close} title={text.close}>
        ×
      </button>
    </div>
  );
}

function Swatches({ colors, css, value, onPick, text, none }: { colors: string[]; css: (c: string) => string; value: string | null; onPick: (c: string | null) => void; text: PropsText; none?: string }) {
  return (
    <div className="props-swatches">
      <button className={`swatch default${value === null ? ' on' : ''}`} onClick={() => onPick(null)} title={none ?? text.default} aria-label={none ?? text.default}>
        {none ? '∅' : ''}
      </button>
      {colors.map((c) => (
        <button key={c} className={`swatch${value === c ? ' on' : ''}`} style={{ background: css(c) }} onClick={() => onPick(c)} title={c} aria-label={c} />
      ))}
      {value !== null && !colors.includes(value) && <span className="props-value">{value}</span>}
    </div>
  );
}

function Choice({ values, labels, value, onPick }: { values: number[]; labels?: string[]; value: number; onPick: (n: number) => void }) {
  return (
    <div className="props-choice">
      {values.map((v, i) => (
        <button key={v} className={v === value ? 'on' : ''} onClick={() => onPick(v)}>
          {labels?.[i] ?? v}
        </button>
      ))}
    </div>
  );
}

/** A text box that applies on Enter or when it loses focus. */
function TextField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type="text"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === 'Enter' && v !== value && onCommit(v)}
    />
  );
}

function NumberField({ value, placeholder, onCommit }: { value: string | null; placeholder: string; onCommit: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => {
    const t = v.trim();
    if (t === (value ?? '')) return;
    if (t === '' || Number.isFinite(Number(t))) onCommit(t || null);
  };
  return <input type="text" inputMode="decimal" className="num" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
