import type { Compiled, Fn, Instr } from './compiler';
import { RuntimeError, type Span } from './errors';
import type { Robot } from './robot';
import { copy, equal, formatNumber, isList, NoValue, show, typeName, type Slot, type Value } from './values';

export type Status = 'ready' | 'running' | 'paused' | 'input' | 'done' | 'error';
export type StepMode = 'run' | 'into' | 'over' | 'out';

export interface Host {
  /** DISPLAY(x): the formatted value. */
  display(text: string): void;
  robot?: Robot;
  random?: () => number;
}

export interface Frame {
  fn: Fn;
  pc: number;
  locals: Map<string, Value>;
  /** the statement this frame is running (for the call stack view) */
  stmt: Span | null;
}

export const MAX_DEPTH = 5000;

export class VM {
  status: Status = 'ready';
  readonly globals = new Map<string, Value>();
  readonly frames: Frame[] = [];
  private stack: Slot[] = [];
  /** the statement about to run (when paused) or running */
  current: Extract<Instr, { op: 'STMT' }> | null = null;
  error: RuntimeError | null = null;
  breakpoints = new Set<number>();
  /** total instructions executed */
  steps = 0;

  constructor(public prog: Compiled, public host: Host) {
    this.frames.push({ fn: prog.main, pc: 0, locals: this.globals, stmt: null });
  }

  get done() { return this.status === 'done' || this.status === 'error'; }

  /** Give INPUT() its value (status must be 'input'). */
  provideInput(v: Value) {
    if (this.status !== 'input') throw new Error('not waiting for input');
    this.stack.push(v);
    this.status = 'paused';
  }

  /** Visible variables for the inspector: [scope name, entries] (hidden loop counters left out). */
  scopes(): { name: string; vars: [string, Value][] }[] {
    const visible = (m: Map<string, Value>) => [...m].filter(([k]) => !k.startsWith('#'));
    const out = [{ name: 'Global', vars: visible(this.globals) }];
    const top = this.frames[this.frames.length - 1];
    if (this.frames.length > 1) out.unshift({ name: `${top.fn.name} (local)`, vars: visible(top.locals) });
    return out;
  }

  /**
   * Execute up to `budget` instructions. Stops early at a statement boundary that satisfies `mode`
   * (or a breakpoint), when waiting for INPUT, at the end, or on an error. Returns the new status.
   */
  run(budget: number, mode: StepMode = 'run'): Status {
    if (this.done || this.status === 'input') return this.status;
    // Resuming from a pause skips the check on the statement we're paused at; a fresh start doesn't.
    let first = this.status !== 'ready';
    this.status = 'running';
    const startDepth = this.frames.length;
    try {
      while (budget-- > 0) {
        const f = this.frames[this.frames.length - 1];
        const ins = f.fn.code[f.pc];
        if (!ins) {
          // fell off the end of the main program
          this.status = 'done';
          this.current = null;
          return this.status;
        }
        if (ins.op === 'STMT' && !first) {
          const depth = this.frames.length;
          const stop =
            mode === 'into' ||
            (mode === 'over' && depth <= startDepth) ||
            (mode === 'out' && depth < startDepth) ||
            this.breakpoints.has(ins.span.line);
          if (stop) {
            this.current = ins;
            f.stmt = ins.span;
            this.status = 'paused';
            return this.status;
          }
        }
        first = false;
        f.pc++;
        this.steps++;
        this.exec(ins, f);
        if (this.status !== 'running') return this.status;
      }
      this.status = 'paused';
      return this.status;
    } catch (e) {
      const f = this.frames[this.frames.length - 1];
      const ins = f.fn.code[f.pc - 1];
      if (e instanceof RuntimeError) {
        if (!e.span.line && ins) e.span = ins.span;
        this.error = e;
      } else {
        this.error = new RuntimeError(String((e as Error)?.message ?? e), ins?.span);
      }
      this.status = 'error';
      return this.status;
    }
  }

  // ── execution ──────────────────────────────────────────────
  private pop(): Value {
    const v = this.stack.pop()!;
    if (v instanceof NoValue) throw new RuntimeError(`${v.from} doesn't RETURN a value, so its result can't be used.`);
    return v;
  }

  private lookup(name: string, f: Frame): Value {
    const v = f.locals.get(name) ?? this.globals.get(name);
    if (v === undefined) throw new RuntimeError(`The variable ${name} hasn't been given a value yet.`);
    return v;
  }

