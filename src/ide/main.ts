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
import { load, save } from './storage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ── state ──────────────────────────────────────────────────────
type View = 'text' | 'blocks' | 'split';
const saved = load();
let view: View = saved.view;
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
con.newlines = saved.newlines;
$<HTMLInputElement>('newlines').checked = saved.newlines;
const inspector = new Inspector($('vars'), $('stack'));
inspector.clear();
const robotView = new RobotView(saved.world, (w) => {
  save({ world: w });
  if (vm) stop(true);
});
$('robot').append(robotView.el);

const editor = createEditor($('text'), saved.code, {
  change(text) {
    save({ code: text });
    if (vm) stop(true);
    clearTimeout(textTimer);
    textTimer = window.setTimeout(() => analyze(text, 'text'), 200);
  },
  breakpoints(lines) {
    save({ breakpoints: [...lines] });
    if (vm) vm.breakpoints = lines;
  },
});
let textTimer = 0;
editor.setBreakpoints(saved.breakpoints);

const blocks = new BlocksPane($('blocks'), {
  program(p) {
    const text = printProgram(p);
    if (text === editor.getText()) return;
    if (vm) stop(true);
    editor.setText(text);
    save({ code: text });
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
speed.value = String(saved.speed);
speed.oninput = () => save({ speed: Number(speed.value) });
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
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
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
  save({ newlines: con.newlines });
};

document.querySelectorAll<HTMLButtonElement>('[data-ins]').forEach((b) => {
  b.onclick = () => editor.insert(b.dataset.ins === '←' ? ' ← ' : ` ${b.dataset.ins} `);
});

function setView(v: View) {
  view = v;
  save({ view: v });
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
  stop(true);
  editor.setText(e.code);
  save({ code: e.code });
  if (e.world) robotView.setWorld(structuredClone(WORLDS[e.world]) as World, true);
  con.clear();
  analyze(e.code, 'text');
};

$('refBody').innerHTML = REFERENCE_HTML;
$('refBtn').onclick = () => $<HTMLDialogElement>('ref').showModal();

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); running ? pause('user') : go('run'); }
  else if (e.key === 'F10') { e.preventDefault(); if (!running) go('over'); }
  else if (e.key === 'F11' && e.shiftKey) { e.preventDefault(); if (!running) go('out'); }
  else if (e.key === 'F11') { e.preventDefault(); if (!running) go('into'); }
  else if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); stop(); }
});

// ── boot ───────────────────────────────────────────────────────
setView(view);
analyze(editor.getText(), 'text');
updateChrome();

// dev hook for poking at things from the console
(window as unknown as { __ide: unknown }).__ide = { editor, blocks, get vm() { return vm; }, go, stop };
