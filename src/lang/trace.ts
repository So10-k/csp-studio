import type { Stmt } from './ast';
import type { Compiled } from './compiler';
import { Robot, type World } from './robot';
import { parseInput, showInList, type Value } from './values';
import { VM, type Host } from './vm';

/** One executed statement, with what it changed. */
export interface TraceRow {
  step: number;
  line: number;
  kind: Stmt['kind'];
  depth: number;
  scope: string;
  /** column key → value after the statement (only the ones it changed) */
  changes: Record<string, string>;
  /** IF / REPEAT UNTIL: the condition's value */
  cond?: boolean;
  output: string[];
  input: string[];
}

export interface TraceColumn {
  key: string;
  name: string;
  /** procedure name for locals, null for globals */
  scope: string | null;
}

/**
 * Records a trace table while a VM runs: hook it in with `tracer.host(base)`, set `tracer.vm`,
 * and call `finish()` when the program ends.
 */
export class Tracer {
  rows: TraceRow[] = [];
  columns: TraceColumn[] = [];
  /** how many times each line ran */
  lineCounts = new Map<number, number>();
  /** the values each line set the last time it ran */
  lineValues = new Map<number, Record<string, string>>();
  lineConds = new Map<number, boolean>();
  truncated = false;
  statements = 0;
  vm: VM | null = null;
  private prev = new Map<string, string>();
  private open: TraceRow | null = null;
  private byDepth: (TraceRow | null)[] = [];
  private known = new Set<string>();

  constructor(public maxRows = 2000) {}

  host(base: Host): Host {
    return {
      ...base,
      display: (text) => { this.rowHere()?.output.push(text); base.display(text); },
      onStmt: (ins) => {
        this.close();
        this.statements++;
        this.lineCounts.set(ins.span.line, (this.lineCounts.get(ins.span.line) ?? 0) + 1);
        const depth = this.vm?.frames.length ?? 1;
        if (this.rows.length >= this.maxRows) {
          this.truncated = this.maxRows > 0;
          this.open = null;
          this.byDepth[depth] = null;
          return;
        }
        const scope = this.vm?.frames[depth - 1].fn.name ?? '';
        this.open = { step: this.rows.length + 1, line: ins.span.line, kind: ins.kind, depth, scope, changes: {}, output: [], input: [] };
        this.rows.push(this.open);
        this.byDepth[depth] = this.open;
        this.byDepth.length = depth + 1;
      },
      onCondition: (v) => {
        const row = this.rowHere();
        if (!row || (row.kind !== 'if' && row.kind !== 'until')) return;
        row.cond = row.kind === 'until' ? !v : v;
        this.lineConds.set(row.line, row.cond);
      },
      onReturn: () => {
        // changes made by the procedure belong to its last statement; anything after the
        // return (like storing the result) belongs to the caller's statement
        this.close();
        this.open = this.rowHere();
      },
      onInput: (v) => { this.rowHere()?.input.push(showInList(v)); },
    };
  }

  private rowHere(): TraceRow | null {
    return this.byDepth[this.vm?.frames.length ?? 1] ?? null;
  }

  private snapshot(): Map<string, string> {
    const out = new Map<string, string>();
    const vm = this.vm;
    if (!vm) return out;
    for (const [k, v] of vm.globals) if (!k.startsWith('#')) out.set(k, showInList(v));
    if (vm.frames.length > 1) {
      const top = vm.frames[vm.frames.length - 1];
      for (const [k, v] of top.locals) {
        if (k.startsWith('#')) continue;
        const key = `${k}·${top.fn.name}`;
        out.set(key, showInList(v));
        if (!this.known.has(key)) { this.known.add(key); this.columns.push({ key, name: k, scope: top.fn.name }); }
      }
    }
    for (const k of vm.globals.keys()) {
      if (!k.startsWith('#') && !this.known.has(k)) { this.known.add(k); this.columns.push({ key: k, name: k, scope: null }); }
    }
    return out;
  }

  private close() {
    if (!this.vm) return;
    if (!this.open && this.truncated) {
      // past the row limit: still keep per-line values up to date
      return;
    }
    const snap = this.snapshot();
    if (this.open) {
      const changes: Record<string, string> = {};
      for (const [k, v] of snap) if (this.prev.get(k) !== v) changes[k] = v;
      if (Object.keys(changes).length) {
        Object.assign(this.open.changes, changes);
        this.lineValues.set(this.open.line, { ...(this.lineValues.get(this.open.line) ?? {}), ...changes });
      }
    }
    this.prev = snap;
    this.open = null;
  }

  finish() {
    this.close();
  }
}

export interface RunResult {
  tracer: Tracer;
  output: string[];
  error: { message: string; line: number } | null;
  /** the program wanted more INPUT values than were given */
  needsInput: boolean;
  robot: Robot | null;
}

/** Run a whole program at once (no UI), recording a trace. */
export function traceRun(
  c: Compiled,
  opts: { inputs?: (string | Value)[]; world?: World | null; random?: () => number; maxRows?: number; maxInstructions?: number } = {},
): RunResult {
  const output: string[] = [];
  const tracer = new Tracer(opts.maxRows ?? 2000);
  const robot = opts.world ? new Robot(structuredClone(opts.world)) : null;
  const vm = new VM(c, tracer.host({ display: (t) => output.push(t), robot: robot ?? undefined, random: opts.random }));
  tracer.vm = vm;
  const inputs = [...(opts.inputs ?? [])];
  const limit = opts.maxInstructions ?? 2_000_000;
  let needsInput = false;
  let error: RunResult['error'] = null;
  while (!vm.done) {
    vm.run(50_000);
    if (vm.status === 'input') {
      if (!inputs.length) { needsInput = true; break; }
      const next = inputs.shift()!;
      vm.provideInput(typeof next === 'string' ? parseInput(next) : next);
    }
    if (!vm.done && vm.steps >= limit) {
      error = { message: `Stopped after ${limit.toLocaleString()} instructions. Is there a loop that never ends?`, line: vm.current?.span.line ?? 0 };
      break;
    }
  }
  tracer.finish();
  if (vm.error) error = { message: vm.error.message, line: vm.error.span.line };
  if (needsInput) error = { message: 'The program asked for more INPUT() values than were given.', line: vm.current?.span.line ?? 0 };
  return { tracer, output, error, needsInput, robot };
}
