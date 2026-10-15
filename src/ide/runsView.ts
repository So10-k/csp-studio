import type { RunResult } from '../lang/trace';
import { sameAnswer } from './traceView';

export interface RunCase {
  inputs: string;
  expected: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const splitInputs = (s: string) => s.split(',').map((x) => x.trim()).filter((x) => x !== '');
const outputText = (r: RunResult) => r.output.join(' ');

/** Does the output match what was expected? (Spacing doesn't matter.) */
export function outputMatches(expected: string, actual: string): boolean {
  const norm = (s: string) => s.trim().split(/\s+/).filter(Boolean);
  const a = norm(expected), b = norm(actual);
  return a.length === b.length && a.every((x, i) => sameAnswer(x, b[i]));
}

/** Tally the outputs of many runs (for programs that use RANDOM). */
export function tally(results: RunResult[]): { output: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    const key = r.error ? `Error: ${r.error.message}` : outputText(r) || '(no output)';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([output, count]) => ({ output, count })).sort((a, b) => b.count - a.count || a.output.localeCompare(b.output, undefined, { numeric: true }));
}

/**
 * The Runs tab: a table of test runs (INPUT values → output, optionally checked against an expected
 * output), and "run it N times" to see how often each output happens.
 */
export class RunsView {
  private results: (RunResult | null)[] = [];
  private freq: { output: string; count: number }[] | null = null;
  private freqN = 0;

  constructor(
    private root: HTMLElement,
    private deps: {
      cases(): RunCase[];
      saveCases(c: RunCase[]): void;
      run(inputs: string[]): RunResult | null;
      usesInput(): boolean;
      usesRandom(): boolean;
    },
  ) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r]');
      if (!el) return;
      const act = el.dataset.r!;
      const cases = this.deps.cases();
      if (act === 'add') { cases.push({ inputs: '', expected: '' }); this.deps.saveCases(cases); this.render(); this.focusLast(); }
      if (act === 'all') this.runAll();
      if (act === 'del') {
        const i = Number(el.dataset.i);
        cases.splice(i, 1);
        this.results.splice(i, 1);
        this.deps.saveCases(cases);
        this.render();
      }
      if (act === 'repeat') this.repeat();
    });
    root.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.f === undefined) return;
      const cases = this.deps.cases();
      const i = Number(el.dataset.i);
      cases[i][el.dataset.f as keyof RunCase] = el.value;
      this.deps.saveCases(cases);
      this.results[i] = null;
      el.closest('tr')?.querySelector('.res')?.replaceChildren();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).dataset.f !== undefined) { e.preventDefault(); this.runAll(); }
    });
  }

  /** The code changed: old results no longer apply. */
  reset() {
    this.results = [];
    this.freq = null;
    this.render();
  }

  private focusLast() {
    const ins = this.root.querySelectorAll<HTMLInputElement>('input[data-f="inputs"]');
    ins[ins.length - 1]?.focus();
  }

  private runAll() {
    const cases = this.deps.cases();
    if (!cases.length) { cases.push({ inputs: '', expected: '' }); this.deps.saveCases(cases); }
    this.results = cases.map((c) => this.deps.run(splitInputs(c.inputs)));
    this.render();
  }

  private repeat() {
    const n = Math.max(1, Math.min(10000, Number(this.root.querySelector<HTMLInputElement>('#repeatN')?.value) || 100));
    const first = this.deps.cases()[0];
    const results: RunResult[] = [];
    for (let i = 0; i < n; i++) {
      const r = this.deps.run(splitInputs(first?.inputs ?? ''));
      if (!r) return;
      results.push(r);
    }
    this.freq = tally(results);
    this.freqN = n;
    this.render();
  }

  render() {
    const cases = this.deps.cases();
    const usesInput = this.deps.usesInput();
    const rows = cases.map((c, i) => {
      const r = this.results[i];
      let res = '';
      if (r) {
        const out = outputText(r);
        const verdict = r.error ? 'bad' : c.expected.trim() ? (outputMatches(c.expected, out) ? 'pass' : 'fail') : '';
        res = `<div class="run-out ${verdict}">${r.error ? `⚠ Line ${r.error.line}: ${esc(r.error.message)}` : esc(out) || '<i>(no output)</i>'}</div>
          ${verdict === 'pass' ? '<span class="badge pass">✓ matches</span>' : verdict === 'fail' ? '<span class="badge fail">✗ expected something else</span>' : ''}`;
      }
      return `<tr>
        <td class="n">${i + 1}</td>
        ${usesInput ? `<td><input data-f="inputs" data-i="${i}" value="${esc(c.inputs)}" placeholder="3, 7" spellcheck="false" /></td>` : ''}
        <td><input data-f="expected" data-i="${i}" value="${esc(c.expected)}" placeholder="(optional)" spellcheck="false" /></td>
        <td class="res">${res}</td>
        <td><button class="icon-x" data-r="del" data-i="${i}" title="Remove this run" aria-label="Remove">✕</button></td>
      </tr>`;
    }).join('');
    const passed = this.results.filter((r, i) => r && !r.error && cases[i]?.expected.trim() && outputMatches(cases[i].expected, outputText(r))).length;
    const withExpected = cases.filter((c, i) => c.expected.trim() && this.results[i]).length;

    const max = this.freq ? Math.max(...this.freq.map((f) => f.count)) : 1;
    const freq = this.freq
      ? `<table class="freq"><thead><tr><th>Output</th><th>Times</th><th></th></tr></thead><tbody>${this.freq.slice(0, 30).map((f) => `
          <tr><td class="mono">${esc(f.output)}</td><td class="n">${f.count} <small>(${((f.count / this.freqN) * 100).toFixed(1)}%)</small></td>
          <td class="bar"><span style="width:${(f.count / max) * 100}%"></span></td></tr>`).join('')}</tbody></table>
          ${this.freq.length > 30 ? `<p class="muted">…and ${this.freq.length - 30} other outputs.</p>` : ''}`
      : '';

    this.root.innerHTML = `
      <p class="muted runs-help">${usesInput ? 'Each row runs the whole program with its INPUT values (separated by commas).' : 'Each row is one run of the whole program.'} Add the output you expect to check it.</p>
      <table class="runs"><thead><tr><th>#</th>${usesInput ? '<th>INPUTs</th>' : ''}<th>Expected output</th><th>Actual output</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5" class="muted">No runs yet: press + Add run.</td></tr>`}</tbody></table>
      <div class="runs-bar">
        <button class="btn tiny" data-r="add">+ Add run</button>
        <button class="btn tiny primary" data-r="all">▶ Run all</button>
        ${withExpected ? `<span class="score ${passed === withExpected ? 'ok' : ''}">${passed}/${withExpected} match</span>` : ''}
      </div>
      <div class="repeat">
        <div class="repeat-head"><b>How often?</b> ${this.deps.usesRandom() ? '' : '<span class="muted">(most useful with RANDOM)</span>'}</div>
        <div class="runs-bar">Run it <input id="repeatN" type="number" min="1" max="10000" value="${this.freqN || 100}" /> times
          <button class="btn tiny" data-r="repeat">▶ Go</button></div>
        ${freq}
      </div>`;
  }
}
