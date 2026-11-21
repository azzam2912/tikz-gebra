// Drawing styles: TikZ/tkz-euclide options and Asymptote pens → one neutral Style,
// used by the renderer and by the converters (codegen).

export interface Style {
  /** CSS colour of the stroke; undefined = default (black). */
  color?: string;
  /** SVG stroke-dasharray in pt, or undefined for a solid line. */
  dash?: number[];
  /** Line width in pt (TikZ default 0.4pt; tkz-euclide draws with "thin"). */
  width?: number;
  /** CSS colour of the fill. */
  fill?: string;
  fillOpacity?: number;
  /** Nothing is stroked (Asymptote "invisible", TikZ "draw=none"). */
  noStroke?: boolean;
}

/** Colours known to xcolor (base names) / Asymptote, as [r,g,b] in 0..1. */
const TIKZ_COLORS: Record<string, [number, number, number]> = {
  red: [1, 0, 0], green: [0, 1, 0], blue: [0, 0, 1], cyan: [0, 1, 1], magenta: [1, 0, 1], yellow: [1, 1, 0],
  black: [0, 0, 0], gray: [0.5, 0.5, 0.5], grey: [0.5, 0.5, 0.5], white: [1, 1, 1], darkgray: [0.25, 0.25, 0.25],
  lightgray: [0.75, 0.75, 0.75], brown: [0.75, 0.5, 0.25], lime: [0.75, 1, 0], olive: [0.5, 0.5, 0], orange: [1, 0.5, 0],
  pink: [1, 0.75, 0.75], purple: [0.75, 0, 0.25], teal: [0, 0.5, 0.5], violet: [0.5, 0, 0.5],
};

/** Asymptote's named pens, exactly as in plain_pens.asy (Asymptote 2.87). */
const ASY_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [1, 1, 1],
  gray: [0.5, 0.5, 0.5],
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
  yellow: [1, 1, 0],
  palered: [1, 0.75, 0.75],
  palegreen: [0.75, 1, 0.75],
  paleblue: [0.75, 0.75, 1],
  palecyan: [0.75, 1, 1],
  palemagenta: [1, 0.75, 1],
  paleyellow: [1, 1, 0.75],
  palegray: [0.95, 0.95, 0.95],
  lightred: [1, 0.5, 0.5],
  lightgreen: [0.5, 1, 0.5],
  lightblue: [0.5, 0.5, 1],
  lightcyan: [0.5, 1, 1],
  lightmagenta: [1, 0.5, 1],
  lightyellow: [1, 1, 0.5],
  lightgray: [0.9, 0.9, 0.9],
  mediumred: [1, 0.25, 0.25],
  mediumgreen: [0.25, 1, 0.25],
  mediumblue: [0.25, 0.25, 1],
  mediumcyan: [0.25, 1, 1],
  mediummagenta: [1, 0.25, 1],
  mediumyellow: [1, 1, 0.25],
  mediumgray: [0.75, 0.75, 0.75],
  heavyred: [0.75, 0, 0],
  heavygreen: [0, 0.75, 0],
  heavyblue: [0, 0, 0.75],
  heavycyan: [0, 0.75, 0.75],
  heavymagenta: [0.75, 0, 0.75],
  lightolive: [0.75, 0.75, 0],
  heavygray: [0.25, 0.25, 0.25],
  deepred: [0.5, 0, 0],
  deepgreen: [0, 0.5, 0],
  deepblue: [0, 0, 0.5],
  deepcyan: [0, 0.5, 0.5],
  deepmagenta: [0.5, 0, 0.5],
  deepyellow: [0.5, 0.5, 0],
  deepgray: [0.1, 0.1, 0.1],
  darkred: [0.25, 0, 0],
  darkgreen: [0, 0.25, 0],
  darkblue: [0, 0, 0.25],
  darkcyan: [0, 0.25, 0.25],
  darkmagenta: [0.25, 0, 0.25],
  darkolive: [0.25, 0.25, 0],
  darkgray: [0.05, 0.05, 0.05],
  orange: [1, 0.5, 0],
  fuchsia: [1, 0, 0.5],
  chartreuse: [0.5, 1, 0],
  springgreen: [0, 1, 0.5],
  purple: [0.5, 0, 1],
  royalblue: [0, 0.5, 1],
  salmon: [1, 0.5, 0.5],
  brown: [0.5, 0, 0],
  olive: [0.5, 0.5, 0],
  darkbrown: [0.25, 0, 0],
  pink: [1, 0.75, 1],
  palegrey: [0.95, 0.95, 0.95],
  lightgrey: [0.9, 0.9, 0.9],
  mediumgrey: [0.75, 0.75, 0.75],
  grey: [0.5, 0.5, 0.5],
  heavygrey: [0.25, 0.25, 0.25],
  deepgrey: [0.1, 0.1, 0.1],
  darkgrey: [0.05, 0.05, 0.05],
};

