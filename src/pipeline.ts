import { parseAsymptote } from './asy/front';
import { buildGraph, type BuildResult } from './graph/build';
import { parse } from './parser/parser';

/** Input language: tkz-euclide (with plain TikZ) or Asymptote. */
export type Lang = 'tkz' | 'asy';

/** Guess the language of the editor text. */
export function detectLang(text: string): Lang {
  if (/\\begin\s*\{asy\}/.test(text)) return 'asy';
  if (/\\(tkz[A-Za-z]+|draw|fill|filldraw|coordinate|node|begin\s*\{tikzpicture\})/.test(text)) return 'tkz';
  if (/(^|[;\s])(import\s+\w+\s*;|pair\s+\w|draw\s*\(|dot\s*\(|label\s*\(\s*")/.test(text)) return 'asy';
  return 'tkz';
}

export interface CompileResult extends BuildResult {
  lang: Lang;
}

/** Source text → construction graph (null on errors) + diagnostics. */
export function compile(src: string, lang: Lang = detectLang(src)): CompileResult {
  const parsed = lang === 'asy' ? parseAsymptote(src) : parse(src);
  const r = buildGraph(src, parsed);
  if (r.graph) r.graph.lang = lang;
  return { ...r, lang };
}
