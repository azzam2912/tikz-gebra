// AST (statements) → construction graph.
// Detects duplicate definitions, undefined references and cycles.

import { makeLineIndex } from '../parser/parser';
import type { DefStatement, Diagnostic, ParseResult, PointId, Severity } from '../parser/ast';
import { stepId, type Drawing, type Graph, type Step } from './types';

export interface BuildResult {
  /** null when there is at least one error. */
  graph: Graph | null;
  diagnostics: Diagnostic[];
}

export function buildGraph(src: string, parsed: ParseResult): BuildResult {
  const lineOf = makeLineIndex(src);
  const diags: Diagnostic[] = [...parsed.diagnostics];
  const push = (severity: Severity, message: string, from: number, to: number, code?: Diagnostic['code']) =>
    diags.push({ severity, message, from, to: Math.max(to, from + 1), line: lineOf(from), ...(code ? { code } : {}) });

  // 1. collect definitions
  const defs: DefStatement[] = [];
  const definedAt = new Map<PointId, { index: number; st: DefStatement }>();
  for (const st of parsed.statements) {
    if (st.type !== 'def') continue;
    let dup = false;
    st.c.out.forEach((name, k) => {
      const prev = definedAt.get(name);
      if (prev) {
        dup = true;
        const span = st.outSpans[k] ?? st.span;
        push('error', `Point ${name} is already defined on line ${lineOf(prev.st.span.from)}`, span.from, span.to);
      }
    });
    if (dup) continue;
    const index = defs.length;
    defs.push(st);
    for (const name of st.c.out) definedAt.set(name, { index, st });
  }

  // 2. references
  const deps: number[][] = defs.map(() => []);
  defs.forEach((st, i) => {
    st.c.args.forEach((name, k) => {
      const span = st.argSpans[k] ?? st.span;
      const def = definedAt.get(name);
      if (!def) {
        push('error', `Undefined point ${name}`, span.from, span.to);
        return;
      }
      if (def.index > i) {
        push(
          'warning',
          `${name} is used before it is defined (line ${lineOf(def.st.span.from)}); LaTeX would fail here. The regenerated code puts definitions in dependency order.`,
          span.from,
          span.to,
          'forward-ref',
        );
      }
      deps[i]!.push(def.index);
    });
  });

  // 3. topological sort (Kahn, stable by source order) + cycle detection
  const order = topoSort(deps);
  if (order.cycle) {
    const names = order.cycle.flatMap((i) => defs[i]!.c.out);
    const first = defs[order.cycle[0]!]!;
    push('error', `Circular definition: ${names.join(' → ')}`, first.span.from, first.span.to);
  }

  // 4. drawings
  const drawings: Drawing[] = [];
  for (const st of parsed.statements) {
    if (st.type !== 'draw') continue;
    st.d.groups.forEach((grp, gi) =>
      grp.forEach((name, k) => {
        if (!definedAt.has(name)) {
          const span = st.refSpans[gi]?.[k] ?? st.span;
          push('error', `Undefined point ${name}`, span.from, span.to);
        }
      }),
    );
    drawings.push({ id: '', d: st.d, span: st.span });
  }
  // canonical order (same as codegen): drawings first, then labels — stable otherwise
  const isLabel = (d: Drawing) => d.d.cmd === 'tkzLabelPoints' || d.d.cmd === 'tkzLabelPoint';
  const ordered = [...drawings.filter((d) => !isLabel(d)), ...drawings.filter(isLabel)];
  ordered.forEach((d, i) => (d.id = `d${i}`));

  diags.sort((a, b) => a.from - b.from);
  if (diags.some((d) => d.severity === 'error')) return { graph: null, diagnostics: diags };

  const steps: Step[] = order.order.map((i) => {
    const st = defs[i]!;
    return { id: stepId(st.c), c: st.c, span: st.span, ...(st.lit ? { lit: st.lit } : {}) };
  });
  const producer = new Map<PointId, string>();
  for (const s of steps) for (const name of s.c.out) producer.set(name, s.id);
  return { graph: { steps, producer, drawings: ordered, ...(parsed.colors ? { colors: parsed.colors } : {}) }, diagnostics: diags };
}

/**
 * Kahn's algorithm, always picking the smallest available index so that an
 * already-ordered input is left unchanged. On a cycle, returns one cycle.
 */
export function topoSort(deps: number[][]): { order: number[]; cycle: number[] | null } {
  const n = deps.length;
  const indeg = new Array<number>(n).fill(0);
  const users: number[][] = deps.map(() => []);
  deps.forEach((ds, i) => {
    const uniq = [...new Set(ds)];
    indeg[i] = uniq.length;
    for (const d of uniq) users[d]!.push(i);
  });
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  const order: number[] = [];
  while (ready.length) {
    ready.sort((a, b) => a - b);
    const i = ready.shift()!;
    order.push(i);
    for (const u of users[i]!) if (--indeg[u]! === 0) ready.push(u);
  }
  if (order.length === n) return { order, cycle: null };

  // find a cycle among remaining nodes by walking dependencies
  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) if (indeg[i]! > 0) remaining.add(i);
  let cur = [...remaining][0]!;
  const seen = new Map<number, number>();
  const path: number[] = [];
  while (!seen.has(cur)) {
    seen.set(cur, path.length);
    path.push(cur);
    cur = deps[cur]!.find((d) => remaining.has(d))!;
  }
  return { order, cycle: path.slice(seen.get(cur)!) };
}
