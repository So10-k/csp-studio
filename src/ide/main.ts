import './style.css';
import { usesRobot, walkStmts, type Program } from '../lang/ast';
import { compile, type Compiled } from '../lang/compiler';
import { disasmFn } from '../lang/disasm';
import { CompileError } from '../lang/errors';
import { parse } from '../lang/parser';
import { printProgram } from '../lang/printer';
import { Robot, type World } from '../lang/robot';
import { parseInput } from '../lang/values';
import { VM, type StepMode } from '../lang/vm';
import { BlocksPane } from './blocks/pane';
import { ConsoleView } from './consoleView';
import { createEditor } from './editor';
import { EXAMPLES, WORLDS } from './examples';
import { Inspector } from './inspector';
import { REFERENCE_HTML } from './reference';
import { RobotView } from './robotView';
import { decodeShare, encodeShare } from './share';
import { defaultWorld, files, makeFile, type FileDoc } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ── state ──────────────────────────────────────────────────────
type View = 'text' | 'blocks' | 'split';
const prefs = files.prefs();
let view: View = prefs.view;
let program: Program | null = null;
let compiled: Compiled | null = null;
let vm: VM | null = null;
let robot: Robot | null = null;
let running = false;
let runMode: StepMode = 'run';
let stepDepth = 0;
let timer = 0;
let lastRender = 0;
let blocksStale = true;
/** statement id in the current text → block id (they differ after an edit made in the blocks view) */
let blockIdFor = new Map<string, string>();

// ── widgets ────────────────────────────────────────────────────
const con = new ConsoleView($('console'));
con.newlines = prefs.newlines;
$<HTMLInputElement>('newlines').checked = prefs.newlines;
const inspector = new Inspector($('vars'), $('stack'));
inspector.clear();
const robotView = new RobotView(structuredClone(files.current().world), (w) => {
  files.update({ world: w });
  if (vm) stop(true);
});
$('robot').append(robotView.el);

const editor = createEditor($('text'), files.current().code, {
  change(text) {
    files.update({ code: text });
    if (vm) stop(true);
    clearTimeout(textTimer);
    textTimer = window.setTimeout(() => analyze(text, 'text'), 200);
  },
  breakpoints(lines) {
    files.update({ breakpoints: [...lines] });
    if (vm) vm.breakpoints = lines;
  },
});
let textTimer = 0;
editor.setBreakpoints(files.current().breakpoints);

const blocks = new BlocksPane($('blocks'), {
  program(p) {
    const text = printProgram(p);
    if (text === editor.getText()) return;
    if (vm) stop(true);
    editor.setText(text);
    files.update({ code: text });
    // map the reprinted statements back to the blocks they came from
    blockIdFor = new Map();
    analyze(text, 'blocks');
    if (program) {
      const fromText: string[] = [], fromBlocks: string[] = [];
      walkStmts(program.body, (s) => fromText.push(s.id));
      walkStmts(p.body, (s) => fromBlocks.push(s.id));
      fromText.forEach((id, i) => blockIdFor.set(id, fromBlocks[i]));
    }
  },
  problem(msg) {
    const b = $('blocksBanner');
    b.hidden = !msg;
    b.textContent = msg ? `⚠ ${msg}` : '';
  },
});

// ── compile as you type ────────────────────────────────────────
function analyze(text: string, from: 'text' | 'blocks') {
  try {
    const p = parse(text);
    program = p;
    compiled = compile(p);
    editor.setError(null);
    showProblem(null);
    if (from === 'text') {
      blocksStale = true;
      if (view !== 'text') syncBlocks();
    }
  } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    compiled = null;
    editor.setError(e);
    showProblem(`Line ${e.span.line}: ${e.message}`);
    if (from === 'text') {
      try { program = parse(text); } catch { program = null; }
      if (!program) {
        const b = $('blocksBanner');
        b.hidden = false;
        b.textContent = '⚠ Fix the error in the text to update the blocks.';
      } else if (view !== 'text') {
        blocksStale = true;
        syncBlocks();
      }
    }
  }
  $('robotCard').hidden = !(program && usesRobot(program));
  renderBytecode();
}

function syncBlocks() {
  if (!program || !blocksStale) return;
  blocks.load(program);
  blockIdFor = new Map();
  blocksStale = false;
  $('blocksBanner').hidden = true;
}

