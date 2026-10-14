import type { Span } from './errors';

export type BinOp = '+' | '-' | '*' | '/' | 'MOD' | '=' | '≠' | '<' | '>' | '≤' | '≥' | 'AND' | 'OR';
export type UnOp = '-' | 'NOT';

export type Expr =
  | { kind: 'num'; value: number; span: Span }
  | { kind: 'str'; value: string; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'var'; name: string; span: Span }
  | { kind: 'list'; items: Expr[]; span: Span }
  | { kind: 'index'; list: Expr; index: Expr; span: Span }
  | { kind: 'bin'; op: BinOp; left: Expr; right: Expr; span: Span }
  | { kind: 'un'; op: UnOp; operand: Expr; span: Span }
  | { kind: 'call'; name: string; args: Expr[]; span: Span; nameSpan: Span };

/** Something that can sit on the left of ←. */
export type Target =
  | { kind: 'var'; name: string; span: Span }
  | { kind: 'index'; list: Expr; index: Expr; span: Span };

interface StmtBase {
  /** Stable id (derived from the source offset); also the block id in the blocks view. */
  id: string;
  span: Span;
}

export type Stmt = StmtBase &
  (
    | { kind: 'assign'; target: Target; value: Expr }
    | { kind: 'expr'; expr: Extract<Expr, { kind: 'call' }> }
    | { kind: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null }
    | { kind: 'repeat'; count: Expr; body: Stmt[] }
    | { kind: 'until'; cond: Expr; body: Stmt[] }
    | { kind: 'foreach'; item: string; list: Expr; body: Stmt[] }
    | { kind: 'proc'; name: string; params: string[]; body: Stmt[] }
    | { kind: 'return'; value: Expr | null }
  );

export interface Program {
  body: Stmt[];
}

/** Built-in procedures from the reference sheet: name → [min args, max args, returns a value]. */
export const BUILTINS: Record<string, [number, number, boolean]> = {
  DISPLAY: [1, 1, false],
  INPUT: [0, 0, true],
  RANDOM: [2, 2, true],
  INSERT: [3, 3, false],
  APPEND: [2, 2, false],
  REMOVE: [2, 2, false],
  LENGTH: [1, 1, true],
  MOVE_FORWARD: [0, 0, false],
  ROTATE_LEFT: [0, 0, false],
  ROTATE_RIGHT: [0, 0, false],
  CAN_MOVE: [1, 1, true],
};

export const ROBOT_DIRECTIONS = ['left', 'right', 'forward', 'backward'];

/** Visit every statement (depth-first, pre-order). */
export function walkStmts(stmts: Stmt[], fn: (s: Stmt) => void) {
  for (const s of stmts) {
    fn(s);
    if (s.kind === 'if') {
      walkStmts(s.then, fn);
      if (s.else) walkStmts(s.else, fn);
    } else if (s.kind === 'repeat' || s.kind === 'until' || s.kind === 'foreach' || s.kind === 'proc') {
      walkStmts(s.body, fn);
    }
  }
}

/** Visit every expression in an expression tree. */
export function walkExpr(e: Expr, fn: (e: Expr) => void) {
  fn(e);
  switch (e.kind) {
    case 'list': e.items.forEach((x) => walkExpr(x, fn)); break;
    case 'index': walkExpr(e.list, fn); walkExpr(e.index, fn); break;
    case 'bin': walkExpr(e.left, fn); walkExpr(e.right, fn); break;
    case 'un': walkExpr(e.operand, fn); break;
    case 'call': e.args.forEach((x) => walkExpr(x, fn)); break;
  }
}

/** Does the program use any robot command? (The IDE shows the grid when it does.) */
export function usesRobot(p: Program): boolean {
  let found = false;
  const robot = new Set(['MOVE_FORWARD', 'ROTATE_LEFT', 'ROTATE_RIGHT', 'CAN_MOVE']);
  const check = (e: Expr) => walkExpr(e, (x) => { if (x.kind === 'call' && robot.has(x.name)) found = true; });
  walkStmts(p.body, (s) => {
    switch (s.kind) {
      case 'assign': check(s.value); if (s.target.kind === 'index') { check(s.target.list); check(s.target.index); } break;
      case 'expr': check(s.expr); break;
      case 'if': case 'until': check(s.cond); break;
      case 'repeat': check(s.count); break;
      case 'foreach': check(s.list); break;
      case 'return': if (s.value) check(s.value); break;
    }
  });
  return found;
}
