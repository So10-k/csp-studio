import type { Compiled, Fn, Instr } from './compiler';
import { showInList } from './values';

function operand(i: Instr): string {
  switch (i.op) {
    case 'CONST': return showInList(i.v);
    case 'LOAD': case 'STORE': case 'STORE_REF': case 'COUNT_INIT': return i.name;
    case 'LIST': return String(i.n);
    case 'BIN': return i.bin;
    case 'JMP': case 'JF': case 'AND_JMP': case 'OR_JMP': return `→ ${i.to}`;
    case 'COUNT_DOWN': return `${i.name} → ${i.to}`;
    case 'EACH_NEXT': return `${i.item} ← ${i.list}[${i.idx}] → ${i.to}`;
    case 'CALL': case 'BUILTIN': return `${i.name} (${i.argc})`;
    case 'STMT': return `line ${i.span.line} · ${i.kind}`;
    case 'CHECK_BOOL': return i.what;
    default: return '';
  }
}

export interface DisasmLine { fn: string; pc: number; op: string; arg: string; line: number }

export function disasmFn(fn: Fn): DisasmLine[] {
  return fn.code.map((ins, pc) => ({ fn: fn.name, pc, op: ins.op, arg: operand(ins), line: ins.span.line }));
}

/** Readable bytecode listing (the IDE's "Bytecode" tab). */
export function disasm(c: Compiled): string {
  const parts = [c.main, ...c.procs.values()].map((fn) => {
    const head = fn === c.main ? '== main program ==' : `== PROCEDURE ${fn.name}(${fn.params.join(', ')}) ==`;
    return [head, ...disasmFn(fn).map((l) => `${String(l.pc).padStart(4)}  ${l.op.padEnd(12)}${l.arg}`)].join('\n');
  });
  return parts.join('\n\n');
}
