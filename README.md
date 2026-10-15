# CSP Studio

A compiler and visual IDE for the **College Board AP Computer Science Principles exam reference sheet** pseudocode.

- **Compiler + VM** (`src/lang/`): lexer → parser → AST → stack bytecode → virtual machine. 1-based lists, list copies on assignment, out-of-range indexes and blocked robot moves terminate the program (as on the exam). Friendly compile/runtime errors with line numbers.
- **IDE** (`src/ide/`): CodeMirror text editor + Blockly drag-and-drop blocks (kept in sync), step / step over / step out, breakpoints (click a line number), variables & list inspector, call stack, bytecode view, console with `INPUT()`, animated robot grid with an editor, examples, the reference sheet.
- **Teaching tools**: values shown at the end of each line (with run counts and condition results), a trace table of every statement (copyable), a trace-table **practice mode** that hides the values for students to fill in and check, and a Runs tab (test runs with INPUT values and expected output, plus "run it N times" frequency tables for RANDOM).
- **Tracing mode** (the Tracing button): AP-exam-style code tracing practice in 7 levels (Basic, Easy, Medium, Hard, Extra Hard, Advanced, Challenging). Questions are generated from templates (`src/tracing/levels.ts`), the answer key comes from running the code, and wrong choices come from running "misconception" versions of the program (`src/tracing/mutate.ts`), so feedback can say which mistake leads to a wrong answer. Sets of 10 with a trace-table scratchpad, hints on the early levels, typed answers on the later ones, a worked solution trace, per-level stats and stars. Fair play: the editor is hidden, the code can't be copied, leaving the page is noted, quitting or reloading mid-question counts it as missed, and "run it for me" is allowed but marks the question missed.
- **Saving**: every program autosaves in the browser (Your programs menu: new, duplicate, rename, open a file, download), plus share links that carry the program inside the URL.

```bash
npm install
npm run dev     # http://localhost:5190
npm run check   # typecheck + tests + production build
```

Design: `docs/specs/2026-10-14-apcsp-ide-design.md`.

## Deploy

Live at https://agreeable-plant-081b4060f.5.azurestaticapps.net (Azure Static Web App `swa-cspstudio`, resource group `rg-cspstudio`, Free tier).

```bash
npm run deploy   # check + build, then upload ./dist with the SWA CLI (needs `az login`)
```