/** Words that make an Asymptote argument a pen. */
export const ASY_PEN_WORDS = new Set([
  ...Object.keys(ASY_COLORS), 'invisible', 'dashed', 'dotted', 'longdashed', 'dashdotted', 'longdashdotted', 'solid',
  'currentpen', 'defaultpen', 'squarecap', 'roundcap', 'extendcap', 'miterjoin', 'roundjoin', 'beveljoin', 'zerowinding',
  'evenodd', 'nobasealign', 'basealign', 'Helvetica', 'TimesRoman',
]);
export const ASY_PEN_FUNCTIONS = new Set(['rgb', 'rgba', 'cmyk', 'gray', 'linewidth', 'linetype', 'fontsize', 'opacity', 'RGB', 'Pen', 'font', 'fontcommand', 'pattern', 'makepen', 'linecap', 'linejoin']);

const css = ([r, g, b]: [number, number, number]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

function parseCss(c: string): [number, number, number] | null {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(c);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (h) return [parseInt(h[1]!, 16) / 255, parseInt(h[2]!, 16) / 255, parseInt(h[3]!, 16) / 255];
  return null;
}

/** xcolor expression such as "red", "blue!20", "green!60!black", or a \definecolor name. */
export function xcolor(expr: string, defined: Record<string, string> = {}): string | null {
  const parts = expr.trim().split('!').map((p) => p.trim());
  const base = (name: string): [number, number, number] | null => {
    if (defined[name]) return parseCss(defined[name]!);
    return TIKZ_COLORS[name] ?? null;
  };
  let cur = base(parts[0]!);
  if (!cur) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const pct = Number(parts[i]);
    if (!Number.isFinite(pct)) return null;
    const other = parts[i + 1] !== undefined ? base(parts[i + 1]!) : [1, 1, 1] as [number, number, number];
    if (!other) return null;
    const t = pct / 100;
    cur = [cur[0] * t + other[0] * (1 - t), cur[1] * t + other[1] * (1 - t), cur[2] * t + other[2] * (1 - t)];
  }
  return css(cur);
}

const TIKZ_WIDTHS: Record<string, number> = {
  'ultra thin': 0.1, 'very thin': 0.2, thin: 0.4, semithick: 0.6, thick: 0.8, 'very thick': 1.2, 'ultra thick': 1.6,
};

function dimPt(v: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(pt|cm|mm|bp)?$/.exec(v.trim());
  if (!m) return null;
  const k = { pt: 1, cm: 28.45, mm: 2.845, bp: 1.004 }[m[2] ?? 'pt']!;
  return Number(m[1]) * k;
}

