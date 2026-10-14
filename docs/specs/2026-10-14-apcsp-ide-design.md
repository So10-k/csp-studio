# AP CSP Pseudocode Compiler & Visual IDE — design

A standalone web app (Vite + TypeScript) that compiles and runs the College Board **AP Computer Science Principles Exam Reference Sheet** language, with a text editor, a drag-and-drop block editor that mirrors the reference sheet's block form, a step-through debugger and an animated robot grid.

## Goals

- Run any program written with the reference sheet exactly as the exam defines it (1-based lists, copy-on-assign lists, out-of-range index terminates, robot terminates on a blocked move).
- Make execution visible: current statement highlighted in text *and* blocks, variables/lists inspector, call stack, console.
- Two equal ways to write code — text or blocks — kept in sync through one AST.
- Never freeze the tab, even on an infinite loop.

Non-goals: accounts, sharing/servers, a language beyond the reference sheet (except the small, clearly-marked extensions below).

## Language

| Construct | Text form | Notes |
|---|---|---|
| Assignment | `a ← expr` (also `<-`) | Assigning a list stores a **copy** (`aList ← bList`). |
| Display | `DISPLAY(expr)` | Prints the value followed by a space (exam-faithful). An IDE toggle prints one value per line instead. |
| Input | `INPUT()` | Pauses for console input. Numeric text becomes a number, `true`/`false` booleans, else a string. |
| Arithmetic | `+ - * / MOD`, unary `-` | `/` is real division; divide/MOD by zero is a runtime error. MOD is floored (result has the divisor's sign). |
| Random | `RANDOM(a, b)` | Integer in `[a, b]` inclusive. |
| Relational | `= ≠ > < ≥ ≤` (also `!= >= <=`) | `=`/`≠` compare any values (lists by contents); ordering compares two numbers or two strings. |
| Boolean | `NOT`, `AND`, `OR` | `AND`/`OR` short-circuit. Operands must be booleans. |
| Selection | `IF (c) { … }` / `IF (c) { … } ELSE { … }` | `ELSE IF` works naturally as `ELSE { IF … }` and is also accepted as `ELSE IF (c) { … }`. |
| Iteration | `REPEAT n TIMES { … }`, `REPEAT UNTIL (c) { … }` | `n` evaluated once; must be a non-negative integer. |
| Lists | `[a, b]`, `[]`, `aList[i]`, `aList[i] ← x` | 1-based. Index < 1 or > LENGTH → error, program terminates. |
| List procedures | `INSERT(l, i, v)`, `APPEND(l, v)`, `REMOVE(l, i)`, `LENGTH(l)` | INSERT accepts `i` from 1 to LENGTH+1. |
| Traversal | `FOR EACH item IN aList { … }` | `item` is a copy of each element; the list's length is re-checked each iteration. |
| Procedures | `PROCEDURE name(p1, p2) { … }`, `name(a, b)`, `RETURN(expr)` | Procedures may be defined anywhere and called before their definition. Lists are passed by reference. `RETURN` without a value (`RETURN()`) is allowed. Using a call that returned nothing as a value is a runtime error. |
| Robot | `MOVE_FORWARD()`, `ROTATE_LEFT()`, `ROTATE_RIGHT()`, `CAN_MOVE(dir)` | `dir` is `left`, `right`, `forward` or `backward` (bare word or string). Moving into a wall/edge terminates the program. |

Literals: numbers (`3`, `2.5`), strings (`"hi"`), `true`/`false` (any case), lists.

**Scoping** (the sheet doesn't say; we choose the common CSP-course rule): the main program has one global scope. Each procedure call gets a local scope holding its parameters. Reading a name checks local then global. Assigning a name writes to the local if it exists, else the global if it exists, else creates a local.

**Extensions** (marked as such in the docs/UI): `//` line comments; `+` concatenates when either side is a string; ASCII operator forms.

Keywords are upper-case and reserved; identifiers are case-sensitive letters/digits/underscore.

## Architecture

```
src/lang/          pure, no DOM — fully unit-tested
  lexer.ts         source → tokens (with line/col/offset spans)
  ast.ts           node types; every statement carries a span and a stable id
  parser.ts        recursive descent → Program AST, collects multiple errors
  printer.ts       AST → canonical text (used by blocks → text)
  compiler.ts      AST → Chunk { code: Instr[], procs, spans } (stack bytecode)
  disasm.ts        Chunk → readable listing (the "Bytecode" tab)
  values.ts        runtime values, equality, display formatting, copy
  vm.ts            stack VM: run(budget) / step modes, breakpoints, input, host hooks
  robot.ts         grid world model (walls, robot pos/dir, goal), pure
  errors.ts        CompileError / RuntimeError with spans and friendly messages
src/ide/
  main.ts          layout + wiring
  editor.ts        CodeMirror 6: highlighting, diagnostics, breakpoint gutter, current-line decoration, symbol bar (← ≠ ≤ ≥)
  blocks/          Blockly: defs.ts (block shapes in reference-sheet style), theme.ts, toBlocks.ts (AST → workspace JSON), fromBlocks.ts (workspace → AST)
  runner.ts        drives the VM: run / pause / step / step over / step out / stop, speed slider, time-sliced on rAF
  inspector.ts     variables, lists (as indexed cells), call stack; flashes changed values
  consoleView.ts   output + INPUT prompt
  robotView.ts     canvas grid, animated robot, click cells to toggle walls/goal, presets
  examples.ts      sample programs (incl. robot mazes, list algorithms, recursion)
  storage.ts       localStorage persistence of code, view, world, options
```

### Compiler & VM

Stack bytecode. Representative instructions: `CONST k`, `LOAD name`, `STORE name`, `LIST n`, `INDEX`, `STORE_INDEX name`, `BIN op`, `NEG`, `NOT`, `JMP t`, `JF t` (jump if false; type-checks boolean), `JT t`, `CALL name argc`, `BUILTIN name argc`, `RET`, `RETV`, `POP`, `DISPLAY`, `INPUT`, `STMT id` (statement boundary, carries the source span), hidden-counter ops for `REPEAT n TIMES` / `FOR EACH`. Every instruction maps to a span.

VM state: value stack, frames (proc, pc, locals), globals, status `ready | running | paused | input | done | error`. `vm.run(budget)` executes up to `budget` instructions and stops early at a breakpoint `STMT`, at `INPUT`, at end, or on error. Step modes stop at the next `STMT` (into), the next `STMT` at depth ≤ current (over), or depth < current (out). Host hooks (`display`, `robot`) let the IDE observe effects; the VM itself never touches the DOM.

### Text ↔ blocks sync

The AST is the source of truth. Text edits → parse (debounced) → if no errors, rebuild the block workspace (statement ids become block ids, so highlights map). Block edits → AST → printer → replace editor text. If the text has syntax errors, the blocks pane shows a "fix the text error to update blocks" banner and keeps its last good state. Top-level stacks are ordered by vertical position when converting to text.

Block shapes follow the reference sheet: statement blocks with keyword labels (`IF`, `ELSE`, `REPEAT n TIMES`, `REPEAT UNTIL`, `FOR EACH item IN`, `PROCEDURE name (params)`), expression blocks with rounded edges; variable-arity blocks (list literal, procedure call) use an item-count field.

### Runner / speed

Speed slider: slow speeds execute one statement per tick with highlight + inspector updates; "max" runs ~50k instructions per animation frame with updates throttled. Stop is always responsive.

## Errors

- Compile errors: line/col, underlined in the editor, listed under the editor ("Line 4: expected `{` after `REPEAT 3 TIMES`"). Running is blocked until fixed.
- Runtime errors: stop the program, highlight the statement in red, console message in exam language ("List index 5 is out of range — the list has 3 items. The program terminates.").

## Testing

Vitest, pure modules only: lexer, parser (incl. error recovery and messages), printer round-trip (`parse(print(ast)) ≡ ast`), compiler + VM end-to-end over a table of programs covering every row of the language table and every error case, step/breakpoint semantics, robot rules, and AST → blocks JSON → AST round-trip. The IDE is verified in the browser preview.
