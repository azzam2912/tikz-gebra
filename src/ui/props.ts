// Object properties: read the style of a drawing (or the label of a point) and rewrite it in the
// code, in place. Pure (no DOM): every edit returns the new editor text.
//
// tkz-euclide / TikZ: the [options] of the command are edited key by key, so options the panel
// doesn't know stay as written. Asymptote: the pen argument of draw()/fill() is edited term by term.

import { drawingCode } from '../codegen/codegen';
import type { Drawing, Graph, PointId } from '../graph/types';
import type { OptSpan, Span } from '../parser/ast';
import type { Lang } from '../pipeline';
import { splitPlus, xcolor } from '../style';
import { applyEdits, type Edit } from './literal';
import { labelDirOf } from './shapes';

// ------------------------------------------------------------------ palettes

/** Colours offered by the panel (names the language knows without extra packages). */
export const TIKZ_COLORS = ['black', 'darkgray', 'gray', 'red', 'orange', 'brown', 'olive', 'green', 'teal', 'cyan', 'blue', 'violet', 'purple', 'magenta', 'pink'];
export const ASY_COLORS = ['black', 'gray', 'red', 'orange', 'olive', 'heavygreen', 'deepcyan', 'blue', 'royalblue', 'purple', 'magenta', 'pink', 'deepred', 'deepgreen', 'deepblue'];

/** Line widths: TikZ keywords (the empty one is the default) / Asymptote linewidth values. */
export const TIKZ_WIDTHS = ['ultra thin', 'very thin', 'thin', 'semithick', 'thick', 'very thick', 'ultra thick'];
export const ASY_WIDTHS = ['0.2', '0.5', '0.8', '1.2', '1.6'];

export const TIKZ_DASHES = ['solid', 'dashed', 'densely dashed', 'loosely dashed', 'dotted', 'densely dotted', 'loosely dotted', 'dash dot'];
export const ASY_DASHES = ['solid', 'dashed', 'dotted', 'longdashed', 'dashdotted'];

/** Label positions: TikZ keywords, in the order of the compass from the right counter-clockwise. */
export const POSITIONS = ['right', 'above right', 'above', 'above left', 'left', 'below left', 'below', 'below right'];
const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

// ------------------------------------------------------------------ TikZ option lists