/** Split TikZ options on top-level commas. */
function keys(options: string): string[] {
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

/** TikZ / tkz-euclide options → Style. Unknown keys are ignored. */
export function tikzStyle(options: string | null, defined: Record<string, string> = {}): Style {
  const s: Style = {};
  if (!options) return s;
  for (const raw of keys(options)) {
    const eq = raw.indexOf('=');
    const key = (eq >= 0 ? raw.slice(0, eq) : raw).trim().replace(/\s+/g, ' ');
    const val = eq >= 0 ? raw.slice(eq + 1).trim().replace(/^\{|\}$/g, '') : '';
    if (eq < 0) {
      if (key in TIKZ_WIDTHS) s.width = TIKZ_WIDTHS[key];
      else if (key === 'dashed') s.dash = [3, 3];
      else if (key === 'densely dashed') s.dash = [3, 2];
      else if (key === 'loosely dashed') s.dash = [3, 6];
      else if (key === 'dotted' || key === 'densely dotted') s.dash = [0.4, 2];
      else if (key === 'loosely dotted') s.dash = [0.4, 4];
      else if (key === 'dash dot') s.dash = [3, 2, 0.4, 2];
      else if (key === 'fill') s.fill = s.fill ?? s.color ?? 'rgb(0,0,0)';
      else {
        const c = xcolor(key, defined);
        if (c) s.color = c;
      }
      continue;
    }
    switch (key) {
      case 'color':
      case 'draw': {
        if (val === 'none') s.noStroke = true;
        else {
          const c = xcolor(val, defined);
          if (c) s.color = c;
        }
        break;
      }
      case 'fill': {
        const c = val === 'none' ? null : xcolor(val, defined);
        if (c) s.fill = c;
        break;
      }
      case 'fill opacity':
      case 'opacity':
        if (Number.isFinite(Number(val))) s.fillOpacity = Number(val);
        break;
      case 'line width': {
        const w = dimPt(val);
        if (w !== null) s.width = w;
        break;
      }
      case 'dash pattern': {
        const nums = [...val.matchAll(/(on|off)\s*([\d.]+)\s*(pt)?/g)].map((m) => Number(m[2]));
        if (nums.length) s.dash = nums;
        break;
      }
      default:
        break;
    }
  }
  return s;
}

/** Asymptote pen expression ("red+dashed", "linewidth(1)+rgb(0,0.4,0)", a pen variable …) → Style. */
export function asyStyle(pen: string | null, defined: Record<string, string> = {}): Style {
  const s: Style = {};
  if (!pen) return s;
  for (const raw of splitPlus(pen)) {
    const term = raw.trim();
    if (!term) continue;
    let m: RegExpExecArray | null;
    if (defined[term]) {
      const c = defined[term]!;
      if (c === 'invisible') s.noStroke = true;
      else if (c.startsWith('pen:')) Object.assign(s, asyStyle(c.slice(4), defined));
      else s.color = c;
    } else if (ASY_COLORS[term]) s.color = css(ASY_COLORS[term]!);
    else if (term === 'invisible') s.noStroke = true;
    else if (term === 'dashed') s.dash = [4, 4];
    else if (term === 'dotted') s.dash = [0.4, 3];
    else if (term === 'longdashed') s.dash = [12, 4];
    else if (term === 'dashdotted') s.dash = [8, 4, 0.4, 4];
    else if ((m = /^linewidth\(\s*([\d.]+)\s*(pt)?\s*\)$/.exec(term))) s.width = Number(m[1]);
    else if ((m = /^linetype\(\s*"([^"]*)"/.exec(term))) {
      const nums = m[1]!.trim().split(/\s+/).map(Number).filter(Number.isFinite);
      s.dash = nums.length >= 2 ? nums.map((n) => Math.max(n, 0.4)) : undefined;
    } else if ((m = /^rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(term))) {
      s.color = css([Number(m[1]), Number(m[2]), Number(m[3])]);
    } else if ((m = /^gray\(\s*([\d.]+)\s*\)$/.exec(term))) {
      const g = Number(m[1]);
      s.color = css([g, g, g]);
    } else if ((m = /^opacity\(\s*([\d.]+)\s*\)$/.exec(term))) s.fillOpacity = Number(m[1]);
  }
  return s;
}

/** Split on top-level "+" (not inside parentheses or strings). */
export function splitPlus(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inStr = !inStr;
    if (inStr) continue;
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '+' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

// ------------------------------------------------------------------ back to source text

const nameOf = (c: string, table: Record<string, [number, number, number]>): string | null => {
  const rgb = parseCss(c);
  if (!rgb) return null;
  for (const [n, v] of Object.entries(table)) {
    if (Math.abs(v[0] - rgb[0]) < 0.003 && Math.abs(v[1] - rgb[1]) < 0.003 && Math.abs(v[2] - rgb[2]) < 0.003) return n;
  }
  return null;
};

const r3 = (x: number) => String(Math.round(x * 1000) / 1000);

/** Style → TikZ options. Colours that have no xcolor name are registered in `defs` (\definecolor). */
export function styleToTikz(s: Style, defs: Map<string, string>): string | null {
  const out: string[] = [];
  const colorName = (c: string) => {
    const n = nameOf(c, TIKZ_COLORS);
    if (n) return n;
    for (const [k, v] of defs) if (v === c) return k;
    const k = `c${defs.size + 1}`;
    defs.set(k, c);
    return k;
  };
  if (s.noStroke) out.push('draw=none');
  else if (s.color) out.push(`color=${colorName(s.color)}`);
  if (s.dash) out.push(s.dash[0]! < 1 ? 'dotted' : 'dashed');
  if (s.width !== undefined && Math.abs(s.width - 0.4) > 0.01) out.push(`line width=${r3(s.width)}pt`);
  if (s.fill) out.push(`fill=${colorName(s.fill)}`);
  if (s.fillOpacity !== undefined) out.push(`fill opacity=${r3(s.fillOpacity)}`);
  return out.length ? out.join(', ') : null;
}

/** \definecolor lines for the colours registered by styleToTikz. */
export function tikzColorDefs(defs: Map<string, string>): string[] {
  return [...defs].map(([k, c]) => {
    const [r, g, b] = parseCss(c) ?? [0, 0, 0];
    return `\\definecolor{${k}}{rgb}{${r3(r)},${r3(g)},${r3(b)}}`;
  });
}

/** Style → Asymptote pen expression (stroke part). */
export function styleToAsyPen(s: Style): string | null {
  const out: string[] = [];
  if (s.noStroke) return 'invisible';
  if (s.color) {
    const n = nameOf(s.color, ASY_COLORS);
    const rgb = parseCss(s.color);
    out.push(n ?? (rgb ? `rgb(${rgb.map(r3).join(',')})` : 'black'));
  }
  if (s.dash) out.push(s.dash[0]! < 1 ? 'dotted' : 'dashed');
  if (s.width !== undefined && Math.abs(s.width - 0.5) > 0.01) out.push(`linewidth(${r3(s.width)})`);
  return out.length ? out.join('+') : null;
}

/** Style → Asymptote fill pen, or null. */
export function styleToAsyFill(s: Style): string | null {
  if (!s.fill) return null;
  const n = nameOf(s.fill, ASY_COLORS);
  const rgb = parseCss(s.fill);
  const pen = n ?? (rgb ? `rgb(${rgb.map(r3).join(',')})` : 'black');
  return s.fillOpacity !== undefined ? `${pen}+opacity(${r3(s.fillOpacity)})` : pen;
}