  private store(name: string, v: Value, f: Frame) {
    if (f.locals !== this.globals && !f.locals.has(name) && this.globals.has(name)) this.globals.set(name, v);
    else f.locals.set(name, v);
  }

  private exec(ins: Instr, f: Frame) {
    switch (ins.op) {
      case 'STMT':
        this.current = ins;
        f.stmt = ins.span;
        break;
      case 'CONST': this.stack.push(ins.v); break;
      case 'LOAD': this.stack.push(this.lookup(ins.name, f)); break;
      case 'STORE': this.store(ins.name, copy(this.pop()), f); break;
      case 'STORE_REF': f.locals.set(ins.name, this.pop()); break;
      case 'LIST': {
        const items: Value[] = [];
        for (let k = 0; k < ins.n; k++) items.unshift(this.pop());
        this.stack.push(items);
        break;
      }
      case 'INDEX': {
        const i = this.pop(), list = this.pop();
        this.stack.push(list2(list, 'Only a list can be indexed with [ ].')[checkIndex(list as Value[], i) - 1]);
        break;
      }
      case 'STORE_INDEX': {
        const v = this.pop(), i = this.pop(), list = list2(this.pop(), 'Only a list element can be assigned with [ ].');
        list[checkIndex(list, i) - 1] = copy(v);
        break;
      }
      case 'BIN': {
        const b = this.pop(), a = this.pop();
        this.stack.push(binary(ins.bin, a, b));
        break;
      }
      case 'NEG': this.stack.push(-num(this.pop(), 'The - sign')); break;
      case 'NOT': this.stack.push(!bool(this.pop(), 'NOT')); break;
      case 'JMP': f.pc = ins.to; break;
      case 'JF': if (!bool(this.pop(), 'A condition')) f.pc = ins.to; break;
      case 'AND_JMP': case 'OR_JMP': {
        const v = this.pop();
        bool(v, ins.op === 'AND_JMP' ? 'AND' : 'OR');
        if (v === (ins.op === 'OR_JMP')) { this.stack.push(v); f.pc = ins.to; }
        break;
      }
      case 'CHECK_BOOL': { const v = this.pop(); bool(v, ins.what); this.stack.push(v); break; }
      case 'CHECK_LIST': { const v = this.pop(); list2(v, 'FOR EACH needs a list to go through.'); this.stack.push(v); break; }
      case 'POP': this.stack.pop(); break;
      case 'CALL': {
        if (this.frames.length >= MAX_DEPTH) {
          throw new RuntimeError(`Too many procedure calls inside each other (over ${MAX_DEPTH}). Is there a recursion that never stops?`);
        }
        const fn = this.prog.procs.get(ins.name)!;
        const locals = new Map<string, Value>();
        for (let k = fn.params.length - 1; k >= 0; k--) locals.set(fn.params[k], this.pop()); // lists by reference
        this.frames.push({ fn, pc: 0, locals, stmt: null });
        break;
      }
      case 'RET': case 'RETV': {
        const v: Slot = ins.op === 'RETV' ? this.pop() : new NoValue(f.fn.name);
        this.frames.pop();
        this.stack.push(v);
        break;
      }
      case 'COUNT_INIT': {
        const n = this.pop();
        if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
          throw new RuntimeError(`REPEAT … TIMES needs a whole number that isn't negative, but got ${show(n)}.`);
        }
        f.locals.set(ins.name, n);
        break;
      }
      case 'COUNT_DOWN': {
        const n = f.locals.get(ins.name) as number;
        if (n <= 0) f.pc = ins.to;
        else f.locals.set(ins.name, n - 1);
        break;
      }
      case 'EACH_NEXT': {
        const list = f.locals.get(ins.list) as Value[];
        const i = (f.locals.get(ins.idx) as number) + 1;
        if (i > list.length) { f.pc = ins.to; break; }
        f.locals.set(ins.idx, i);
        this.store(ins.item, copy(list[i - 1]), f);
        break;
      }
      case 'BUILTIN': this.builtin(ins.name, ins.argc); break;
    }
  }

  private builtin(name: string, argc: number) {
    const args: Value[] = [];
    for (let k = 0; k < argc; k++) args.unshift(this.pop());
    const none = new NoValue(name);
    const robot = () => {
      if (!this.host.robot) throw new RuntimeError('There is no robot grid for this program.');
      return this.host.robot;
    };
    switch (name) {
      case 'DISPLAY': this.host.display(show(args[0])); this.stack.push(none); break;
      case 'INPUT': this.status = 'input'; break; // the value arrives through provideInput()
      case 'RANDOM': {
        const a = int(args[0], 'RANDOM'), b = int(args[1], 'RANDOM');
        if (a > b) throw new RuntimeError(`RANDOM(${a}, ${b}): the first number can't be bigger than the second.`);
        this.stack.push(a + Math.floor((this.host.random ?? Math.random)() * (b - a + 1)));
        break;
      }
      case 'LENGTH': this.stack.push(list2(args[0], 'LENGTH needs a list.').length); break;
      case 'APPEND': list2(args[0], 'APPEND needs a list first.').push(copy(args[1])); this.stack.push(none); break;
      case 'INSERT': {
        const list = list2(args[0], 'INSERT needs a list first.');
        const i = int(args[1], 'INSERT');
        if (i < 1 || i > list.length + 1) {
          throw new RuntimeError(`INSERT position ${i} is out of range: the list has ${list.length} item${list.length === 1 ? '' : 's'}, so the position must be 1 to ${list.length + 1}. The program terminates.`);
        }
        list.splice(i - 1, 0, copy(args[2]));
        this.stack.push(none);
        break;
      }
      case 'REMOVE': {
        const list = list2(args[0], 'REMOVE needs a list first.');
        list.splice(checkIndex(list, args[1]) - 1, 1);
        this.stack.push(none);
        break;
      }
      case 'MOVE_FORWARD': robot().moveForward(); this.stack.push(none); break;
      case 'ROTATE_LEFT': robot().rotate(-1); this.stack.push(none); break;
      case 'ROTATE_RIGHT': robot().rotate(1); this.stack.push(none); break;
      case 'CAN_MOVE': this.stack.push(robot().canMove(String(args[0]))); break;
      default: throw new RuntimeError(`Unknown built-in ${name}.`);
    }
  }
}