function showProblem(msg: string | null) {
  const p = $('problem');
  p.hidden = !msg;
  p.textContent = msg ?? '';
}

// ── running ────────────────────────────────────────────────────
const DELAYS = [900, 550, 330, 200, 120, 70, 35, 15, 4, 0]; // ms per statement; 0 = full speed
const speed = $<HTMLInputElement>('speed');
speed.value = String(prefs.speed);
const SPEED_NAMES = ['Slowest', 'Very slow', 'Slow', 'Slow', 'Medium', 'Medium', 'Fast', 'Faster', 'Very fast', 'Instant'];
const showSpeed = () => { $('speedLbl').textContent = SPEED_NAMES[Number(speed.value) - 1]; };
showSpeed();
speed.oninput = () => { showSpeed(); files.setPrefs({ speed: Number(speed.value) }); };
const delay = () => DELAYS[Number(speed.value) - 1];

function start(): boolean {
  analyze(editor.getText(), 'text');
  if (!compiled) {
    con.message('Fix the error shown under the code before running.', 'error');
    return false;
  }
  robot = program && usesRobot(program) ? new Robot(structuredClone(robotView.world)) : null;
  vm = new VM(compiled, { display: (t) => con.display(t), robot: robot ?? undefined });
  vm.breakpoints = editor.breakpoints();
  con.clear();
  inspector.clear();
  robotView.attach(robot);
  robotView.setEditable(false);
  renderBytecode();
  return true;
}

function go(mode: StepMode) {
  if (running && mode === 'run') return;
  if (!vm || vm.done) { if (!start()) return; }
  if (vm!.status === 'input') return;
  runMode = mode;
  stepDepth = vm!.frames.length;
  running = true;
  tick();
}

function tick() {
  timer = 0;
  if (!running || !vm) return;
  const d = delay();
  if (runMode === 'run' && d > 0) {
    // slow motion: one statement per tick, so every line lights up
    vm.run(1e5, 'into');
    if (vm.status === 'paused' && vm.reason === 'step' && vm.current && vm.breakpoints.has(vm.current.span.line)) {
      return pause('breakpoint');
    }
  } else {
    // full speed (or a step that may take a while): run in slices so the page stays responsive
    const t0 = performance.now();
    do vm.run(20000, runMode, stepDepth);
    while (vm.status === 'paused' && vm.reason === 'budget' && performance.now() - t0 < 14);
  }

  switch (vm.status) {
    case 'input':
      render(true);
      con.ask((text) => {
        if (!vm) return;
        vm.provideInput(parseInput(text));
        if (running) tick();
        else render(true);
      });
      return;
    case 'done': case 'error':
      return finish();
    case 'paused':
      if (vm.reason === 'breakpoint') return pause('breakpoint');
      if (vm.reason === 'step') {
        if (runMode !== 'run') return pause('step');
        render(false);
        timer = window.setTimeout(tick, d);
        return;
      }
      // budget used up: keep going
      render(false);
      timer = window.setTimeout(tick, 0);
  }
}

function pause(_why: 'user' | 'breakpoint' | 'step') {
  running = false;
  clearTimeout(timer);
  render(true);
}

function finish() {
  running = false;
  clearTimeout(timer);
  render(true);
  if (!vm) return;
  if (vm.status === 'error' && vm.error) {
    con.message(`Error on line ${vm.error.span.line}: ${vm.error.message}`, 'error');
  } else {
    if (robot?.atGoal()) con.message('The robot ended on the goal square!', 'ok');
    else if (robot?.events.some((e) => e.type === 'goal')) con.message('The robot passed over the goal square, but ended somewhere else.', 'info');
    con.message(`Program finished (${vm.steps.toLocaleString()} instructions).`, 'info');
  }
  robotView.setEditable(true);
}

function stop(quiet = false) {
  running = false;
  clearTimeout(timer);
  const had = !!vm;
  vm = null;
  editor.setExecLine(null);
  blocks.highlight(null);
  $('blocks').classList.remove('run-error');
  robotView.attach(null);
  robotView.setEditable(true);
  if (had && !quiet) con.message('Stopped.', 'info');
  updateChrome();
  renderBytecode();
}

