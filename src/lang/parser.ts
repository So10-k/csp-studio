import type { BinOp, Expr, Program, Stmt, Target } from './ast';
import { CompileError, joinSpans, type Span } from './errors';
import { KEYWORDS, lex, type Token } from './lexer';

const LOWER_KEYWORDS = new Map([...KEYWORDS].map((k) => [k.toLowerCase(), k]));

/** Parse a whole program. Throws CompileError (with a span) on the first mistake. */
export function parse(src: string): Program {
  return new Parser(lex(src)).program();
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  // ── token helpers ──────────────────────────────────────────
  private get t(): Token { return this.toks[this.i]; }
  private get prev(): Token { return this.toks[this.i - 1]; }
  private peek(n = 1): Token { return this.toks[Math.min(this.i + n, this.toks.length - 1)]; }
  private is(value: string, type?: Token['type']): boolean {
    return this.t.value === value && (type ? this.t.type === type : this.t.type !== 'str' && this.t.type !== 'ident');
  }
  private next(): Token { return this.toks[this.i++]; }
  private accept(value: string): boolean {
    if (this.is(value)) { this.i++; return true; }
    return false;
  }
  private expect(value: string, what: string): Token {
    if (this.is(value)) return this.next();
    throw this.err(`Expected ${quote(value)} ${what}, but found ${describe(this.t)}.`);
  }
  private err(msg: string, span: Span = this.t.span): CompileError {
    return new CompileError(msg, span);
  }
  private ident(what: string): Token {
    if (this.t.type === 'ident') return this.next();
    if (this.t.type === 'kw') throw this.err(`${this.t.value} is a reserved word, so it can't be used as ${what}.`);
    throw this.err(`Expected ${what}, but found ${describe(this.t)}.`);
  }

  // ── statements ─────────────────────────────────────────────
  program(): Program {
    const body: Stmt[] = [];
    while (this.t.type !== 'eof') {
      if (this.is('}')) throw this.err('This } has no matching {.');
      body.push(this.stmt(true));
    }
    return { body };
  }

  private block(after: string): Stmt[] {
    const open = this.expect('{', `after ${after}`);
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.t.type === 'eof') throw this.err(`The { on line ${open.span.line} is never closed with a }.`, open.span);
      body.push(this.stmt(false));
    }
    this.next();
    return body;
  }

  private stmt(topLevel: boolean): Stmt {
    const start = this.t;
    const id = `s${start.span.from}`;
    const done = <T extends object>(s: T): Stmt => ({ id, span: joinSpans(start.span, this.prev.span), ...s }) as unknown as Stmt;

    if (start.type === 'ident' && LOWER_KEYWORDS.has(start.value.toLowerCase()) && start.value !== start.value.toUpperCase()) {
      const kw = LOWER_KEYWORDS.get(start.value.toLowerCase())!;
      if (['IF', 'REPEAT', 'FOR', 'PROCEDURE', 'RETURN', 'ELSE'].includes(kw)) {
        throw this.err(`Keywords are written in capitals: write ${kw} instead of ${start.value}.`);
      }
    }

    if (this.accept('IF')) {
      const cond = this.condition('IF');
      const then = this.block(`IF (…)`);
      let els: Stmt[] | null = null;
      if (this.accept('ELSE')) {
        els = this.is('IF') ? [this.stmt(false)] : this.block('ELSE');
      }
      return done({ kind: 'if', cond, then, else: els });
    }
    if (this.accept('ELSE')) throw this.err('This ELSE has no IF before it.', start.span);
    if (this.accept('REPEAT')) {
      if (this.accept('UNTIL')) {
        const cond = this.condition('REPEAT UNTIL');
        return done({ kind: 'until', cond, body: this.block('REPEAT UNTIL (…)') });
      }
      if (this.is('{')) throw this.err('REPEAT needs either a count (REPEAT n TIMES) or UNTIL (condition).');
      const count = this.expr();
      this.expect('TIMES', `after REPEAT ${'n'}`);
      return done({ kind: 'repeat', count, body: this.block('REPEAT … TIMES') });
    }
    if (this.accept('FOR')) {
      this.expect('EACH', 'after FOR');
      const item = this.ident('a variable name after FOR EACH').value;
      this.expect('IN', `after FOR EACH ${item}`);
      const list = this.expr();
      return done({ kind: 'foreach', item, list, body: this.block(`FOR EACH ${item} IN …`) });
    }
    if (this.accept('PROCEDURE')) {
      if (!topLevel) throw this.err('Procedures must be defined at the top level, not inside another block.', start.span);
      const name = this.ident('a procedure name').value;
      this.expect('(', `after the procedure name ${name}`);
      const params: string[] = [];
      if (!this.is(')')) {
        do {
          const p = this.ident('a parameter name');
          if (params.includes(p.value)) throw this.err(`The parameter ${p.value} appears twice.`, p.span);
          params.push(p.value);
        } while (this.accept(','));
      }
      this.expect(')', 'to close the parameter list');
      return done({ kind: 'proc', name, params, body: this.block(`PROCEDURE ${name}(…)`) });
    }
    if (this.accept('RETURN')) {
      let value: Expr | null = null;
      if (this.is('(') && this.peek().value === ')' && this.peek().type === 'punct') {
        this.i += 2;
      } else if (!this.is('}') && this.t.type !== 'eof' && this.t.span.line === start.span.line) {
        value = this.expr();
      }
      return done({ kind: 'return', value });
    }

    // assignment or procedure call
    const lhs = this.postfix();
    if (this.is('←')) {
      this.next();
      if (lhs.kind !== 'var' && lhs.kind !== 'index') throw this.err('Only a variable or a list element can go on the left of ←.', lhs.span);
      const value = this.expr();
      return done({ kind: 'assign', target: lhs as Target, value });
    }
    if (this.is('=') && (lhs.kind === 'var' || lhs.kind === 'index')) {
      throw this.err('To store a value, use ← (or type <-). The = sign compares two values.');
    }
    if (lhs.kind === 'call') return done({ kind: 'expr', expr: lhs });
    if (lhs.kind === 'var') {
      throw this.err(`Expected ← or ( after ${lhs.name}, but found ${describe(this.t)}.`);
    }
    throw this.err('A line must be an assignment (x ← …), a procedure call, or a statement like IF or REPEAT.', lhs.span);
  }

  private condition(after: string): Expr {
    if (!this.is('(')) throw this.err(`Expected ( after ${after}, but found ${describe(this.t)}.`);
    // The condition is a parenthesized expression; parse the whole thing so "(a) AND (b)" works too.
    return this.expr();
  }

  // ── expressions ────────────────────────────────────────────
  expr(): Expr { return this.or(); }

  private binary(next: () => Expr, ops: string[]): Expr {
    let left = next();
    while (ops.includes(this.t.value) && (this.t.type === 'op' || this.t.type === 'kw')) {
      const op = this.next().value as BinOp;
      const right = next();
      left = { kind: 'bin', op, left, right, span: joinSpans(left.span, right.span) };
    }
    return left;
  }
  private or = (): Expr => this.binary(this.and, ['OR']);
  private and = (): Expr => this.binary(this.not, ['AND']);
  private not = (): Expr => {
    if (this.is('NOT')) {
      const t = this.next();
      const operand = this.not();
      return { kind: 'un', op: 'NOT', operand, span: joinSpans(t.span, operand.span) };
    }
    return this.rel();
  };
  private rel = (): Expr => {
    if (this.is('==')) throw this.err('Use a single = to compare.');
    const left = this.add();
    if (this.is('==')) throw this.err('Use a single = to compare.');
    if (['=', '≠', '<', '>', '≤', '≥'].includes(this.t.value) && this.t.type === 'op') {
      const op = this.next().value as BinOp;
      const right = this.add();
      return { kind: 'bin', op, left, right, span: joinSpans(left.span, right.span) };
    }
    return left;
  };
  private add = (): Expr => this.binary(this.mul, ['+', '-']);
  private mul = (): Expr => this.binary(this.unary, ['*', '/', 'MOD']);
  private unary = (): Expr => {
    if (this.is('-', 'op')) {
      const t = this.next();
      const operand = this.unary();
      if (operand.kind === 'num') return { kind: 'num', value: -operand.value, span: joinSpans(t.span, operand.span) };
      return { kind: 'un', op: '-', operand, span: joinSpans(t.span, operand.span) };
    }
    return this.postfix();
  };

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      // A ( or [ only continues an expression on the same line (so a new line always starts a new statement).
      if (this.is('[', 'punct') && this.t.span.line === this.prev.span.line) {
        this.next();
        const index = this.expr();
        const close = this.expect(']', 'to close the list index');
        e = { kind: 'index', list: e, index, span: joinSpans(e.span, close.span) };
      } else if (this.is('(', 'punct') && e.kind === 'var' && this.t.span.line === this.prev.span.line) {
        this.next();
        const args: Expr[] = [];
        if (!this.is(')')) {
          do args.push(this.expr()); while (this.accept(','));
        }
        const close = this.expect(')', `to close the call to ${e.name}`);
        e = { kind: 'call', name: e.name, args, span: joinSpans(e.span, close.span), nameSpan: e.span };
      } else {
        return e;
      }
    }
  }

  private primary(): Expr {
    const t = this.t;
    if (t.type === 'num') { this.next(); return { kind: 'num', value: Number(t.value), span: t.span }; }
    if (t.type === 'str') { this.next(); return { kind: 'str', value: t.value, span: t.span }; }
    if (t.type === 'kw' && (t.value === 'TRUE' || t.value === 'FALSE')) {
      this.next();
      return { kind: 'bool', value: t.value === 'TRUE', span: t.span };
    }
    if (t.type === 'ident') { this.next(); return { kind: 'var', name: t.value, span: t.span }; }
    if (this.is('(', 'punct')) {
      this.next();
      const e = this.expr();
      this.expect(')', 'to close the (');
      return e;
    }
    if (this.is('[', 'punct')) {
      this.next();
      const items: Expr[] = [];
      if (!this.is(']')) {
        do items.push(this.expr()); while (this.accept(','));
      }
      const close = this.expect(']', 'to close the list');
      return { kind: 'list', items, span: joinSpans(t.span, close.span) };
    }
    if (t.type === 'eof') throw this.err('The program ends in the middle of an expression.');
    throw this.err(`Expected a value, but found ${describe(t)}.`);
  }
}

function quote(v: string) { return `"${v}"`; }

function describe(t: Token): string {
  switch (t.type) {
    case 'eof': return 'the end of the program';
    case 'str': return `the text "${t.value}"`;
    case 'num': return `the number ${t.value}`;
    case 'ident': return `the name ${t.value}`;
    default: return `"${t.value}"`;
  }
}
