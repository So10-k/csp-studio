import { lex } from '../lang/lexer';
import type { RunResult } from '../lang/trace';
import { checkTyped, correctText, generate, solve, type Question } from '../tracing/generate';
import { LEVELS, levelById, type LevelId } from '../tracing/levels';
import { progress, SET_SIZE, type Result, type Session } from '../tracing/progress';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const LETTERS = 'ABCD';

/** Exam-style code listing with syntax colors (read-only). */
export function highlightCode(src: string): string {
  let html = '';
  let pos = 0;
  for (const t of lex(src)) {
    if (t.type === 'eof') break;
    html += esc(src.slice(pos, t.span.from));
    const text = esc(src.slice(t.span.from, t.span.to));
    const cls = t.type === 'kw' ? (t.value === 'TRUE' || t.value === 'FALSE' ? 'atom' : 'kw') : t.type === 'num' ? 'num' : t.type === 'str' ? 'str' : t.type === 'op' ? 'op' : t.type === 'ident' && /^[A-Z_]+$/.test(t.value) ? 'builtin' : '';
    html += cls ? `<span class="t-${cls}">${text}</span>` : text;
    pos = t.span.to;
  }
  html += esc(src.slice(pos));
  return html.split('\n').map((l, i) => `<div class="cl"><span class="ln">${i + 1}</span><span class="tx">${l || ' '}</span></div>`).join('');
}

/** The answer-key trace table for the worked solution. */
function solutionTable(r: RunResult, code: string): string {
  const lines = code.split('\n');
  const t = r.tracer;
  const cols = t.columns;
  const scoped = cols.some((c) => c.scope);
  const rows = t.rows.slice(0, 120).map((row) => `<tr>
      <td class="n">${row.line}</td>
      <td class="code" style="padding-left:${6 + (row.depth - 1) * 12}px">${esc((lines[row.line - 1] ?? '').trim())}</td>
      ${cols.map((c) => `<td class="val">${esc(row.changes[c.key] ?? '')}</td>`).join('')}
      <td class="val cond ${row.cond}">${row.cond === undefined ? '' : row.cond}</td>
      <td class="out">${esc(row.output.join(' '))}</td>
    </tr>`).join('');
  return `<table class="sol"><thead><tr><th>Line</th><th>Code</th>${cols.map((c) => `<th class="vcol">${esc(c.name)}${scoped ? `<small>${c.scope ?? 'global'}</small>` : ''}</th>`).join('')}<th>Cond.</th><th>Output</th></tr></thead><tbody>${rows}</tbody></table>
    ${t.rows.length > 120 ? `<p class="muted">…${t.rows.length - 120} more steps.</p>` : ''}`;
}

type Screen = 'home' | 'question' | 'results';

/**
 * Tracing mode: AP-style code tracing questions by level, with a trace table to work in.
 * The IDE is hidden and the code can't be copied, so the only way to the answer is tracing it
 * (or pressing "run it for me", which counts the question as missed).
 */
export class TracingMode {
  private el: HTMLElement;
  private screen: Screen = 'home';
  private q: Question | null = null;
  private answered: Result | null = null;
  private selected: number | null = null;
  private table: string[][] = [];
  private timer = 0;
  active = false;

