import type { RunResult, TraceColumn, TraceRow, Tracer } from '../lang/trace';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Loose comparison for practice answers: ignore spaces, quotes around text, and case of true/false. */
export function sameAnswer(typed: string, actual: string): boolean {
  const norm = (s: string) => {
    let t = s.trim().replace(/\s+/g, '');
    if (/^".*"$/.test(t) && !t.includes('","')) t = t.slice(1, -1);
    if (/^(true|false)$/i.test(t)) t = t.toLowerCase();
    if (/^-?\d*\.?\d+$/.test(t)) t = String(Number(t));
    return t;
  };
  return norm(typed) === norm(actual);
}

const MAX_LIVE_ROWS = 400;
export const MAX_PRACTICE_ROWS = 80;

/**
 * The Trace tab: a trace table (one row per statement that ran, one column per variable),
 * built live while the program runs or all at once, with a practice mode that blanks the values out.
 */
export class TraceView {
  practice = false;
  revealed = false;
  private tracer: Tracer | null = null;
  private result: RunResult | null = null;
  private answers = new Map<string, string>();
  private checked = false;
  private body: HTMLElement;
  private inputs: HTMLInputElement;
  private note: HTMLElement;

  constructor(
    private root: HTMLElement,
    private deps: {
      lineText(n: number): string;
      /** run the whole program now with these INPUT values */
      build(inputs: string[]): RunResult | null;
      usesInput(): boolean;
      practiceChanged(on: boolean): void;
    },
  ) {
    root.innerHTML = `
      <div class="trace-bar">
        <label class="switch" title="Hide the values so students can fill in the trace table themselves">
          <input type="checkbox" id="practiceToggle" /><span class="track"></span> Practice
        </label>
        <label class="trace-inputs" hidden>INPUTs <input id="traceInputs" placeholder="e.g. 3, 7" spellcheck="false" /></label>
        <span class="grow"></span>
        <button class="btn tiny" data-t="build" title="Run the whole program now and fill in the table">▶ Build table</button>
        <button class="btn tiny" data-t="check" hidden>Check</button>
        <button class="btn tiny" data-t="reveal" hidden>Reveal</button>
        <button class="btn tiny ghost" data-t="csv" title="Copy the table (paste into a spreadsheet)">Copy</button>
      </div>
      <div class="trace-note"></div>
      <div class="trace-table"></div>`;
    this.body = root.querySelector('.trace-table')!;
    this.inputs = root.querySelector('#traceInputs')!;
    this.note = root.querySelector('.trace-note')!;
    const toggle = root.querySelector<HTMLInputElement>('#practiceToggle')!;
    toggle.onchange = () => this.setPractice(toggle.checked);
    root.querySelector('.trace-bar')!.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
      if (t === 'build') this.build();
      if (t === 'check') this.check();
      if (t === 'reveal') this.reveal();
      if (t === 'csv') this.copy();
    });
    this.body.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.k) {
        this.answers.set(el.dataset.k, el.value);
        el.classList.remove('right', 'wrong');
      }
    });
    this.body.addEventListener('keydown', (e) => {
      // Enter moves to the next blank, like a spreadsheet
      const el = e.target as HTMLInputElement;
      if (e.key !== 'Enter' || !el.dataset.k) return;
      e.preventDefault();
      const all = [...this.body.querySelectorAll<HTMLInputElement>('input[data-k]')];
      all[all.indexOf(el) + 1]?.focus();
    });
    this.render();
  }

  setPractice(on: boolean, silent = false) {
    this.practice = on;
    this.root.querySelector<HTMLInputElement>('#practiceToggle')!.checked = on;
    this.revealed = false;
    this.checked = false;
    this.answers.clear();
    if (!silent) this.deps.practiceChanged(on);
    if (on) this.build();
    else this.render();
  }

  /** Forget the table (the code changed). */
  reset() {
    this.tracer = null;
    this.result = null;
    this.answers.clear();
    this.checked = false;
    this.revealed = false;
    this.render();
  }

  /** Show a live trace from the interactive run. */
  live(tracer: Tracer) {
    if (this.practice && !this.revealed) return; // the practice table comes from build()
    this.tracer = tracer;
    this.result = null;
    this.render();
  }

  get hiding() {
    return this.practice && !this.revealed;
  }

  syncInputsField() {
    this.root.querySelector<HTMLElement>('.trace-inputs')!.hidden = !this.deps.usesInput();
  }

  private build() {
    this.syncInputsField();
    const inputs = this.inputs.value.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const r = this.deps.build(inputs);
    if (!r) return;
    this.result = r;
    this.tracer = r.tracer;
    this.answers.clear();
    this.checked = false;
    this.revealed = false;
    this.render();
    if (r.needsInput) this.inputs.focus();
  }

  private check() {
    this.checked = true;
    let right = 0, total = 0;
    this.body.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((el) => {
      total++;
      const ok = sameAnswer(el.value, el.dataset.a!);
      if (ok) right++;
      el.classList.toggle('right', ok);
      el.classList.toggle('wrong', !ok);
    });
    this.note.innerHTML = total
      ? `<b class="${right === total ? 'ok' : ''}">${right} of ${total} correct${right === total ? ' 🎉' : ''}.</b> ${right === total ? 'Nice tracing!' : 'Red boxes are wrong: try again, or press Reveal.'}`
      : '';
  }

  private reveal() {
    this.revealed = true;
    this.deps.practiceChanged(this.practice);
    this.render();
  }

  private copy() {
    if (!this.tracer) return;
    const cols = this.tracer.columns;
    const rows = [['Step', 'Line', 'Code', ...cols.map(colName), 'Condition', 'Output'].join('\t')];
    for (const r of this.tracer.rows) {
      rows.push([r.step, r.line, this.deps.lineText(r.line), ...cols.map((c) => r.changes[c.key] ?? ''), r.cond === undefined ? '' : String(r.cond), [...r.input.map((i) => `> ${i}`), ...r.output].join(' ')].join('\t'));
    }
    navigator.clipboard?.writeText(rows.join('\n')).then(
      () => { this.note.textContent = 'Copied! Paste it into a spreadsheet or doc.'; },
      () => { this.note.textContent = "Couldn't copy (the browser blocked it)."; },
    );
  }

  render() {
    const hiding = this.hiding;
    const bar = this.root;
    bar.querySelector<HTMLElement>('[data-t="check"]')!.hidden = !hiding;
    bar.querySelector<HTMLElement>('[data-t="reveal"]')!.hidden = !hiding;
    this.syncInputsField();
    const t = this.tracer;
    if (!t) {
      this.note.innerHTML = this.practice
        ? 'Press <b>▶ Build table</b>, then fill in each blank with the value after that line runs.'
        : 'Run or step through the program and every statement it runs gets a row here, or press <b>▶ Build table</b> to run it all at once.';
      this.body.innerHTML = '';
      return;
    }
    const err = this.result?.error;
    let rows = t.rows;
    let note = '';
    if (hiding && rows.length > MAX_PRACTICE_ROWS) {
      rows = rows.slice(0, MAX_PRACTICE_ROWS);
      note = `Showing the first ${MAX_PRACTICE_ROWS} steps (that's plenty of practice!). `;
    } else if (!hiding && rows.length > MAX_LIVE_ROWS) {
      note = `Showing the last ${MAX_LIVE_ROWS} of ${rows.length} steps. `;
      rows = rows.slice(-MAX_LIVE_ROWS);
    }
    if (t.truncated) note += 'The table stopped growing after many steps. ';
    if (err) note += `<span class="bad">Line ${err.line}: ${esc(err.message)}</span>`;
    if (!this.checked) {
      this.note.innerHTML = note || (hiding ? 'Fill in each blank with the value <i>after</i> that line runs. Text can be typed with or without quotes. Press Enter to jump to the next blank.' : '');
    }

    const cols = t.columns;
    const scoped = cols.some((c) => c.scope);
    const head = `<tr><th>#</th><th>Line</th><th class="code">Code</th>${cols.map((c) => `<th class="vcol">${esc(c.name)}${scoped ? `<small>${c.scope ? esc(c.scope) : 'global'}</small>` : ''}</th>`).join('')}<th>Condition</th><th>Output</th></tr>`;
    const last = t.rows[t.rows.length - 1];
    const cell = (r: TraceRow, key: string, actual: string | undefined) => {
      if (actual === undefined) return '<td></td>';
      if (!hiding) return `<td class="val">${esc(actual)}</td>`;
      const k = `${r.step}:${key}`;
      return `<td class="blank"><input data-k="${esc(k)}" data-a="${esc(actual)}" value="${esc(this.answers.get(k) ?? '')}" spellcheck="false" autocomplete="off" /></td>`;
    };
    const body = rows.map((r) => {
      const out = [...r.input.map((i) => `› ${i}`), ...r.output];
      const cond = r.cond === undefined ? undefined : String(r.cond);
      return `<tr class="${r === last && !this.result ? 'cur' : ''} ${err && err.line === r.line && r === last ? 'err' : ''}">
        <td class="n">${r.step}</td><td class="n">${r.line}</td>
        <td class="code" style="padding-left:${6 + (r.depth - 1) * 12}px">${esc(this.deps.lineText(r.line))}</td>
        ${cols.map((c) => cell(r, c.key, r.changes[c.key])).join('')}
        ${cell(r, 'cond', cond).replace('<td class="val">', `<td class="val cond ${cond}">`)}
        ${hiding && r.output.length
          ? cell(r, 'out', r.output.join(' ')).replace('<td class="blank">', `<td class="blank out">${esc(r.input.map((i) => `› ${i}`).join(' '))}`)
          : `<td class="out">${esc(out.join(' '))}</td>`}
      </tr>`;
    }).join('');
    this.body.innerHTML = `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
    if (!this.result) this.body.querySelector('tr.cur')?.scrollIntoView({ block: 'nearest' });
  }
}

function colName(c: TraceColumn) {
  return c.scope ? `${c.name} (${c.scope})` : c.name;
}
