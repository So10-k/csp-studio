# CSP Studio

A compiler and visual IDE for the **College Board AP Computer Science Principles exam reference sheet** pseudocode.

- **Compiler + VM** (`src/lang/`): lexer → parser → AST → stack bytecode → virtual machine. 1-based lists, list copies on assignment, out-of-range indexes and blocked robot moves terminate the program (as on the exam). Friendly compile/runtime errors with line numbers.
- **IDE** (`src/ide/`): CodeMirror text editor + Blockly drag-and-drop blocks (kept in sync), step / step over / step out, breakpoints (click a line number), variables & list inspector, call stack, bytecode view, console with `INPUT()`, animated robot grid with an editor, examples, the reference sheet.
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
