// Syntax tree for the Asymptote subset (olympiad / geometry figures).

import type { Span } from '../parser/ast';

export type Expr =
  | { k: 'num'; v: number; span: Span }
  | { k: 'str'; v: string; span: Span }
  | { k: 'id'; name: string; span: Span }
  /** a point of the construction graph (only inside `expr` steps, after substitution) */
  | { k: 'pt'; name: string; span: Span }
  | { k: 'pair'; x: Expr; y: Expr; span: Span }
  | { k: 'call'; fn: string; args: Expr[]; span: Span; fnSpan: Span }
  | { k: 'index'; obj: Expr; index: Expr; span: Span }
  | { k: 'member'; obj: Expr; name: string; span: Span }
  | { k: 'cast'; type: string; e: Expr; span: Span }
  | { k: 'unary'; op: '-' | '+' | '!'; e: Expr; span: Span }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^' | '--' | '^^' | '..' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||'; a: Expr; b: Expr; span: Span }
  /** "cycle" at the end of a path */
  | { k: 'cycle'; span: Span };

export interface Declarator {
  name: string;
  nameSpan: Span;
  array: boolean;
  init: Expr | null;
}

export type Stmt =
  | { k: 'import'; span: Span }
  | { k: 'decl'; type: string; decls: Declarator[]; span: Span }
  | { k: 'assign'; target: Expr; value: Expr; span: Span }
  | { k: 'expr'; e: Expr; span: Span }
  | { k: 'unsupported'; what: string; span: Span };

/** Types that may start a declaration. */
export const TYPES = new Set([
  'pair', 'point', 'real', 'int', 'path', 'guide', 'line', 'segment', 'circle', 'triangle', 'pen', 'string',
  'bool', 'transform', 'Label', 'picture', 'vector', 'void', 'side', 'arc', 'conic', 'ellipse', 'parabola', 'hyperbola',
]);