/** Split options on top-level commas, keeping each key as written. */
export function optionKeys(options: string | null): string[] {
  if (!options) return [];
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < options.length; i++) {
    const c = options[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      out.push(options.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(options.slice(start).trim());
  return out.filter((k) => k);
}

export type TikzCategory = 'color' | 'width' | 'dash' | 'fill' | 'fillOpacity' | 'opacity' | 'arcs' | 'size' | 'mark' | 'position' | 'dist';

const keyOf = (raw: string) => {
  const eq = raw.indexOf('=');
  return { key: (eq >= 0 ? raw.slice(0, eq) : raw).trim().replace(/\s+/g, ' '), value: eq >= 0 ? raw.slice(eq + 1).trim() : null };
};

/** Which panel category an option belongs to (null: leave it alone). */
export function categoryOf(raw: string, colors: Record<string, string> = {}): TikzCategory | null {
  const { key, value } = keyOf(raw);
  if (value === null) {
    if (TIKZ_WIDTHS.includes(key)) return 'width';
    if (TIKZ_DASHES.includes(key) || /^(densely |loosely )?dash dot( dot)?$/.test(key)) return 'dash';
    if (key === 'fill') return 'fill';
    if (/^(above|below)?\s*(left|right)?$/.test(key) && key) return 'position';
    if (xcolor(key, colors)) return 'color';
    return null;
  }
  switch (key) {
    case 'color':
      return 'color';
    case 'draw':
      return value === 'none' ? null : 'color';
    case 'line width':
      return 'width';
    case 'dash pattern':
      return 'dash';
    case 'fill':
      return 'fill';
    case 'fill opacity':
      return 'fillOpacity';
    case 'opacity':
      return 'opacity';
    case 'arc':
      return 'arcs';
    case 'size':
      return 'size';
    case 'mark':
      return 'mark';
    case 'anchor':
      return 'position';
    case 'dist':
    case 'pos':
      return 'dist';
    default:
      return null;
  }
}

/** The current value of a category in an option list (as the panel shows it). */
export function tikzValue(options: string | null, cat: TikzCategory, colors: Record<string, string> = {}): string | null {
  for (const raw of optionKeys(options)) {
    if (categoryOf(raw, colors) !== cat) continue;
    const { key, value } = keyOf(raw);
    if (cat === 'position') return value === null ? key : null;
    if (value === null) return cat === 'fill' ? 'black' : key;
    return value;
  }
  return null;
}

/** Replace (or remove, with value null) the option of a category; other options stay as written. */
export function setTikzOption(options: string | null, cat: TikzCategory, value: string | null, colors: Record<string, string> = {}): string {
  const keep = optionKeys(options).filter((raw) => categoryOf(raw, colors) !== cat);
  if (value !== null && value !== '') {
    const text = {
      color: `color=${value}`,
      width: value,
      dash: value,
      fill: `fill=${value}`,
      fillOpacity: `fill opacity=${value}`,
      opacity: `opacity=${value}`,
      arcs: `arc=${value}`,
      size: `size=${value}`,
      mark: `mark=${value}`,
      position: value,
      dist: `dist=${value}`,
    }[cat];
    // positions lead (tkz-euclide reads them as the label place); the rest go at the end
    if (cat === 'position') keep.unshift(text);
    else keep.push(text);
  }
  return keep.join(', ');
}

// ------------------------------------------------------------------ Asymptote pens

export type AsyCategory = 'color' | 'width' | 'dash';

function asyCategory(term: string, colors: Record<string, string>): AsyCategory | null {
  const t = term.trim();
  if (/^linewidth\(/.test(t)) return 'width';
  if (['solid', 'dashed', 'dotted', 'longdashed', 'dashdotted', 'longdashdotted'].includes(t) || /^linetype\(/.test(t)) return 'dash';
  if (/^(rgb|gray|cmyk|RGB)\(/.test(t) || ASY_COLORS.includes(t) || colors[t] !== undefined || /^[a-z]+$/.test(t)) return 'color';
  return null;
}

export function asyValue(pen: string | null, cat: AsyCategory, colors: Record<string, string> = {}): string | null {
  if (!pen) return null;
  for (const term of splitPlus(pen)) {
    if (asyCategory(term, colors) !== cat) continue;
    const t = term.trim();
    if (cat === 'width') return /^linewidth\(\s*([\d.]+)/.exec(t)?.[1] ?? null;
    return t;
  }
  return null;
}

export function setAsyPen(pen: string | null, cat: AsyCategory, value: string | null, colors: Record<string, string> = {}): string {
  const keep = (pen ? splitPlus(pen) : []).map((t) => t.trim()).filter((t) => t && asyCategory(t, colors) !== cat);
  if (value && !(cat === 'dash' && value === 'solid')) keep.push(cat === 'width' ? `linewidth(${value})` : value);
  return keep.join('+');
}

// ------------------------------------------------------------------ writing options back

/** Edit that replaces the options at `opt` with `next` ('' removes them). */
export function optionEdit(opt: OptSpan, next: string): Edit {
  if (next === '') {
    if (opt.insert) return { span: opt.span, text: '' };
    return { span: opt.remove ?? opt.span, text: '' };
  }
  if (opt.insert === 'bracket') return { span: opt.span, text: `[${next}]` };
  if (opt.insert === 'arg') return { span: opt.span, text: `, ${next}` };
  return { span: opt.span, text: next };
}

/** What the panel can change for a drawing. */
export interface DrawingInfo {
  /** its options / pen can be rewritten in place */
  editable: boolean;
  lang: 'tikz' | 'asy';
  /** stroke (or, for fills, fill) colour as written; null = default */
  color: string | null;
  width: string | null;
  dash: string | null;
  /** closed shapes in tkz-euclide / TikZ can be filled */
  canFill: boolean;
  fill: string | null;
  fillOpacity: string | null;
  /** angle marks: number of arcs, size */
  arcs: number | null;
  size: string | null;
  /** \tkzMarkAngle: the text of its \tkzLabelAngle, if any */
  angleLabel: string | null;
  /** segments and polygon sides: the side the click was on, and its tick marks */
  side: [PointId, PointId] | null;
  ticks: number | null;
  isFill: boolean;
}

const CLOSED = ['tkzDrawPolygon', 'tkzDrawCircle', 'tkzDrawCircles', 'tkzDrawSector'];
const FILLS = ['tkzFillPolygon', 'tkzFillCircle', 'tkzFillSector'];
const SIDES = ['tkzDrawSegment', 'tkzDrawSegments', 'tkzDrawPolygon', 'tkzDrawPolySeg', 'tkzFillPolygon'];

const samePair = (g: PointId[], a: PointId, b: PointId) => (g[0] === a && g[1] === b) || (g[0] === b && g[1] === a);

function markOf(g: Graph, a: PointId, b: PointId): Drawing | null {
  return g.drawings.find((x) => (x.d.cmd === 'tkzMarkSegment' || x.d.cmd === 'tkzMarkSegments') && x.d.groups.some((grp) => samePair(grp, a, b))) ?? null;
}

function angleLabelOf(g: Graph, pts: PointId[]): Drawing | null {
  return g.drawings.find((x) => x.d.cmd === 'tkzLabelAngle' && x.d.groups[0]!.join() === pts.join()) ?? null;
}

const bars = (mark: string | null): number => {
  if (mark === null) return 1;
  if (mark.trim() === 'none') return 0;
  return (mark.match(/\|/g) ?? []).length || 1;
};

export function drawingInfo(g: Graph, d: Drawing, side: [PointId, PointId] | null): DrawingInfo {
  const colors = g.colors ?? {};
  const asy = d.d.src === 'asy';
  const o = d.d.options;
  const isFill = FILLS.includes(d.d.cmd);
  const cmd = d.d.cmd;
  let ticks: number | null = null;
  let s: [PointId, PointId] | null = null;
  if (!asy && side && SIDES.includes(cmd)) {
    s = side;
    const m = markOf(g, side[0], side[1]);
    ticks = m ? bars(tikzValue(m.d.options, 'mark', colors)) : 0;
  } else if (!asy && cmd === 'tkzMarkSegment') {
    ticks = bars(tikzValue(o, 'mark', colors));
  }
  const isAngle = cmd === 'tkzMarkAngle';
  const lbl = isAngle && !asy ? angleLabelOf(g, d.d.groups[0]!) : null;
  return {
    editable: !!d.opt,
    lang: asy ? 'asy' : 'tikz',
    color: asy ? asyValue(o, 'color', colors) : isFill ? tikzValue(o, 'color', colors) ?? tikzValue(o, 'fill', colors) : tikzValue(o, 'color', colors),
    width: asy ? asyValue(o, 'width', colors) : tikzValue(o, 'width', colors),
    dash: asy ? asyValue(o, 'dash', colors) : tikzValue(o, 'dash', colors),
    canFill: !asy && CLOSED.includes(cmd),
    fill: asy ? null : tikzValue(o, 'fill', colors),
    fillOpacity: asy ? null : tikzValue(o, isFill ? 'opacity' : 'fillOpacity', colors),
    arcs: isAngle && !asy ? (/^l{1,3}$/.test(tikzValue(o, 'arcs', colors) ?? 'l') ? (tikzValue(o, 'arcs', colors) ?? 'l').length : 1) : null,
    size: (isAngle || cmd === 'tkzMarkRightAngle') && !asy ? tikzValue(o, 'size', colors) : null,
    angleLabel: lbl ? lbl.d.text ?? '' : null,
    side: s,
    ticks,
    isFill,
  };
}

export type DrawingChange =
  | { key: 'color' | 'width' | 'dash'; value: string | null }
  | { key: 'fill'; value: string | null }
  | { key: 'fillOpacity'; value: string | null }
  | { key: 'arcs'; value: number }
  | { key: 'size'; value: string | null };

/** Rewrite the options of a drawing. Returns the new code, or null if it can't be edited. */
export function setDrawingStyle(code: string, g: Graph, d: Drawing, change: DrawingChange): string | null {
  if (!d.opt) return null;
  const colors = g.colors ?? {};
  let next: string;
  if (d.d.src === 'asy') {
    if (change.key !== 'color' && change.key !== 'width' && change.key !== 'dash') return null;
    next = setAsyPen(d.d.options, change.key, change.value, colors);
  } else {
    const isFill = FILLS.includes(d.d.cmd);
    let o = d.d.options;
    switch (change.key) {
      case 'color':
        // a fill command's colour is its fill colour
        if (isFill) o = setTikzOption(o, 'fill', null, colors);
        o = setTikzOption(o, 'color', change.value, colors);
        break;
      case 'width':
      case 'dash':
        o = setTikzOption(o, change.key, change.value === 'solid' ? null : change.value, colors);
        break;
      case 'fill':
        o = setTikzOption(o, 'fill', change.value, colors);
        // a new fill starts see-through
        if (change.value && tikzValue(o, 'fillOpacity', colors) === null) o = setTikzOption(o, 'fillOpacity', '0.3', colors);
        if (!change.value) o = setTikzOption(o, 'fillOpacity', null, colors);
        break;
      case 'fillOpacity':
        o = setTikzOption(o, isFill ? 'opacity' : 'fillOpacity', change.value, colors);
        break;
      case 'arcs':
        o = setTikzOption(o, 'arcs', change.value > 1 ? 'l'.repeat(change.value) : null, colors);
        break;
      case 'size':
        o = setTikzOption(o, 'size', change.value, colors);
        break;
    }
    next = o ?? '';
  }
  return applyEdits(code, [optionEdit(d.opt, next)]);
}

// ------------------------------------------------------------------ whole statements

/** Where new code goes: before \end{tikzpicture}, else at the end (indented like the line before). */
export function insertLines(code: string, lines: string[]): string {
  const end = code.lastIndexOf('\\end{tikzpicture}');
  const at = end < 0 ? code.length : code.lastIndexOf('\n', end - 1) + 1 || end;
  const before = code.slice(0, at);
  const prevLine = before.trimEnd().split('\n').pop() ?? '';
  const indent = /^[ \t]*/.exec(prevLine)![0];
  const lead = before.length && !before.endsWith('\n') ? '\n' : '';
  return before + lead + lines.map((l) => indent + l).join('\n') + '\n' + code.slice(at);
}

/** Edit that deletes a statement, with its line when it is alone on it. */
function deleteStatement(code: string, span: Span): Edit {
  let from = span.from;
  let to = span.to;
  const lineStart = code.lastIndexOf('\n', from - 1) + 1;
  const nl = code.indexOf('\n', to);
  const lineEnd = nl < 0 ? code.length : nl;
  if (/^[ \t]*$/.test(code.slice(lineStart, from)) && /^[ \t]*$/.test(code.slice(to, lineEnd))) {
    from = lineStart;
    to = nl < 0 ? code.length : nl + 1;
  }
  return { span: { from, to }, text: '' };
}

/** Set the tick marks (0 = none, 1–3 bars) on side AB. tkz-euclide only. */
export function setTicks(code: string, g: Graph, a: PointId, b: PointId, n: number): string | null {
  const colors = g.colors ?? {};
  const m = markOf(g, a, b);
  const mark = n > 1 ? '|'.repeat(n) : null;
  if (m && !m.span) return null;
  if (m && m.d.groups.length === 1) {
    if (n === 0) return applyEdits(code, [deleteStatement(code, m.span!)]);
    if (!m.opt) return null;
    return applyEdits(code, [optionEdit(m.opt, setTikzOption(m.d.options, 'mark', mark, colors))]);
  }
  let text = code;
  if (m) {
    // take the side out of a \tkzMarkSegments(A,B C,D …)
    const rest = { ...m.d, groups: m.d.groups.filter((grp) => !samePair(grp, a, b)) };
    text = applyEdits(text, [{ span: m.span!, text: drawingCode(rest) }]);
  }
  if (n > 0) text = insertLines(text, [`\\tkzMarkSegment${mark ? `[mark=${mark}]` : ''}(${a},${b})`]);
  return text;
}

/** Set (or remove, with '') the \tkzLabelAngle of an angle mark. */
export function setAngleLabel(code: string, g: Graph, mark: Drawing, text: string): string | null {
  if (mark.d.src === 'asy') return null;
  const pts = mark.d.groups[0]!;
  const lbl = angleLabelOf(g, pts);
  if (lbl && !lbl.span) return null;
  if (lbl) {
    if (!text.trim()) return applyEdits(code, [deleteStatement(code, lbl.span!)]);
    return applyEdits(code, [{ span: lbl.span!, text: drawingCode({ ...lbl.d, text }) }]);
  }
  if (!text.trim()) return code;
  // just outside the arc of the mark
  const size = Number(tikzValue(mark.d.options, 'size') ?? (mark.d.src === 'tikz' ? 0.5 : 1));
  const dist = Math.round(((Number.isFinite(size) ? size : 1) + 0.35) * 100) / 100;
  return insertLines(code, [`\\tkzLabelAngle[dist=${dist}](${pts.join(',')}){${text}}`]);
}

// ------------------------------------------------------------------ point labels

export interface PointLabelInfo {
  /** label drawing(s) of the point */
  label: Drawing | null;
  /** position keyword (TikZ) or compass word (Asymptote); null = default */
  position: string | null;
  /** the label can be moved / hidden from the panel */
  editable: boolean;
  canHide: boolean;
}

export function pointLabelInfo(g: Graph, name: PointId): PointLabelInfo {
  const lbl =
    g.drawings.find((d) => d.d.cmd === 'tkzLabelPoint' && d.d.groups[0]![0] === name) ??
    g.drawings.find((d) => d.d.cmd === 'tkzLabelPoints' && d.d.groups[0]!.includes(name)) ??
    null;
  if (!lbl) return { label: null, position: null, editable: g.lang !== 'asy', canHide: false };
  if (lbl.d.src === 'asy') {
    const dir = lbl.d.dir;
    const pos = dir && 'angle' in dir ? COMPASS[((Math.round(dir.angle / 45) % 8) + 8) % 8]! : null;
    return { label: lbl, position: pos, editable: !!lbl.opt, canHide: false };
  }
  const dir = labelDirOf(lbl.d.options, null);
  const pos = dir ? POSITIONS[((Math.round(dir.angle / 45) % 8) + 8) % 8]! : null;
  return { label: lbl, position: pos, editable: lbl.d.src !== 'tikz' && !!lbl.span, canHide: lbl.d.src !== 'tikz' };
}

/**
 * Move the label of a point (position keyword; for Asymptote a compass word), or hide it
 * (position 'hide'). A point labelled in a \tkzLabelPoints list gets its own \tkzLabelPoint.
 */
export function setPointLabel(code: string, g: Graph, name: PointId, position: string, lang: Lang): string | null {
  const info = pointLabelInfo(g, name);
  const lbl = info.label;
  const colors = g.colors ?? {};
  if (lang === 'asy' || lbl?.d.src === 'asy') {
    if (!lbl?.opt || position === 'hide') return null;
    const k = POSITIONS.indexOf(position);
    const word = k >= 0 ? COMPASS[k]! : position;
    return applyEdits(code, [optionEdit(lbl.opt, word)]);
  }
  if (lbl && !info.editable) return null;
  const single = (pos: string) => `\\tkzLabelPoint${pos ? `[${pos}]` : ''}(${name}){$${name}$}`;
  if (!lbl) return position === 'hide' ? code : insertLines(code, [single(position)]);
  if (lbl.d.cmd === 'tkzLabelPoint' || lbl.d.groups[0]!.length === 1) {
    if (position === 'hide') return applyEdits(code, [deleteStatement(code, lbl.span!)]);
    if (!lbl.opt) return null;
    return applyEdits(code, [optionEdit(lbl.opt, setTikzOption(lbl.d.options, 'position', position, colors))]);
  }
  // one point of a \tkzLabelPoints list: take it out, give it its own label
  const rest = { ...lbl.d, groups: [lbl.d.groups[0]!.filter((n) => n !== name)] };
  const text = applyEdits(code, [{ span: lbl.span!, text: drawingCode(rest) }]);
  return position === 'hide' ? text : insertLines(text, [single(position)]);
}