function render(full: boolean) {
  const now = performance.now();
  // at full speed, don't redraw everything every slice
  if (!full && delay() === 0 && runMode === 'run' && now - lastRender < 120) return;
  lastRender = now;
  if (!vm) return;
  const cur = vm.status === 'error' ? vm.error?.span : vm.current?.span;
  const isErr = vm.status === 'error';
  editor.setExecLine(vm.status === 'done' ? null : cur?.line ?? null, isErr ? 'error' : 'run');
  const sid = vm.status === 'done' ? null : vm.current?.id ?? null;
  blocks.highlight(sid ? blockIdFor.get(sid) ?? sid : null, full);
  $('blocks').classList.toggle('run-error', isErr);
  inspector.update(vm);
  robotView.update(delay() === 0 && runMode === 'run' && running);
  highlightBytecode();
  updateChrome();
}

function updateChrome() {
  const st = vm?.status ?? 'ready';
  const paused = !!vm && !running && (st === 'paused' || st === 'ready');
  const pill = $('status');
  const line = vm?.current?.span.line;
  const label: Record<string, string> = {
    ready: 'Ready',
    running: 'Running…',
    paused: line ? `Paused at line ${line}` : 'Paused',
    input: 'Waiting for INPUT',
    done: 'Finished',
    error: 'Error',
  };
  pill.textContent = running && st !== 'input' ? 'Running…' : label[st];
  pill.dataset.state = running && st !== 'input' ? 'running' : st;
  const runBtn = $<HTMLButtonElement>('run');
  runBtn.querySelector('.lbl')!.textContent = paused ? 'Continue' : 'Run';
  runBtn.disabled = running;
  $<HTMLButtonElement>('pause').disabled = !running;
  for (const id of ['into', 'over', 'out']) $<HTMLButtonElement>(id).disabled = running || st === 'input';
  $<HTMLButtonElement>('out').disabled ||= !vm || vm.frames.length < 2;
  $<HTMLButtonElement>('stop').disabled = !vm || vm.done;
}

// ── bytecode tab ───────────────────────────────────────────────
function renderBytecode() {
  const el = $('bytecode');
  if (el.hidden) return;
  const c = vm?.prog ?? compiled;
  if (!c) { el.innerHTML = '<p class="empty">Fix the error in the code to see its bytecode.</p>'; return; }
  const fns = [c.main, ...c.procs.values()];
  el.innerHTML = fns.map((fn) => {
    const head = fn === c.main ? 'main program' : `PROCEDURE ${fn.name}(${fn.params.join(', ')})`;
    return `<div class="fn"><div class="fn-head">${head}</div>${disasmFn(fn).map((l) =>
      `<div class="op op-${l.op}" data-fn="${fn.name}" data-pc="${l.pc}"><span class="pc">${l.pc}</span><span class="nm">${l.op}</span><span class="arg">${escapeHtml(l.arg)}</span><span class="ln">${l.line}</span></div>`).join('')}</div>`;
  }).join('');
  highlightBytecode();
}
function highlightBytecode() {
  const el = $('bytecode');
  if (el.hidden || !vm) return;
  el.querySelector('.op.cur')?.classList.remove('cur');
  const f = vm.frames[vm.frames.length - 1];
  const row = el.querySelector<HTMLElement>(`.op[data-fn="${CSS.escape(f.fn.name)}"][data-pc="${f.pc}"]`);
  if (row) { row.classList.add('cur'); row.scrollIntoView({ block: 'nearest' }); }
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ── chrome wiring ──────────────────────────────────────────────
$('run').onclick = () => go('run');
$('pause').onclick = () => pause('user');
$('into').onclick = () => go('into');
$('over').onclick = () => go('over');
$('out').onclick = () => go('out');
$('stop').onclick = () => stop();
$('clearConsole').onclick = () => con.clear();
$<HTMLInputElement>('newlines').onchange = (e) => {
  con.newlines = (e.target as HTMLInputElement).checked;
  files.setPrefs({ newlines: con.newlines });
};

document.querySelectorAll<HTMLButtonElement>('[data-ins]').forEach((b) => {
  b.onclick = () => editor.insert(b.dataset.ins === '←' ? ' ← ' : ` ${b.dataset.ins} `);
});

function setView(v: View) {
  view = v;
  files.setPrefs({ view: v });
  $('editors').dataset.view = v;
  document.querySelectorAll<HTMLButtonElement>('#view button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  document.querySelector('.symbols')!.classList.toggle('hide', v === 'blocks');
  if (v !== 'text') {
    syncBlocks();
    requestAnimationFrame(() => blocks.resize());
  }
}
document.querySelectorAll<HTMLButtonElement>('#view button').forEach((b) => { b.onclick = () => setView(b.dataset.view as View); });
new ResizeObserver(() => { if (view !== 'text') blocks.resize(); }).observe($('blocks'));

document.querySelectorAll<HTMLButtonElement>('#sideTabs button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll<HTMLButtonElement>('#sideTabs button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('.tab-body').forEach((x) => { x.hidden = x.dataset.tab !== b.dataset.tab; });
    if (b.dataset.tab === 'code') renderBytecode();
  };
});

