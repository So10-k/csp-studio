/**
 * AST ⇄ Blockly's JSON serialization. Pure (no Blockly import), so it is unit-tested directly.
 * Statement blocks use the statement's id as their block id, so the debugger can highlight them.
 */
import type { BinOp, Expr, Program, Stmt } from '../../lang/ast';
import { NO_SPAN, type Span } from '../../lang/errors';
import { KEYWORDS } from '../../lang/lexer';

export interface BlockJson {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, string | number>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson; shadow?: BlockJson };
  extraState?: { n: number };
}
export interface WorkspaceJson {
  blocks?: { languageVersion: number; blocks: BlockJson[] };
}

/** A block that can't become code yet (empty slot, bad name…). */
export class BlockError extends Error {
  constructor(message: string, public blockId: string | undefined) {
    super(message);
  }
}

const ARITH = new Set(['+', '-', '*', '/', 'MOD']);
const COMPARE = new Set(['=', '≠', '<', '>', '≤', '≥']);
const ROBOT_STMT: Record<string, string> = { MOVE_FORWARD: 'csp_move', ROTATE_LEFT: 'csp_left', ROTATE_RIGHT: 'csp_right' };

// ── AST → blocks ───────────────────────────────────────────────
export function programToJson(p: Program): WorkspaceJson {
  // consecutive non-procedure statements form one stack; each procedure is its own stack
  const stacks: Stmt[][] = [];
  for (const s of p.body) {
    const last = stacks[stacks.length - 1];
    if (s.kind === 'proc' || !last || last[0].kind === 'proc') stacks.push([s]);
    else last.push(s);
  }
  const blocks = stacks.map((st, i) => ({ ...chain(st)!, x: 24, y: 24 + i * 400 }));
  return { blocks: { languageVersion: 0, blocks } };
}

function chain(stmts: Stmt[]): BlockJson | undefined {
  let next: BlockJson | undefined;
  for (let i = stmts.length - 1; i >= 0; i--) {
    const b = stmtBlock(stmts[i]);
    if (next) b.next = { block: next };
    next = b;
  }
  return next;
}

function stmtBlock(s: Stmt): BlockJson {
  const id = s.id;
  const inp = (o: Record<string, Expr | Stmt[] | null>) => {
    const inputs: BlockJson['inputs'] = {};
    for (const [k, v] of Object.entries(o)) {
      if (!v) continue;
      if (Array.isArray(v)) { const c = chain(v); if (c) inputs[k] = { block: c }; }
      else inputs[k] = { block: exprBlock(v) };
    }
    return inputs;
  };
  switch (s.kind) {
    case 'assign':
      if (s.target.kind === 'var') return { type: 'csp_assign', id, fields: { VAR: s.target.name }, inputs: inp({ VALUE: s.value }) };
      return { type: 'csp_assign_index', id, inputs: inp({ LIST: s.target.list, INDEX: s.target.index, VALUE: s.value }) };
    case 'if':
      return s.else
        ? { type: 'csp_if_else', id, inputs: inp({ COND: s.cond, THEN: s.then, ELSE: s.else }) }
        : { type: 'csp_if', id, inputs: inp({ COND: s.cond, THEN: s.then }) };
    case 'repeat': return { type: 'csp_repeat', id, inputs: inp({ COUNT: s.count, BODY: s.body }) };
    case 'until': return { type: 'csp_until', id, inputs: inp({ COND: s.cond, BODY: s.body }) };
    case 'foreach': return { type: 'csp_foreach', id, fields: { ITEM: s.item }, inputs: inp({ LIST: s.list, BODY: s.body }) };
    case 'proc': return { type: 'csp_proc', id, fields: { NAME: s.name, PARAMS: s.params.join(', ') }, inputs: inp({ BODY: s.body }) };
    case 'return': return { type: 'csp_return', id, inputs: inp({ VALUE: s.value }) };
    case 'expr': {
      const { name, args } = s.expr;
      if (name === 'DISPLAY' && args.length === 1) return { type: 'csp_display', id, inputs: inp({ VALUE: args[0] }) };
      if (name === 'APPEND' && args.length === 2) return { type: 'csp_append', id, inputs: inp({ LIST: args[0], VALUE: args[1] }) };
      if (name === 'INSERT' && args.length === 3) return { type: 'csp_insert', id, inputs: inp({ LIST: args[0], INDEX: args[1], VALUE: args[2] }) };
      if (name === 'REMOVE' && args.length === 2) return { type: 'csp_remove', id, inputs: inp({ LIST: args[0], INDEX: args[1] }) };
      if (ROBOT_STMT[name] && args.length === 0) return { type: ROBOT_STMT[name], id };
      return callBlock('csp_call', name, args, id);
    }
  }
}

function callBlock(type: string, name: string, args: Expr[], id?: string): BlockJson {
  const inputs: BlockJson['inputs'] = {};
  args.forEach((a, i) => { inputs[`ARG${i}`] = { block: exprBlock(a) }; });
  return { type, ...(id ? { id } : {}), fields: { NAME: name }, extraState: { n: args.length }, inputs };
}

