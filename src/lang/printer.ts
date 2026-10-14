import type { Expr, Program, Stmt } from './ast';

const PREC: Record<string, number> = {
  OR: 1, AND: 2, NOT: 3,
  '=': 4, '≠': 4, '<': 4, '>': 4, '≤': 4, '≥': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, MOD: 6,
};
const UNARY_MINUS = 7;
const ATOM = 9;

function prec(e: Expr): number {
  if (e.kind === 'bin') return PREC[e.op];
  if (e.kind === 'un') return e.op === 'NOT' ? PREC.NOT : UNARY_MINUS;
  if (e.kind === 'num' && e.value < 0) return UNARY_MINUS;
  return ATOM;
}

export function printExpr(e: Expr): string {
  const wrap = (x: Expr, min: number) => (prec(x) < min ? `(${printExpr(x)})` : printExpr(x));
  switch (e.kind) {
    case 'num': return formatNum(e.value);
    case 'str': return `"${e.value}"`;
    case 'bool': return e.value ? 'true' : 'false';
    case 'var': return e.name;
    case 'list': return `[${e.items.map(printExpr).join(', ')}]`;
    case 'index': return `${wrap(e.list, ATOM)}[${printExpr(e.index)}]`;
    case 'call': return `${e.name}(${e.args.map(printExpr).join(', ')})`;
    case 'un':
      return e.op === 'NOT' ? `NOT ${wrap(e.operand, PREC.NOT)}` : `-${wrap(e.operand, UNARY_MINUS)}`;
    case 'bin': {
      const p = PREC[e.op];
      const rel = p === 4;
      // left-associative: the right side needs parens at equal precedence; comparisons never chain.
      return `${wrap(e.left, rel ? p + 1 : p)} ${e.op} ${wrap(e.right, p + 1)}`;
    }
  }
}

function formatNum(n: number): string {
  return String(n);
}

export function printProgram(p: Program, indent = '    '): string {
  const out: string[] = [];
  const block = (stmts: Stmt[], depth: number) => stmts.forEach((s) => stmt(s, depth));
  const line = (depth: number, text: string) => out.push(indent.repeat(depth) + text);

  function stmt(s: Stmt, d: number) {
    switch (s.kind) {
      case 'assign': {
        const t = s.target.kind === 'var' ? s.target.name : printExpr(s.target);
        line(d, `${t} ← ${printExpr(s.value)}`);
        break;
      }
      case 'expr': line(d, printExpr(s.expr)); break;
      case 'return': line(d, s.value ? `RETURN(${printExpr(s.value)})` : 'RETURN()'); break;
      case 'if': {
        line(d, `IF (${printExpr(s.cond)})`);
        line(d, '{');
        block(s.then, d + 1);
        line(d, '}');
        if (s.else) {
          line(d, 'ELSE');
          line(d, '{');
          block(s.else, d + 1);
          line(d, '}');
        }
        break;
      }
      case 'repeat': opened(d, `REPEAT ${printExpr(s.count)} TIMES`, s.body); break;
      case 'until': opened(d, `REPEAT UNTIL (${printExpr(s.cond)})`, s.body); break;
      case 'foreach': opened(d, `FOR EACH ${s.item} IN ${printExpr(s.list)}`, s.body); break;
      case 'proc': opened(d, `PROCEDURE ${s.name}(${s.params.join(', ')})`, s.body); break;
    }
  }
  function opened(d: number, head: string, body: Stmt[]) {
    line(d, head);
    line(d, '{');
    block(body, d + 1);
    line(d, '}');
  }

  p.body.forEach((s, i) => {
    // a blank line around procedure definitions keeps programs readable
    if (i > 0 && (s.kind === 'proc' || p.body[i - 1].kind === 'proc')) out.push('');
    stmt(s, 0);
  });
  return out.join('\n') + '\n';
}
