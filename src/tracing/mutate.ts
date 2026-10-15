import type { Expr, Program, Stmt } from '../lang/ast';
import { NO_SPAN } from '../lang/errors';

/**
 * Misconception mutations: each turns the program into what a student with a common mistake
 * would effectively trace. Wrong answer choices come from running these, so every distractor
 * has a story ("this is what you'd get if the loop ran one more time").
 */
export interface Mutant {
  program: Program;
  why: string;
}

type Site = { stmt?: Stmt; expr?: Expr; block?: Stmt[]; index?: number };

interface Mutation {
  why: string;
  /** find the candidate places in a program */
  sites(p: Program): Site[];
  apply(site: Site): void;
}

const num = (value: number): Expr => ({ kind: 'num', value, span: NO_SPAN });

function eachExpr(e: Expr, fn: (e: Expr) => void) {
  fn(e);
  switch (e.kind) {
    case 'list': e.items.forEach((x) => eachExpr(x, fn)); break;
    case 'index': eachExpr(e.list, fn); eachExpr(e.index, fn); break;
    case 'bin': eachExpr(e.left, fn); eachExpr(e.right, fn); break;
    case 'un': eachExpr(e.operand, fn); break;
    case 'call': e.args.forEach((x) => eachExpr(x, fn)); break;
  }
}

function eachStmt(stmts: Stmt[], fn: (s: Stmt, block: Stmt[], i: number) => void) {
  stmts.forEach((s, i) => {
    fn(s, stmts, i);
    if (s.kind === 'if') { eachStmt(s.then, fn); if (s.else) eachStmt(s.else, fn); }
    if (s.kind === 'repeat' || s.kind === 'until' || s.kind === 'foreach' || s.kind === 'proc') eachStmt(s.body, fn);
  });
}

/** every expression in the program, with the statement it belongs to */
function allExprs(p: Program): { e: Expr; s: Stmt }[] {
  const out: { e: Expr; s: Stmt }[] = [];
  eachStmt(p.body, (s) => {
    const roots: Expr[] = [];
    if (s.kind === 'assign') { roots.push(s.value); if (s.target.kind === 'index') roots.push(s.target.index); }
    if (s.kind === 'expr') roots.push(s.expr);
    if (s.kind === 'if' || s.kind === 'until') roots.push(s.cond);
    if (s.kind === 'repeat') roots.push(s.count);
    if (s.kind === 'foreach') roots.push(s.list);
    if (s.kind === 'return' && s.value) roots.push(s.value);
    roots.forEach((r) => eachExpr(r, (e) => out.push({ e, s })));
  });
  return out;
}

const FLIP: Record<string, string> = { '<': '≤', '≤': '<', '>': '≥', '≥': '>' };

const MUTATIONS: Mutation[] = [
  {
    why: 'the loop ran one more time than it really does',
    sites: (p) => { const o: Site[] = []; eachStmt(p.body, (s) => { if (s.kind === 'repeat') o.push({ stmt: s }); }); return o; },
    apply: ({ stmt }) => { const s = stmt as Extract<Stmt, { kind: 'repeat' }>; s.count = { kind: 'bin', op: '+', left: s.count, right: num(1), span: NO_SPAN }; },
  },
  {
    why: 'the loop stopped one time too early',
    sites: (p) => { const o: Site[] = []; eachStmt(p.body, (s) => { if (s.kind === 'repeat') o.push({ stmt: s }); }); return o; },
    apply: ({ stmt }) => { const s = stmt as Extract<Stmt, { kind: 'repeat' }>; s.count = { kind: 'bin', op: '-', left: s.count, right: num(1), span: NO_SPAN }; },
  },
  {
    why: 'a comparison like > were read as ≥ (or < as ≤): watch the boundary case',
    sites: (p) => allExprs(p).filter(({ e }) => e.kind === 'bin' && FLIP[e.op]).map(({ e }) => ({ expr: e })),
    apply: ({ expr }) => { const e = expr as Extract<Expr, { kind: 'bin' }>; e.op = FLIP[e.op] as typeof e.op; },
  },
  {
    why: 'the IF condition were decided the other way around',
    sites: (p) => { const o: Site[] = []; eachStmt(p.body, (s) => { if (s.kind === 'if') o.push({ stmt: s }); }); return o; },
    apply: ({ stmt }) => { const s = stmt as Extract<Stmt, { kind: 'if' }>; s.cond = { kind: 'un', op: 'NOT', operand: s.cond, span: NO_SPAN }; },
  },
  {
    why: 'lists started at index 0 (in AP CSP pseudocode the first element is index 1)',
    sites: (p) => allExprs(p).filter(({ e }) => e.kind === 'index').map(({ e }) => ({ expr: e })),
    apply: ({ expr }) => { const e = expr as Extract<Expr, { kind: 'index' }>; e.index = { kind: 'bin', op: '+', left: e.index, right: num(1), span: NO_SPAN }; },
  },
  {
    why: 'those two lines ran in the opposite order (the order of assignments matters)',
    sites: (p) => {
      const o: Site[] = [];
      eachStmt(p.body, (s, block, i) => { if (s.kind === 'assign' && block[i + 1]?.kind === 'assign') o.push({ block, index: i }); });
      return o;
    },
    apply: ({ block, index }) => { const b = block!, i = index!; [b[i], b[i + 1]] = [b[i + 1], b[i]]; },
  },
  {
    why: 'the last line inside the loop were skipped',
    sites: (p) => { const o: Site[] = []; eachStmt(p.body, (s) => { if ((s.kind === 'repeat' || s.kind === 'until' || s.kind === 'foreach') && s.body.length > 1) o.push({ stmt: s }); }); return o; },
    apply: ({ stmt }) => { (stmt as Extract<Stmt, { kind: 'repeat' }>).body.pop(); },
  },
  {
    why: 'MOD and / were mixed up (MOD gives the remainder)',
    sites: (p) => allExprs(p).filter(({ e }) => e.kind === 'bin' && (e.op === 'MOD' || e.op === '/')).map(({ e }) => ({ expr: e })),
    apply: ({ expr }) => { const e = expr as Extract<Expr, { kind: 'bin' }>; e.op = e.op === 'MOD' ? '/' : 'MOD'; },
  },
  {
    why: 'AND and OR were mixed up',
    sites: (p) => allExprs(p).filter(({ e }) => e.kind === 'bin' && (e.op === 'AND' || e.op === 'OR')).map(({ e }) => ({ expr: e })),
    apply: ({ expr }) => { const e = expr as Extract<Expr, { kind: 'bin' }>; e.op = e.op === 'AND' ? 'OR' : 'AND'; },
  },
  {
    why: 'an assignment used the old value of a variable instead of the updated one',
    sites: (p) => {
      // x ← x + y  →  x ← y : forgetting to include the variable's current value
      const o: Site[] = [];
      eachStmt(p.body, (s) => {
        if (s.kind === 'assign' && s.target.kind === 'var' && s.value.kind === 'bin' && s.value.op === '+' && s.value.left.kind === 'var' && s.value.left.name === s.target.name) o.push({ stmt: s });
      });
      return o;
    },
    apply: ({ stmt }) => { const s = stmt as Extract<Stmt, { kind: 'assign' }>; s.value = (s.value as Extract<Expr, { kind: 'bin' }>).right; },
  },
];

