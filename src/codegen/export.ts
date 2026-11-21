import { blankComments } from '../parser/tokenizer';

/**
 * The tkz-euclide body of the editor text: if the text contains a tikzpicture
 * environment, only its content (dedented); otherwise the whole text. Comments are kept.
 */
export function extractBody(text: string): string {
  const clean = blankComments(text);
  const begin = /\\begin\s*\{tikzpicture\}(\s*\[[^\]]*\])?/.exec(clean);
  let body = text;
  if (begin) {
    const start = begin.index + begin[0].length;
    const endIdx = clean.indexOf('\\end{tikzpicture}', start);
    body = text.slice(start, endIdx === -1 ? undefined : endIdx);
  }
  const lines = body.replace(/^\s*\n/, '').trimEnd().split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join('\n') + '\n';
}