const ex = $<HTMLSelectElement>('examples');
ex.innerHTML = `<option value="">Examples…</option>` + EXAMPLES.map((e, i) => `<option value="${i}">${e.name}</option>`).join('');
ex.onchange = () => {
  const e = EXAMPLES[Number(ex.value)];
  ex.value = '';
  if (!e) return;
  const world = e.world ? structuredClone(WORLDS[e.world]) as World : defaultWorld();
  const cur = files.current();
  // Replace the open file only if it's empty or an untouched example; otherwise open the example as a new file.
  if (!cur.code.trim() || EXAMPLES.some((x) => x.code === cur.code)) {
    files.update({ name: cur.name === e.name ? cur.name : files.uniqueName(e.name), code: e.code, world, breakpoints: [] }, true);
  } else {
    files.add(makeFile(files.uniqueName(e.name), e.code, world));
  }
  openFile(files.current());
  toast(`Opened example “${e.name}”`);
};

$('refBody').innerHTML = REFERENCE_HTML;
$('refBtn').onclick = () => $<HTMLDialogElement>('ref').showModal();

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); files.update({ code: editor.getText() }, true); toast('Saved. (Your work also saves automatically.)'); return; }
  if (e.key === 'Escape' && !pop.hidden) { togglePop(false); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); running ? pause('user') : go('run'); }
  else if (e.key === 'F10') { e.preventDefault(); if (!running) go('over'); }
  else if (e.key === 'F11' && e.shiftKey) { e.preventDefault(); if (!running) go('out'); }
  else if (e.key === 'F11') { e.preventDefault(); if (!running) go('into'); }
  else if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); stop(); }
});

// ── files ──────────────────────────────────────────────────────
function openFile(f: FileDoc) {
  stop(true);
  editor.load(f.code, f.breakpoints);
  robotView.setWorld(structuredClone(f.world), false);
  con.clear();
  inspector.clear();
  $('fileName').textContent = f.name;
  document.title = `${f.name} · CSP Studio`;
  blocksStale = true;
  analyze(f.code, 'text');
  if (view !== 'text') syncBlocks();
}

