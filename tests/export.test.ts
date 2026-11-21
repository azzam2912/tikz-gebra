import { describe, expect, it } from 'vitest';
import { extractBody } from '../src/codegen/export';
import { fullDocument } from '../src/codegen/codegen';

describe('export', () => {
  it('keeps a plain body (with comments) as-is', () => {
    expect(extractBody('% hi\n\\tkzDefPoint(0,0){A}\n\n')).toBe('% hi\n\\tkzDefPoint(0,0){A}\n');
  });
  it('extracts and dedents the tikzpicture content of a full document', () => {
    const doc = fullDocument('\\tkzDefPoint(0,0){A}\n% note\n\\tkzDrawPoints(A)\n');
    expect(extractBody(doc)).toBe('\\tkzDefPoint(0,0){A}\n% note\n\\tkzDrawPoints(A)\n');
  });
  it('handles tikzpicture options and ignores commented-out environments', () => {
    const src = '% \\begin{tikzpicture}\n\\begin{tikzpicture}[scale=2]\n  \\tkzDefPoint(0,0){A}\n\\end{tikzpicture}';
    expect(extractBody(src)).toBe('\\tkzDefPoint(0,0){A}\n');
  });
  it('full document round-trips through extractBody', () => {
    const body = '\\tkzDefPoint(0,0){A}\n\\tkzDefPoint(1,0){B}\n';
    expect(extractBody(fullDocument(body))).toBe(body);
  });
});