function exprBlock(e: Expr): BlockJson {
  const two = (type: string, op: string, a: Expr, b: Expr): BlockJson => ({ type, fields: { OP: op }, inputs: { A: { block: exprBlock(a) }, B: { block: exprBlock(b) } } });
  switch (e.kind) {
    case 'num': return { type: 'csp_num', fields: { NUM: e.value } };
    case 'str': return { type: 'csp_str', fields: { TEXT: e.value } };
    case 'bool': return { type: 'csp_bool', fields: { BOOL: e.value ? 'TRUE' : 'FALSE' } };
    case 'var': return { type: 'csp_var', fields: { VAR: e.name } };
    case 'list': {
      const inputs: BlockJson['inputs'] = {};
      e.items.forEach((x, i) => { inputs[`ARG${i}`] = { block: exprBlock(x) }; });
      return { type: 'csp_list', extraState: { n: e.items.length }, inputs };
    }
    case 'index': return { type: 'csp_index', inputs: { LIST: { block: exprBlock(e.list) }, INDEX: { block: exprBlock(e.index) } } };
    case 'un':
      return { type: e.op === 'NOT' ? 'csp_not' : 'csp_neg', inputs: { A: { block: exprBlock(e.operand) } } };
    case 'bin':
      if (ARITH.has(e.op)) return two('csp_arith', e.op, e.left, e.right);
      if (COMPARE.has(e.op)) return two('csp_compare', e.op, e.left, e.right);
      return two('csp_logic', e.op, e.left, e.right);
    case 'call': {
      const { name, args } = e;
      if (name === 'INPUT' && args.length === 0) return { type: 'csp_input' };
      if (name === 'RANDOM' && args.length === 2) return { type: 'csp_random', inputs: { A: { block: exprBlock(args[0]) }, B: { block: exprBlock(args[1]) } } };
      if (name === 'LENGTH' && args.length === 1) return { type: 'csp_length', inputs: { LIST: { block: exprBlock(args[0]) } } };
      if (name === 'CAN_MOVE' && args.length === 1) {
        const a = args[0];
        const dir = a.kind === 'var' ? a.name : a.kind === 'str' ? a.value : null;
        if (dir && ['forward', 'left', 'right', 'backward'].includes(dir)) return { type: 'csp_can_move', fields: { DIR: dir } };
      }
      return callBlock('csp_call_value', name, args);
    }
  }
}

// ── blocks → AST ───────────────────────────────────────────────
const S: Span = NO_SPAN;
let counter = 0;

/** Convert a saved workspace. Top-level stacks are taken in order from top to bottom; loose value blocks are ignored. */
export function jsonToProgram(ws: WorkspaceJson): Program {
  const tops = [...(ws.blocks?.blocks ?? [])].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const body: Stmt[] = [];
  for (const top of tops) {
    if (!STMT_TYPES.has(top.type)) continue;
    const stmts = stmtChain(top);
    for (const s of stmts) {
      if (s.kind === 'proc' && stmts.length > 1) throw new BlockError('Put each PROCEDURE block on its own, not attached under other blocks.', s.id);
    }
    body.push(...stmts);
  }
  return { body };
}

const STMT_TYPES = new Set([
  'csp_assign', 'csp_assign_index', 'csp_if', 'csp_if_else', 'csp_repeat', 'csp_until', 'csp_foreach', 'csp_proc',
  'csp_return', 'csp_display', 'csp_append', 'csp_insert', 'csp_remove', 'csp_move', 'csp_left', 'csp_right', 'csp_call',
]);

function child(slot: { block?: BlockJson; shadow?: BlockJson } | undefined): BlockJson | undefined {
  return slot?.block ?? slot?.shadow;
}

function stmtChain(first: BlockJson | undefined): Stmt[] {
  const out: Stmt[] = [];
  for (let b = first; b; b = child(b.next)) out.push(stmtFrom(b));
  return out;
}

