import { CompileError, type Span } from './errors';

export type TokType = 'num' | 'str' | 'ident' | 'kw' | 'op' | 'punct' | 'eof';

export interface Token {
  type: TokType;
  /** Canonical text: keywords upper-case, operators in reference-sheet form (← ≠ ≤ ≥). */
  value: string;
  span: Span;
}

export const KEYWORDS = new Set([
  'IF', 'ELSE', 'REPEAT', 'TIMES', 'UNTIL', 'FOR', 'EACH', 'IN',
  'PROCEDURE', 'RETURN', 'NOT', 'AND', 'OR', 'MOD', 'TRUE', 'FALSE',
]);

/** ASCII (and look-alike) spellings → canonical operator. Longest first. */
const OPS: [string, string][] = [
  ['<-', '←'], ['!=', '≠'], ['<=', '≤'], ['>=', '≥'], ['==', '=='],
  ['←', '←'], ['≠', '≠'], ['≤', '≤'], ['≥', '≥'],
  ['+', '+'], ['-', '-'], ['−', '-'], ['*', '*'], ['×', '*'], ['/', '/'], ['÷', '/'],
  ['=', '='], ['<', '<'], ['>', '>'],
];
const PUNCT = new Set(['(', ')', '{', '}', '[', ']', ',']);

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const span = (from: number, to: number, l = line, ls = lineStart): Span => ({ from, to, line: l, col: from - ls + 1 });

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { i++; line++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === ' ') { i++; continue; }
    // comment (extension)
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      while (/[0-9]/.test(src[i] ?? '')) i++;
      if (src[i] === '.' && /[0-9]/.test(src[i + 1] ?? '')) {
        i++;
        while (/[0-9]/.test(src[i] ?? '')) i++;
      }
      toks.push({ type: 'num', value: src.slice(start, i), span: span(start, i) });
      continue;
    }
    // string: "…", or curly quotes pasted from the exam PDF
    if (c === '"' || c === '“' || c === '”') {
      const start = i;
      const sLine = line, sLs = lineStart;
      i++;
      let text = '';
      while (i < src.length && src[i] !== '"' && src[i] !== '”' && src[i] !== '“' && src[i] !== '\n') {
        text += src[i++];
      }
      if (i >= src.length || src[i] === '\n') {
        throw new CompileError('This text is missing its closing quote mark (").', span(start, i, sLine, sLs));
      }
      i++;
      toks.push({ type: 'str', value: text, span: span(start, i, sLine, sLs) });
      continue;
    }
    // identifier / keyword
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (/[A-Za-z0-9_]/.test(src[i] ?? '')) i++;
      const word = src.slice(start, i);
      const up = word.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') {
        toks.push({ type: 'kw', value: up, span: span(start, i) });
      } else if (KEYWORDS.has(word)) {
        toks.push({ type: 'kw', value: word, span: span(start, i) });
      } else {
        toks.push({ type: 'ident', value: word, span: span(start, i) });
      }
      continue;
    }
    if (PUNCT.has(c)) {
      toks.push({ type: 'punct', value: c, span: span(i, i + 1) });
      i++;
      continue;
    }
    const op = OPS.find(([s]) => src.startsWith(s, i));
    if (op) {
      toks.push({ type: 'op', value: op[1], span: span(i, i + op[0].length) });
      i += op[0].length;
      continue;
    }
    throw new CompileError(`I don't recognize the character "${c}".`, span(i, i + 1));
  }
  toks.push({ type: 'eof', value: '', span: span(i, i) });
  return toks;
}