function renameVar(stmts: Stmt[], from: string, to: string) {
  eachStmt(stmts, (s) => {
    if (s.kind === 'assign' && s.target.kind === 'var' && s.target.name === from) s.target.name = to;
    if (s.kind === 'foreach' && s.item === from) s.item = to;
  });
  for (const { e } of allExprs({ body: stmts })) if (e.kind === 'var' && e.name === from) e.name = to;
}

MUTATIONS.push(
  {
    why: 'b ← a made both names share one list (in AP CSP pseudocode, assigning a list makes a copy)',
    sites: (p) => {
      const o: Site[] = [];
      p.body.forEach((s, i) => { if (s.kind === 'assign' && s.target.kind === 'var' && s.value.kind === 'var') o.push({ block: p.body, index: i }); });
      return o;
    },
    apply: ({ block, index }) => {
      const s = block![index!] as Extract<Stmt, { kind: 'assign' }>;
      const from = (s.target as { name: string }).name, to = (s.value as { name: string }).name;
      renameVar(block!.slice(index! + 1), from, to);
    },
  },
  {
    why: 'changing a parameter inside the procedure changed the global variable with the same name',
    sites: (p) => {
      const globals = new Set(p.body.flatMap((s) => (s.kind === 'assign' && s.target.kind === 'var' ? [s.target.name] : [])));
      return p.body.filter((s) => s.kind === 'proc' && s.params.some((x) => globals.has(x))).map((s) => ({ stmt: s }));
    },
    apply: () => { /* replaced below: needs the whole program */ },
  },
);

/** All single-mistake versions of a program. */
export function mutants(p: Program): Mutant[] {
  const out: Mutant[] = [];
  for (const m of MUTATIONS) {
    const count = m.sites(p).length;
    for (let i = 0; i < count; i++) {
      const copy = structuredClone(p);
      const site = m.sites(copy)[i];
      if (!site) continue;
      if (m.why.startsWith('changing a parameter')) applyParamToGlobal(copy, site.stmt as Extract<Stmt, { kind: 'proc' }>);
      else m.apply(site);
      out.push({ program: copy, why: m.why });
    }
  }
  return out;
}

/** Drop the parameter that shadows a global (and its argument in every call), so the body uses the global. */
function applyParamToGlobal(p: Program, proc: Extract<Stmt, { kind: 'proc' }>) {
  const globals = new Set(p.body.flatMap((s) => (s.kind === 'assign' && s.target.kind === 'var' ? [s.target.name] : [])));
  const i = proc.params.findIndex((x) => globals.has(x));
  if (i < 0) return;
  proc.params.splice(i, 1);
  for (const { e } of allExprs(p)) if (e.kind === 'call' && e.name === proc.name && e.args.length > i) e.args.splice(i, 1);
}