function name(b: BlockJson, field: string, what: string): string {
  const v = String(b.fields?.[field] ?? '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new BlockError(`"${v}" isn't a valid ${what} name (use letters, digits and _ , starting with a letter).`, b.id);
  if (KEYWORDS.has(v) || /^(true|false)$/i.test(v)) throw new BlockError(`${v} is a reserved word, so it can't be a ${what} name.`, b.id);
  return v;
}

function stmtFrom(b: BlockJson): Stmt {
  const id = b.id ?? `b${counter++}`;
  const e = (input: string, what: string) => exprIn(b, input, what);
  const stmts = (input: string) => stmtChain(child(b.inputs?.[input]));
  const mk = (s: object) => ({ id, span: S, ...s }) as Stmt;
  const call = (n: string, args: Expr[]) => mk({ kind: 'expr', expr: { kind: 'call', name: n, args, span: S, nameSpan: S } });
  switch (b.type) {
    case 'csp_assign': return mk({ kind: 'assign', target: { kind: 'var', name: name(b, 'VAR', 'variable'), span: S }, value: e('VALUE', 'the value to store') });
    case 'csp_assign_index': return mk({ kind: 'assign', target: { kind: 'index', list: e('LIST', 'the list'), index: e('INDEX', 'the index'), span: S }, value: e('VALUE', 'the value to store') });
    case 'csp_if': return mk({ kind: 'if', cond: e('COND', 'the condition'), then: stmts('THEN'), else: null });
    case 'csp_if_else': return mk({ kind: 'if', cond: e('COND', 'the condition'), then: stmts('THEN'), else: stmts('ELSE') });
    case 'csp_repeat': return mk({ kind: 'repeat', count: e('COUNT', 'how many times'), body: stmts('BODY') });
    case 'csp_until': return mk({ kind: 'until', cond: e('COND', 'the condition'), body: stmts('BODY') });
    case 'csp_foreach': return mk({ kind: 'foreach', item: name(b, 'ITEM', 'variable'), list: e('LIST', 'the list'), body: stmts('BODY') });
    case 'csp_proc': {
      const params = String(b.fields?.PARAMS ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      for (const p of params) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p) || KEYWORDS.has(p)) throw new BlockError(`"${p}" isn't a valid parameter name.`, b.id);
      }
      if (new Set(params).size !== params.length) throw new BlockError('A parameter name appears twice.', b.id);
      return mk({ kind: 'proc', name: name(b, 'NAME', 'procedure'), params, body: stmts('BODY') });
    }
    case 'csp_return': return mk({ kind: 'return', value: child(b.inputs?.VALUE) ? e('VALUE', 'the value') : null });
    case 'csp_display': return call('DISPLAY', [e('VALUE', 'what to display')]);
    case 'csp_append': return call('APPEND', [e('LIST', 'the list'), e('VALUE', 'the value')]);
    case 'csp_insert': return call('INSERT', [e('LIST', 'the list'), e('INDEX', 'the index'), e('VALUE', 'the value')]);
    case 'csp_remove': return call('REMOVE', [e('LIST', 'the list'), e('INDEX', 'the index')]);
    case 'csp_move': return call('MOVE_FORWARD', []);
    case 'csp_left': return call('ROTATE_LEFT', []);
    case 'csp_right': return call('ROTATE_RIGHT', []);
    case 'csp_call': return call(name(b, 'NAME', 'procedure'), args(b));
  }
  throw new BlockError(`A value block can't be used as a statement.`, b.id);
}

function args(b: BlockJson): Expr[] {
  const n = b.extraState?.n ?? 0;
  return Array.from({ length: n }, (_, i) => exprIn(b, `ARG${i}`, `item ${i + 1}`));
}

function exprIn(parent: BlockJson, input: string, what: string): Expr {
  const b = child(parent.inputs?.[input]);
  if (!b) throw new BlockError(`This block has an empty slot (${what}). Fill it in to update the code.`, parent.id);
  return exprFrom(b);
}

function exprFrom(b: BlockJson): Expr {
  const e = (input: string, what: string) => exprIn(b, input, what);
  const f = b.fields ?? {};
  switch (b.type) {
    case 'csp_num': {
      const n = Number(f.NUM);
      return { kind: 'num', value: Number.isFinite(n) ? n : 0, span: S };
    }
    case 'csp_str': {
      const t = String(f.TEXT ?? '');
      if (/["\n]/.test(t)) throw new BlockError('Text can\'t contain a " mark.', b.id);
      return { kind: 'str', value: t, span: S };
    }
    case 'csp_bool': return { kind: 'bool', value: f.BOOL === 'TRUE', span: S };
    case 'csp_var': return { kind: 'var', name: name(b, 'VAR', 'variable'), span: S };
    case 'csp_list': return { kind: 'list', items: args(b), span: S };
    case 'csp_index': return { kind: 'index', list: e('LIST', 'the list'), index: e('INDEX', 'the index'), span: S };
    case 'csp_arith': case 'csp_compare': case 'csp_logic':
      return { kind: 'bin', op: String(f.OP) as BinOp, left: e('A', 'left side'), right: e('B', 'right side'), span: S };
    case 'csp_not': return { kind: 'un', op: 'NOT', operand: e('A', 'the condition'), span: S };
    case 'csp_neg': return { kind: 'un', op: '-', operand: e('A', 'the value'), span: S };
    case 'csp_input': return callE('INPUT', []);
    case 'csp_random': return callE('RANDOM', [e('A', 'the low number'), e('B', 'the high number')]);
    case 'csp_length': return callE('LENGTH', [e('LIST', 'the list')]);
    case 'csp_can_move': return callE('CAN_MOVE', [{ kind: 'var', name: String(f.DIR), span: S }]);
    case 'csp_call_value': return callE(name(b, 'NAME', 'procedure'), args(b));
  }
  throw new BlockError('A statement block can\'t be used as a value.', b.id);
}

function callE(n: string, args: Expr[]): Expr {
  return { kind: 'call', name: n, args, span: S, nameSpan: S };
}