  constructor(private host: { toast(msg: string): void; onExit(): void }) {
    this.el = document.createElement('div');
    this.el.id = 'tracing';
    this.el.className = 'tracing';
    this.el.hidden = true;
    document.body.append(this.el);

    // ── fair play ────────────────────────────────────────────
    const inQuestion = () => this.active && this.screen === 'question' && !this.answered;
    const block = (e: Event) => {
      if (!inQuestion()) return;
      const t = e.target as HTMLElement;
      if (t?.matches?.('input, textarea')) return; // copying your own answers is fine
      e.preventDefault();
      this.host.toast('Copying is off while a question is open. Trace it by hand: that is the skill the exam tests!');
    };
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    this.el.addEventListener('contextmenu', (e) => { if ((e.target as HTMLElement).closest('.exam-code')) e.preventDefault(); });
    this.el.addEventListener('dragstart', (e) => { if ((e.target as HTMLElement).closest?.('.exam-code')) e.preventDefault(); });
    const left = () => {
      if (!inQuestion()) return;
      progress.noteLeft();
      this.el.querySelector<HTMLElement>('.left-note')?.removeAttribute('hidden');
    };
    // switching tabs counts right away; losing focus counts after 2 s (so a stray click doesn't)
    let blurTimer = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(blurTimer); left(); } });
    window.addEventListener('blur', () => { blurTimer = window.setTimeout(() => { if (!document.hidden) left(); }, 2000); });
    window.addEventListener('focus', () => clearTimeout(blurTimer));

    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ── open / close ─────────────────────────────────────────────
  open() {
    this.active = true;
    this.el.hidden = false;
    document.body.classList.add('tracing-on');
    // a question left open (reload, closed tab) counts as missed: no peeking and coming back
    const s = progress.session();
    if (s?.open) {
      progress.skipOpen();
      this.host.toast('The question you left unanswered was counted as missed.');
    }
    this.go(s && s.results.length < s.seeds.length ? 'question' : s ? 'results' : 'home');
  }

  private close() {
    if (this.screen === 'question' && !this.answered) {
      if (!confirm('Leave tracing mode? This question will count as missed (so nobody can peek with the editor and come back).')) return;
      progress.skipOpen();
    }
    clearInterval(this.timer);
    this.active = false;
    this.el.hidden = true;
    document.body.classList.remove('tracing-on');
    this.host.onExit();
  }

  private go(screen: Screen) {
    this.screen = screen;
    clearInterval(this.timer);
    if (screen === 'question') this.loadQuestion();
    this.render();
  }

  private loadQuestion() {
    const s = progress.session()!;
    const seed = s.seeds[s.results.length];
    this.q = generate(s.level, seed);
    this.answered = null;
    this.selected = null;
    this.table = Array.from({ length: 4 }, () => Array(this.q!.variables.length + 2).fill(''));
    progress.open(seed);
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private tick() {
    const s = progress.session();
    const t = this.el.querySelector('.clock');
    if (!s?.open || !t) return;
    const sec = Math.floor((Date.now() - s.open.since) / 1000);
    const goal = levelById(s.level).minutes * 60;
    t.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    t.classList.toggle('over', sec > goal);
  }

  // ── actions ──────────────────────────────────────────────────
  private submit(peeked = false) {
    const q = this.q!;
    if (this.answered) return;
    let correct = false;
    let typed: string | null = null;
    if (peeked) {
      correct = false;
    } else if (q.typed) {
      typed = this.el.querySelector<HTMLInputElement>('#typedAnswer')?.value ?? '';
      if (!typed.trim()) return;
      correct = checkTyped(q, typed);
    } else {
      if (this.selected === null) return;
      correct = this.selected === q.answer;
    }
    clearInterval(this.timer);
    this.answered = progress.record({ seed: q.seed, choice: peeked ? null : this.selected, typed, correct, peeked, skipped: false });
    this.render();
    this.el.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  private next() {
    const s = progress.session()!;
    this.go(s.results.length >= s.seeds.length ? 'results' : 'question');
  }

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('[data-a]');
    if (!act) return;
    const a = act.dataset.a!;
    if (a === 'exit') this.close();
    if (a === 'level') { progress.start(act.dataset.level as LevelId); this.go('question'); }
    if (a === 'resume') this.go('question');
    if (a === 'home') {
      if (this.screen === 'question' && !this.answered) {
        if (!confirm('Quit this set? The current question will count as missed.')) return;
        progress.skipOpen();
      }
      progress.end();
      this.go('home');
    }
    if (a === 'choose' && !this.answered) { this.selected = Number(act.dataset.i); this.render(); }
    if (a === 'submit') this.submit();
    if (a === 'next') this.next();
    if (a === 'hint') { progress.noteHint(); this.render(true); }
    if (a === 'peek') this.peek();
    if (a === 'row') { this.table.push(Array(this.q!.variables.length + 2).fill('')); this.render(); this.focusCell(this.table.length - 1, 0); }
    if (a === 'again') { const lv = progress.session()?.level ?? 'basic'; progress.start(lv); this.go('question'); }
    if (a === 'nextLevel') {
      const i = LEVELS.findIndex((l) => l.id === progress.session()?.level);
      progress.start(LEVELS[Math.min(i + 1, LEVELS.length - 1)].id);
      this.go('question');
    }
  }

  private peek() {
    const dlg = document.createElement('dialog');
    dlg.className = 'peek-dlg';
    dlg.innerHTML = `
      <h2>Run it for you?</h2>
      <p>You'll see the answer and the full trace, but this question will be marked <b>missed</b>.</p>
      <p class="muted">On the AP exam there's no Run button. Every question you trace yourself, even if you get it wrong, makes the next one easier. Peeking only hurts your own practice.</p>
      <div class="row"><button class="btn primary" value="keep">I'll keep tracing</button><button class="btn ghost" value="peek">Show me (counts as missed)</button></div>`;
    document.body.append(dlg);
    dlg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      dlg.close();
      dlg.remove();
      if (b.value === 'peek') this.submit(true);
    }));
    dlg.showModal();
  }

  private onInput(e: Event) {
    const el = e.target as HTMLInputElement;
    if (el.dataset.r !== undefined) this.table[Number(el.dataset.r)][Number(el.dataset.c)] = el.value;
  }

  private focusCell(r: number, c: number) {
    this.el.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)?.focus();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.active) return;
    const inField = (e.target as HTMLElement).matches('input, textarea');
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); this.close(); return; }
    // block select-all + copy shortcuts outside fields while a question is open
    if (!inField && (e.metaKey || e.ctrlKey) && /^[ac]$/i.test(e.key) && this.screen === 'question' && !this.answered) { e.preventDefault(); return; }
    if (this.screen !== 'question') return;
    if (inField) {
      // Enter in the table moves down a row, like a spreadsheet
      const el = e.target as HTMLInputElement;
      if (e.key === 'Enter' && el.dataset.r !== undefined) {
        e.preventDefault();
        const r = Number(el.dataset.r) + 1, c = Number(el.dataset.c);
        if (r >= this.table.length) { this.table.push(Array(this.q!.variables.length + 2).fill('')); this.render(); }
        this.focusCell(r, c);
      } else if (e.key === 'Enter' && el.id === 'typedAnswer') {
        e.preventDefault();
        this.answered ? this.next() : this.submit();
      }
      return;
    }
    if (!this.answered && !this.q?.typed) {
      const i = 'abcd'.indexOf(e.key.toLowerCase()) >= 0 ? 'abcd'.indexOf(e.key.toLowerCase()) : '1234'.indexOf(e.key);
      if (i >= 0) { this.selected = i; this.render(); return; }
    }
    if (e.key === 'Enter') { e.preventDefault(); this.answered ? this.next() : this.submit(); }
  }

  // ── rendering ────────────────────────────────────────────────
  private render(showHint = false) {
    const s = progress.session();
    const head = `
      <header class="tr-top">
        <button class="btn ghost" data-a="exit" title="Back to the editor (Esc)">← Editor</button>
        <div class="tr-title"><b>Code Tracing</b><span class="muted">AP CSP exam practice</span></div>
        ${s && this.screen !== 'home' ? this.progressBar(s) : '<span class="grow"></span>'}
        ${s && this.screen === 'question' ? `<span class="clock" title="Time on this question">0:00</span>` : ''}
        ${s && this.screen !== 'home' ? `<button class="btn ghost tiny" data-a="home" title="Quit this set and pick a level">All levels</button>` : ''}
      </header>`;
    const body = this.screen === 'home' ? this.homeHtml() : this.screen === 'results' ? this.resultsHtml() : this.questionHtml(showHint);
    this.el.innerHTML = head + `<div class="tr-body">${body}</div>`;
    if (this.screen === 'question') this.tick();
    if (this.screen === 'question' && this.q?.typed && !this.answered) this.el.querySelector<HTMLInputElement>('#typedAnswer')?.focus({ preventScroll: true });
  }

  private progressBar(s: Session) {
    const dots = s.seeds.map((_, i) => {
      const r = s.results[i];
      const cls = r ? (r.correct ? 'ok' : 'bad') : i === s.results.length ? 'cur' : '';
      return `<span class="dot ${cls}"></span>`;
    }).join('');
    const lv = levelById(s.level);
    return `<div class="tr-progress"><span class="chip lv-${lv.id}">${lv.name}</span><span class="dots">${dots}</span>
      <span class="muted">${Math.min(s.results.length + (this.screen === 'question' && !this.answered ? 1 : 0), SET_SIZE)} / ${SET_SIZE}</span></div>`;
  }

  private homeHtml() {
    const s = progress.session();
    const resume = s && s.results.length < s.seeds.length
      ? `<div class="resume">You have a <b>${levelById(s.level).name}</b> set in progress (${s.results.length} of ${SET_SIZE} done).
          <button class="btn primary tiny" data-a="resume">Resume</button><button class="btn tiny ghost" data-a="home">Start over</button></div>`
      : '';
    const cards = LEVELS.map((l, i) => {
      const st = progress.stats(l.id);
      const acc = st.answered ? Math.round((st.correct / st.answered) * 100) : null;
      const stars = st.best >= 0.9 ? '★★★' : st.best >= 0.7 ? '★★☆' : st.best >= 0.5 ? '★☆☆' : '☆☆☆';
      return `<button class="lv-card lv-${l.id}" data-a="level" data-level="${l.id}">
        <span class="lv-num">${i + 1}</span>
        <span class="lv-name">${l.name}</span>
        <span class="lv-topics">${esc(l.topics)}</span>
        <span class="lv-meta">${l.typed ? `${Math.round(l.typed * 100)}% typed answers · ` : ''}~${l.minutes} min each${l.hints ? ' · hints' : ''}</span>
        <span class="lv-stats"><span class="stars" title="Best set: ${Math.round(st.best * 100)}%">${stars}</span>${acc === null ? '<span class="muted">not started</span>' : `<span>${acc}% correct · ${st.answered} answered</span>`}</span>
      </button>`;
    }).join('');
    return `
      <section class="tr-intro">
        <h1>Trace code like it's exam day</h1>
        <p>Pick a level and you get ${SET_SIZE} questions in the style of the AP CSP exam. Read the code, trace it in the table, and answer. The editor is hidden and the code can't be run or copied here: tracing it yourself is the whole point.</p>
        ${resume}
      </section>
      <div class="lv-grid">${cards}</div>`;
  }

  private questionHtml(showHint: boolean) {
    const q = this.q!;
    const s = progress.session()!;
    const lv = levelById(q.level);
    const n = s.results.length + (this.answered ? 0 : 1);
    const done = !!this.answered;
    const open = s.open;

    let answerUi: string;
    if (q.typed) {
      const ok = done && this.answered!.correct;
      answerUi = `<label class="typed ${done ? (ok ? 'ok' : 'bad') : ''}">
          <span>Type your answer exactly as it would be displayed ${q.ask.kind === 'vars' ? `(e.g. <code>${q.ask.names.map((x, i) => `${x} = ${i + 1}`).join(', ')}</code>)` : ''}</span>
          <input id="typedAnswer" autocomplete="off" spellcheck="false" ${done ? 'disabled' : ''} value="${esc(this.answered?.typed ?? '')}" placeholder="your answer" />
        </label>
        ${done ? `<div class="key">Correct answer: <code>${esc(correctText(q))}</code></div>` : ''}`;
    } else {
      answerUi = `<div class="choices" role="radiogroup">${q.choices.map((c, i) => {
        let cls = '';
        if (done) cls = i === q.answer ? 'right' : i === this.answered!.choice ? 'wrong' : 'dim';
        else if (i === this.selected) cls = 'sel';
        return `<button class="choice ${cls}" data-a="choose" data-i="${i}" role="radio" aria-checked="${i === this.selected}" ${done ? 'tabindex="-1"' : ''}>
            <span class="letter">${LETTERS[i]}</span><code>${esc(c.text)}</code></button>`;
      }).join('')}</div>`;
    }

    let feedback = '';
    if (done) {
      const r = this.answered!;
      const chosen = r.choice !== null ? q.choices[r.choice] : null;
      const msg = r.peeked
        ? `<b>Marked missed.</b> Here's the answer and the full trace. Try tracing it along with the table below.`
        : r.correct
          ? `<b>Correct!</b> ${r.ms < 15000 && lv.minutes >= 1.5 ? 'Fast, too. ' : ''}`
          : `<b>Not quite.</b> The answer is <code>${esc(correctText(q))}</code>.${chosen?.why ? ` You picked ${LETTERS[r.choice!]}: that's what you'd get if ${esc(chosen.why)}.` : ''}`;
      const sol = solve(q);
      feedback = `<div class="feedback ${r.correct ? 'ok' : 'bad'}"><div>${msg}</div>
          ${r.leftPage ? `<div class="muted">🚪 You left this page ${r.leftPage === 1 ? 'once' : `${r.leftPage} times`} during the question.</div>` : ''}
          <button class="btn primary" data-a="next">${s.results.length >= SET_SIZE ? 'See results' : 'Next question'} →</button>
        </div>
        <section class="tr-card sol-card"><h3>Worked solution: the full trace table</h3>${solutionTable(sol, q.code)}</section>`;
    }

    const cols = q.variables;
    const tableRows = this.table.map((row, r) => `<tr>${row.map((v, c) => `<td><input data-r="${r}" data-c="${c}" value="${esc(v)}" spellcheck="false" autocomplete="off" aria-label="${c === 0 ? 'Line' : c === row.length - 1 ? 'Output' : cols[c - 1]} row ${r + 1}" /></td>`).join('')}</tr>`).join('');
    const hint = lv.hints && !done
      ? showHint || open?.hinted
        ? `<div class="hint-box">💡 Go line by line. Each time a variable gets a new value, write it in a new row of the table${q.code.includes('REPEAT') || q.code.includes('FOR EACH') ? ', and write a row for every pass through the loop: count the passes carefully, that is where most mistakes happen' : ''}${q.code.includes('[') ? '. Remember: the first item of a list is at index 1' : ''}.</div>`
        : `<button class="btn tiny ghost" data-a="hint">💡 Hint</button>`
      : '';

    return `
      <div class="tr-q">
        <section class="tr-card q-card">
          <div class="q-head"><span class="chip lv-${lv.id}">${lv.name}</span><span class="muted">Question ${n} of ${SET_SIZE}</span></div>
          <p class="stem">${esc(q.stem)}</p>
          <div class="exam-code" aria-label="Code segment">${highlightCode(q.code)}</div>
          ${answerUi}
          ${done ? '' : `<div class="q-actions">
              <button class="btn primary" data-a="submit" ${!q.typed && this.selected === null ? 'disabled' : ''}>Submit answer</button>
              ${hint}
              <span class="grow"></span>
              <button class="link" data-a="peek" title="Shows the answer, but the question counts as missed">I'm stuck: run it for me</button>
            </div>
            <div class="left-note" ${open?.leftPage ? '' : 'hidden'}>🚪 You left this page during the question. If you ran the code somewhere else, you only skipped the practice: on the exam you'll have to trace it.</div>`}
        </section>
        <section class="tr-card table-card">
          <h3>Your trace table <span class="muted">scratch work: not graded</span></h3>
          <div class="scratch-wrap"><table class="scratch"><thead><tr><th>Line</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}<th>Output</th></tr></thead><tbody>${tableRows}</tbody></table></div>
          <button class="btn tiny" data-a="row">+ Row</button>
          <p class="muted tip">Write the line number, then each variable's new value. Press Enter to go down a row.</p>
        </section>
        ${feedback ? `<div class="tr-feedback">${feedback}</div>` : ''}
      </div>`;
  }

  private resultsHtml() {
    const s = progress.session();
    if (!s) return this.homeHtml();
    const lv = levelById(s.level);
    const right = s.results.filter((r) => r.correct).length;
    const pct = Math.round((right / s.seeds.length) * 100);
    const secs = Math.round(s.results.reduce((a, r) => a + r.ms, 0) / 1000);
    const peeks = s.results.filter((r) => r.peeked || r.skipped).length;
    const lefts = s.results.reduce((a, r) => a + r.leftPage, 0);
    const next = LEVELS[LEVELS.findIndex((l) => l.id === lv.id) + 1];
    const rows = s.results.map((r, i) => {
      const q = generate(s.level, r.seed);
      const yours = r.peeked ? 'ran it' : r.skipped ? 'skipped' : r.typed !== null ? r.typed : r.choice !== null ? `${LETTERS[r.choice]}. ${q.choices[r.choice].text}` : '';
      return `<details class="rev ${r.correct ? 'ok' : 'bad'}">
        <summary><span class="mark">${r.correct ? '✓' : '✗'}</span> Question ${i + 1}
          <span class="muted">${Math.round(r.ms / 1000)}s${r.hinted ? ' · 💡' : ''}${r.leftPage ? ' · 🚪 left page' : ''}${r.peeked ? ' · 👁 ran it' : ''}${r.skipped ? ' · skipped' : ''}</span></summary>
        <div class="rev-body"><div class="exam-code small">${highlightCode(q.code)}</div>
          <p>Your answer: <code>${esc(yours)}</code> · Correct: <code>${esc(correctText(q))}</code></p></div>
      </details>`;
    }).join('');
    const verdict = pct >= 90 ? 'Exam ready at this level! 🎉' : pct >= 70 ? 'Solid. A bit more practice and this level is yours.' : 'Keep going: trace slowly, one line at a time.';
    return `
      <section class="tr-card results">
        <div class="score-big ${pct >= 70 ? 'ok' : 'bad'}">${right}<span>/ ${s.seeds.length}</span></div>
        <div><h2>${lv.name}: ${pct}%</h2><p>${verdict}</p>
          <p class="muted">${Math.floor(secs / 60)} min ${secs % 60} s total${peeks ? ` · ${peeks} run or skipped` : ''}${lefts ? ` · left the page ${lefts}×` : ''}</p>
          <div class="row">
            <button class="btn primary" data-a="again">Another ${lv.name} set</button>
            ${next ? `<button class="btn" data-a="nextLevel">Try ${next.name} →</button>` : ''}
            <button class="btn ghost" data-a="home">All levels</button>
          </div>
        </div>
      </section>
      <section class="tr-card"><h3>Review</h3>${rows}</section>`;
  }
}
