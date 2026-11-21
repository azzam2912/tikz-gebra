import { buildGraph, type BuildResult } from './graph/build';
import { parse } from './parser/parser';

/** Source text → construction graph (null on errors) + diagnostics. */
export function compile(src: string): BuildResult {
  return buildGraph(src, parse(src));
}
