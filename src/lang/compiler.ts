import { BUILTINS, ROBOT_DIRECTIONS, type Expr, type Program, type Stmt } from './ast';
import { CompileError, type Span } from './errors';
import { parse } from './parser';
import type { Value } from './values';

export type Instr =
  | { op: 'CONST'; v: Value; span: Span }
  | { op: 'LOAD'; name: string; span: Span }
  | { op: 'STORE'; name: string; span: Span } // pops a value; lists are copied
  | { op: 'STORE_REF'; name: string; span: Span } // pops a value without copying (hidden loop vars)
  | { op: 'LIST'; n: number; span: Span }
  | { op: 'INDEX'; span: Span }
  | { op: 'STORE_INDEX'; span: Span } // stack: list, index, value
  | { op: 'BIN'; bin: string; span: Span }
  | { op: 'NEG'; span: Span }
  | { op: 'NOT'; span: Span }
  | { op: 'JMP'; to: number; span: Span }
  | { op: 'JF'; to: number; span: Span } // pop; jump if false (must be a Boolean)
  | { op: 'AND_JMP'; to: number; span: Span } // short-circuit: if top is false, jump keeping it; else pop
  | { op: 'OR_JMP'; to: number; span: Span }
  | { op: 'CHECK_BOOL'; what: string; span: Span }
  | { op: 'CHECK_LIST'; span: Span }
  | { op: 'CALL'; name: string; argc: number; span: Span }
  | { op: 'BUILTIN'; name: string; argc: number; span: Span }
  | { op: 'RET'; span: Span }
  | { op: 'RETV'; span: Span }
  | { op: 'POP'; span: Span }
  | { op: 'COUNT_INIT'; name: string; span: Span } // pop count, validate, store in hidden var
  | { op: 'COUNT_DOWN'; name: string; to: number; span: Span } // if hidden var ≤ 0 jump, else decrement
  | { op: 'EACH_NEXT'; item: string; list: string; idx: string; to: number; span: Span }
  | { op: 'STMT'; id: string; kind: Stmt['kind']; span: Span };

export interface Fn {
  name: string;
  params: string[];
  code: Instr[];
  span: Span;
}

export interface Compiled {
  main: Fn;
  procs: Map<string, Fn>;
  program: Program;
}

/** Source → bytecode. Throws CompileError on the first mistake. */
export function compileSource(src: string): Compiled {
  return compile(parse(src));
}

export function compile(program: Program): Compiled {
  const procs = new Map<string, Fn>();
  const defs = program.body.filter((s): s is Extract<Stmt, { kind: 'proc' }> => s.kind === 'proc');
  for (const d of defs) {
    if (BUILTINS[d.name]) throw new CompileError(`${d.name} is a built-in procedure, so you can't define your own with that name.`, d.span);
    if (procs.has(d.name)) throw new CompileError(`There are two procedures named ${d.name}.`, d.span);
    procs.set(d.name, { name: d.name, params: d.params, code: [], span: d.span });
  }
  const main: Fn = { name: '(main program)', params: [], code: [], span: program.body[0]?.span ?? { from: 0, to: 0, line: 1, col: 1 } };
  new FnCompiler(main, procs, false).stmts(program.body.filter((s) => s.kind !== 'proc'));
  for (const d of defs) {
    const fn = procs.get(d.name)!;
    const c = new FnCompiler(fn, procs, true);
    c.stmts(d.body);
    c.emit({ op: 'RET', span: endSpan(d.span) });
  }
  return { main, procs, program };
}

function endSpan(s: Span): Span {
  return { ...s, from: s.to - 1, to: s.to };
}

class FnCompiler {
  private hidden = 0;
  constructor(private fn: Fn, private procs: Map<string, Fn>, private inProc: boolean) {}

  emit(i: Instr): number {
    this.fn.code.push(i);
    return this.fn.code.length - 1;
  }
  private get here() { return this.fn.code.length; }
  private patch(at: number) {
    (this.fn.code[at] as { to: number }).to = this.here;
  }
  private tmp(kind: string) { return `#${kind}${this.hidden++}`; }

  stmts(list: Stmt[]) { list.forEach((s) => this.stmt(s)); }

