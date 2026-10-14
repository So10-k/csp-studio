export interface Span {
  from: number; // offset of first char
  to: number; // offset after last char
  line: number; // 1-based
  col: number; // 1-based
}

export const NO_SPAN: Span = { from: 0, to: 0, line: 0, col: 0 };

export function joinSpans(a: Span, b: Span): Span {
  return { from: a.from, to: b.to, line: a.line, col: a.col };
}

/** A mistake found before the program runs. */
export class CompileError extends Error {
  constructor(message: string, public span: Span) {
    super(message);
  }
}

/** A mistake found while the program runs; the program terminates. */
export class RuntimeError extends Error {
  constructor(message: string, public span: Span = NO_SPAN) {
    super(message);
  }
}
