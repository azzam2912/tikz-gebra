// Hand-written tokenizer for the tkz-euclide subset.
//
// Comments (% to end of line) are blanked out with spaces *before* tokenizing so
// that every character offset in the cleaned text equals the offset in the source.

export type Bracket = '(' | ')' | '[' | ']' | '{' | '}';

export type Token =
  | { t: 'cmd'; name: string; from: number; to: number }
  | { t: 'open'; ch: '(' | '[' | '{'; from: number; to: number }
  | { t: 'close'; ch: ')' | ']' | '}'; from: number; to: number }
  | { t: 'text'; value: string; from: number; to: number }
  | { t: 'ws'; from: number; to: number; blankLine: boolean };

/** Replace `% ...` comments by spaces (newlines kept). `\%` is not a comment. */
export function blankComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\' && i + 1 < src.length) {
      out += ch + src[i + 1]!;
      i += 2;
      continue;
    }
    if (ch === '%') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const isLetter = (c: string) => /[A-Za-z@]/.test(c);
const isWs = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Tokenize text that has already been passed through blankComments(). */
export function tokenize(text: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    const start = i;
    if (isWs(ch)) {
      let newlines = 0;
      while (i < n && isWs(text[i]!)) {
        if (text[i] === '\n') newlines++;
        i++;
      }
      toks.push({ t: 'ws', from: start, to: i, blankLine: newlines >= 2 });
    } else if (ch === '\\') {
      i++;
      if (i < n && isLetter(text[i]!)) {
        while (i < n && isLetter(text[i]!)) i++;
      } else if (i < n) {
        i++; // control symbol such as \\ or \,
      }
      toks.push({ t: 'cmd', name: text.slice(start + 1, i), from: start, to: i });
    } else if (OPEN.has(ch)) {
      i++;
      toks.push({ t: 'open', ch: ch as '(' | '[' | '{', from: start, to: i });
    } else if (CLOSE.has(ch)) {
      i++;
      toks.push({ t: 'close', ch: ch as ')' | ']' | '}', from: start, to: i });
    } else {
      while (i < n) {
        const c = text[i]!;
        if (isWs(c) || c === '\\' || OPEN.has(c) || CLOSE.has(c)) break;
        i++;
      }
      toks.push({ t: 'text', value: text.slice(start, i), from: start, to: i });
    }
  }
  return toks;
}