  private stmt(s: Stmt) {
    // Loops mark their head on each iteration, so the STMT for loops is emitted inside.
    if (s.kind !== 'repeat' && s.kind !== 'until' && s.kind !== 'foreach') {
      this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
    }
    switch (s.kind) {
      case 'assign':
        if (s.target.kind === 'var') {
          this.expr(s.value);
          this.emit({ op: 'STORE', name: s.target.name, span: s.span });
        } else {
          this.expr(s.target.list);
          this.expr(s.target.index);
          this.expr(s.value);
          this.emit({ op: 'STORE_INDEX', span: s.span });
        }
        break;
      case 'expr':
        this.call(s.expr, false);
        this.emit({ op: 'POP', span: s.span });
        break;
      case 'if': {
        this.expr(s.cond);
        const jf = this.emit({ op: 'JF', to: -1, span: s.cond.span });
        this.stmts(s.then);
        if (s.else) {
          const jmp = this.emit({ op: 'JMP', to: -1, span: s.span });
          this.patch(jf);
          this.stmts(s.else);
          this.patch(jmp);
        } else {
          this.patch(jf);
        }
        break;
      }
      case 'repeat': {
        const c = this.tmp('times');
        this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
        this.expr(s.count);
        this.emit({ op: 'COUNT_INIT', name: c, span: s.count.span });
        const top = this.here;
        const down = this.emit({ op: 'COUNT_DOWN', name: c, to: -1, span: headSpan(s) });
        this.stmts(s.body);
        this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
        this.emit({ op: 'JMP', to: top, span: s.span });
        this.patch(down);
        break;
      }
      case 'until': {
        const top = this.here;
        this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
        this.expr(s.cond);
        this.emit({ op: 'NOT', span: s.cond.span });
        const jf = this.emit({ op: 'JF', to: -1, span: s.cond.span });
        this.stmts(s.body);
        this.emit({ op: 'JMP', to: top, span: s.span });
        this.patch(jf);
        break;
      }
      case 'foreach': {
        const list = this.tmp('list'), idx = this.tmp('i');
        this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
        this.expr(s.list);
        this.emit({ op: 'CHECK_LIST', span: s.list.span });
        this.emit({ op: 'STORE_REF', name: list, span: s.list.span });
        this.emit({ op: 'CONST', v: 0, span: s.span });
        this.emit({ op: 'STORE_REF', name: idx, span: s.span });
        const top = this.here;
        const next = this.emit({ op: 'EACH_NEXT', item: s.item, list, idx, to: -1, span: headSpan(s) });
        this.stmts(s.body);
        this.emit({ op: 'STMT', id: s.id, kind: s.kind, span: headSpan(s) });
        this.emit({ op: 'JMP', to: top, span: s.span });
        this.patch(next);
        break;
      }
      case 'return':
        if (!this.inProc) throw new CompileError('RETURN can only be used inside a PROCEDURE.', s.span);
        if (s.value) {
          this.expr(s.value);
          this.emit({ op: 'RETV', span: s.span });
        } else {
          this.emit({ op: 'RET', span: s.span });
        }
        break;
      case 'proc':
        throw new CompileError('Procedures must be defined at the top level.', s.span);
    }
  }

  private expr(e: Expr) {
    switch (e.kind) {
      case 'num': case 'str': case 'bool':
        this.emit({ op: 'CONST', v: e.value, span: e.span });
        break;
      case 'var':
        this.emit({ op: 'LOAD', name: e.name, span: e.span });
        break;
      case 'list':
        e.items.forEach((x) => this.expr(x));
        this.emit({ op: 'LIST', n: e.items.length, span: e.span });
        break;
      case 'index':
        this.expr(e.list);
        this.expr(e.index);
        this.emit({ op: 'INDEX', span: e.span });
        break;
      case 'un':
        this.expr(e.operand);
        this.emit(e.op === 'NOT' ? { op: 'NOT', span: e.span } : { op: 'NEG', span: e.span });
        break;
      case 'bin':
        if (e.op === 'AND' || e.op === 'OR') {
          this.expr(e.left);
          const j = this.emit({ op: e.op === 'AND' ? 'AND_JMP' : 'OR_JMP', to: -1, span: e.left.span });
          this.expr(e.right);
          this.emit({ op: 'CHECK_BOOL', what: e.op, span: e.right.span });
          this.patch(j);
        } else {
          this.expr(e.left);
          this.expr(e.right);
          this.emit({ op: 'BIN', bin: e.op, span: e.span });
        }
        break;
      case 'call':
        this.call(e, true);
        break;
    }
  }

  private call(e: Extract<Expr, { kind: 'call' }>, asValue: boolean) {
    const b = BUILTINS[e.name];
    if (b) {
      const [min, max, returns] = b;
      if (e.args.length < min || e.args.length > max) {
        throw new CompileError(`${e.name} takes ${plural(min, 'input')}, but was given ${e.args.length}.`, e.span);
      }
      if (asValue && !returns) throw new CompileError(`${e.name} doesn't produce a value, so it can't be used inside an expression.`, e.span);
      if (e.name === 'CAN_MOVE' && e.args[0].kind === 'var' && ROBOT_DIRECTIONS.includes(e.args[0].name)) {
        this.emit({ op: 'CONST', v: e.args[0].name, span: e.args[0].span });
      } else {
        e.args.forEach((x) => this.expr(x));
      }
      this.emit({ op: 'BUILTIN', name: e.name, argc: e.args.length, span: e.span });
      return;
    }
    const fn = this.procs.get(e.name);
    if (!fn) {
      const lower = e.name.toLowerCase();
      const hint = [...Object.keys(BUILTINS), ...this.procs.keys()].find((n) => n.toLowerCase() === lower);
      throw new CompileError(
        hint ? `There's no procedure named ${e.name}. Did you mean ${hint}?` : `There's no procedure named ${e.name}.`,
        e.nameSpan,
      );
    }
    if (e.args.length !== fn.params.length) {
      throw new CompileError(`${e.name} takes ${plural(fn.params.length, 'input')}, but was given ${e.args.length}.`, e.span);
    }
    e.args.forEach((x) => this.expr(x));
    this.emit({ op: 'CALL', name: e.name, argc: e.args.length, span: e.span });
  }
}

/** The part of a statement to highlight: compound statements highlight only their first line. */
function headSpan(s: Stmt): Span {
  if (s.kind === 'if' || s.kind === 'repeat' || s.kind === 'until' || s.kind === 'foreach' || s.kind === 'proc') {
    const head =
      s.kind === 'if' ? s.cond.span : s.kind === 'repeat' ? s.count.span : s.kind === 'until' ? s.cond.span : s.kind === 'foreach' ? s.list.span : s.span;
    if (s.kind === 'proc') return s.span;
    // from the keyword to the end of the header expression (+1 for a closing paren, if any)
    return { ...s.span, to: Math.max(head.to, s.span.from) };
  }
  return s.span;
}

function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}