// ── helpers ────────────────────────────────────────────────────
function num(v: Value, who: string): number {
  if (typeof v !== 'number') throw new RuntimeError(`${who} needs a number, but got ${typeName(v)} (${show(v)}).`);
  return v;
}
function int(v: Value, who: string): number {
  const n = num(v, who);
  if (!Number.isInteger(n)) throw new RuntimeError(`${who} needs whole numbers, but got ${formatNumber(n)}.`);
  return n;
}
function bool(v: Value, who: string): boolean {
  if (typeof v !== 'boolean') throw new RuntimeError(`${who} needs true or false, but got ${typeName(v)} (${show(v)}).`);
  return v;
}
function list2(v: Value, msg: string): Value[] {
  if (!isList(v)) throw new RuntimeError(`${msg} Got ${typeName(v)} instead.`);
  return v;
}
function checkIndex(list: Value[], i: Value): number {
  if (typeof i !== 'number' || !Number.isInteger(i)) {
    throw new RuntimeError(`A list index must be a whole number, but got ${show(i)}.`);
  }
  if (i < 1 || i > list.length) {
    throw new RuntimeError(
      list.length === 0
        ? `List index ${i} is out of range: the list is empty. The program terminates.`
        : `List index ${i} is out of range: the list has ${list.length} item${list.length === 1 ? '' : 's'}, so indexes go from 1 to ${list.length}. The program terminates.`,
    );
  }
  return i;
}

function binary(op: string, a: Value, b: Value): Value {
  switch (op) {
    case '=': return equal(a, b);
    case '≠': return !equal(a, b);
    case '+':
      // extension: + joins text when either side is text
      if (typeof a === 'string' || typeof b === 'string') {
        if (isList(a) || isList(b)) throw new RuntimeError("+ can't join text and a list.");
        return show(a) + show(b);
      }
      return num(a, '+') + num(b, '+');
    case '-': return num(a, '-') - num(b, '-');
    case '*': return num(a, '*') * num(b, '*');
    case '/': {
      const d = num(b, '/');
      if (d === 0) throw new RuntimeError("You can't divide by zero.");
      return num(a, '/') / d;
    }
    case 'MOD': {
      const d = num(b, 'MOD');
      if (d === 0) throw new RuntimeError("MOD by zero isn't defined.");
      const n = num(a, 'MOD');
      return ((n % d) + d) % d;
    }
    case '<': case '>': case '≤': case '≥': {
      if (!((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string'))) {
        throw new RuntimeError(`${op} compares two numbers (or two pieces of text), but got ${typeName(a)} and ${typeName(b)}.`);
      }
      return op === '<' ? a < b : op === '>' ? a > b : op === '≤' ? a <= b : a >= b;
    }
  }
  throw new RuntimeError(`Unknown operator ${op}.`);
}