const pop = $('filesPop');
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};
function renderFiles() {
  const cur = files.current().id;
  $('fileList').innerHTML = files.list().map((f) => `
    <li class="${f.id === cur ? 'on' : ''}" data-id="${f.id}">
      <button class="open" data-id="${f.id}"><span class="nm">${escapeHtml(f.name)}</span><span class="when">${ago(f.updated)}</span></button>
      <button class="del" data-del="${f.id}" title="Delete ${escapeHtml(f.name)}" aria-label="Delete">✕</button>
    </li>`).join('');
}
function togglePop(open = pop.hidden) {
  pop.hidden = !open;
  $('fileBtn').setAttribute('aria-expanded', String(open));
  if (open) {
    const r = $('fileBtn').getBoundingClientRect();
    if (innerWidth > 900) pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 390))}px`;
    renderFiles();
  }
}
$('fileBtn').onclick = (e) => { e.stopPropagation(); togglePop(); };
document.addEventListener('pointerdown', (e) => {
  if (!pop.hidden && !pop.contains(e.target as Node) && !$('fileBtn').contains(e.target as Node)) togglePop(false);
});
$('fileList').onclick = (e) => {
  const t = e.target as HTMLElement;
  const del = t.closest<HTMLElement>('[data-del]')?.dataset.del;
  if (del) {
    const f = files.list().find((x) => x.id === del)!;
    if (!confirm(`Delete “${f.name}”? This can't be undone.`)) return;
    const wasOpen = del === files.current().id;
    files.remove(del);
    if (wasOpen) openFile(files.current());
    renderFiles();
    toast(`Deleted “${f.name}”`);
    return;
  }
  const id = t.closest<HTMLElement>('[data-id]')?.dataset.id;
  if (id && id !== files.current().id) {
    files.open(id);
    openFile(files.current());
    togglePop(false);
  }
};
function rename() {
  togglePop(false);
  const span = $('fileName');
  const btn = $('fileBtn');
  const cur = files.current();
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = cur.name;
  input.setAttribute('aria-label', 'Program name');
  btn.hidden = true;
  btn.after(input);
  input.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    const name = input.value.trim().slice(0, 80);
    input.remove();
    btn.hidden = false;
    if (keep && name && name !== cur.name) {
      files.update({ name }, true);
      span.textContent = name;
      document.title = `${name} · CSP Studio`;
    }
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
}
$('fileBtn').ondblclick = (e) => { e.preventDefault(); rename(); };
pop.querySelector('.files-actions')!.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  const cur = files.current();
  if (act === 'new') {
    files.add(makeFile(files.uniqueName('Untitled'), '', structuredClone(robotView.world)));
    openFile(files.current());
    togglePop(false);
    editor.focus();
  } else if (act === 'dup') {
    files.add({ ...makeFile(files.uniqueName(`${cur.name} copy`), editor.getText(), structuredClone(cur.world)), breakpoints: [...cur.breakpoints] });
    openFile(files.current());
    renderFiles();
    toast('Made a copy');
  } else if (act === 'rename') {
    rename();
  } else if (act === 'import') {
    $<HTMLInputElement>('importInput').click();
  } else if (act === 'export') {
    download();
  }
});
$<HTMLInputElement>('importInput').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 500_000) { toast('That file is too big to be a program.'); return; }
  const text = (await file.text()).replace(/\r\n?/g, '\n');
  files.add(makeFile(files.uniqueName(file.name.replace(/\.(txt|csp|md)$/i, '')), text, structuredClone(robotView.world)));
  openFile(files.current());
  togglePop(false);
  toast(`Opened ${file.name}`);
};
function download() {
  const f = files.current();
  const blob = new Blob([editor.getText()], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${f.name.replace(/[^\w\- ]+/g, '').trim() || 'program'}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// save indicator
const saveEl = $('saveState');
files.onSave((st) => {
  saveEl.dataset.state = st;
  saveEl.textContent = st === 'saving' ? 'Saving…' : st === 'saved' ? 'Saved' : 'Not saved: browser storage is full or blocked';
});

// share links
$('shareBtn').onclick = async () => {
  const f = files.current();
  const token = await encodeShare({ name: f.name, code: editor.getText(), world: program && usesRobot(program) ? robotView.world : undefined });
  const url = `${location.origin}${location.pathname}#p=${token}`;
  const input = $<HTMLInputElement>('shareUrl');
  input.value = url;
  $<HTMLDialogElement>('shareDlg').showModal();
  input.select();
};
$('copyShare').onclick = async () => {
  const input = $<HTMLInputElement>('shareUrl');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('copyShare').textContent = 'Copied!';
  setTimeout(() => { $('copyShare').textContent = 'Copy'; }, 1500);
};
async function openSharedFromHash() {
  const m = location.hash.match(/^#p=([A-Za-z0-9_-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  const s = await decodeShare(m[1]);
  if (!s) { toast("That link didn't contain a readable program."); return; }
  const existing = files.list().find((f) => f.code === s.code);
  if (existing) files.open(existing.id);
  else files.add(makeFile(files.uniqueName(s.name), s.code, s.world ?? structuredClone(robotView.world)));
  openFile(files.current());
  toast(`Opened shared program “${files.current().name}” (saved to your programs)`);
}
window.addEventListener('hashchange', openSharedFromHash);

// toast
let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 3200);
}

// ── boot ───────────────────────────────────────────────────────
setView(view);
openFile(files.current());
updateChrome();
openSharedFromHash();

// dev hook for poking at things from the console
(window as unknown as { __ide: unknown }).__ide = { editor, blocks, get vm() { return vm; }, go, stop };
