import { autocompletion, completeFromList, type Completion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { EditorState, RangeSet, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration, drawSelection, EditorView, gutter, GutterMarker, highlightActiveLine, highlightActiveLineGutter,
  keymap, lineNumbers, type DecorationSet,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { BUILTINS } from '../lang/ast';
import type { Span } from '../lang/errors';
import { KEYWORDS } from '../lang/lexer';

// ── syntax highlighting ────────────────────────────────────────
const lang = StreamLanguage.define<{ afterProc: boolean }>({
  startState: () => ({ afterProc: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^[0-9]+(\.[0-9]+)?/)) return 'number';
    if (stream.match(/^["“”][^"“”\n]*["“”]?/)) return 'string';
    if (stream.match(/^(<-|←|!=|≠|<=|≤|>=|≥|[+\-*/=<>×÷])/)) return 'operator';
    const w = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/) as RegExpMatchArray | null;
    if (w) {
      const word = w[0];
      if (state.afterProc) { state.afterProc = false; return 'def'; }
      if (word === 'PROCEDURE') { state.afterProc = true; return 'keyword'; }
      if (/^(true|false)$/i.test(word)) return 'atom';
      if (KEYWORDS.has(word)) return 'keyword';
      if (BUILTINS[word]) return 'builtin';
      if (stream.peek() === '(') return 'def';
      return 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
});

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--syn-kw)', fontWeight: '700' },
  { tag: t.number, color: 'var(--syn-num)' },
  { tag: t.string, color: 'var(--syn-str)' },
  { tag: t.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: t.operator, color: 'var(--syn-op)', fontWeight: '700' },
  { tag: t.atom, color: 'var(--syn-num)', fontWeight: '600' },
  { tag: t.standard(t.variableName), color: 'var(--syn-builtin)', fontWeight: '600' },
  { tag: t.definition(t.variableName), color: 'var(--syn-def)', fontWeight: '700' },
  { tag: t.variableName, color: 'var(--ink)' },
]);

// ── breakpoints ────────────────────────────────────────────────
const breakpointEffect = StateEffect.define<{ pos: number; on: boolean }>({
  map: (v, m) => ({ pos: m.mapPos(v.pos), on: v.on }),
});
const breakpointMarker = new (class extends GutterMarker {
  toDOM() {
    const d = document.createElement('div');
    d.className = 'bp-dot';
    return d;
  }
})();
const breakpointState = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(breakpointEffect)) continue;
      set = e.value.on ? set.update({ add: [breakpointMarker.range(e.value.pos)] }) : set.update({ filter: (from) => from !== e.value.pos });
    }
    return set;
  },
});

// ── execution line ─────────────────────────────────────────────
const execEffect = StateEffect.define<{ line: number; kind: 'run' | 'error' } | null>();
const execState = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(execEffect)) continue;
      if (!e.value || e.value.line < 1 || e.value.line > tr.state.doc.lines) { deco = Decoration.none; continue; }
      const line = tr.state.doc.line(e.value.line);
      deco = Decoration.set([Decoration.line({ class: e.value.kind === 'error' ? 'cm-exec-error' : 'cm-exec' }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const completions: Completion[] = [
  ...[...KEYWORDS].filter((k) => k !== 'TRUE' && k !== 'FALSE').map((k) => ({ label: k, type: 'keyword' })),
  ...Object.keys(BUILTINS).map((b) => ({ label: b, type: 'function', apply: `${b}(` })),
  { label: 'true', type: 'constant' },
  { label: 'false', type: 'constant' },
];

export interface CodeEditor {
  view: EditorView;
  getText(): string;
  /** Replace the whole document (does not fire onChange). */
  setText(text: string): void;
  setError(err: { message: string; span: Span } | null): void;
  setExecLine(line: number | null, kind?: 'run' | 'error'): void;
  insert(text: string): void;
  breakpoints(): Set<number>;
  setBreakpoints(lines: number[]): void;
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  on: { change(text: string): void; breakpoints(lines: Set<number>): void },
): CodeEditor {
  let silent = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        gutter({
          class: 'cm-bp-gutter',
          markers: (v) => v.state.field(breakpointState),
          initialSpacer: () => breakpointMarker,
          domEventHandlers: {
            mousedown(v, line) {
              toggleBreakpoint(v, line.from);
              return true;
            },
          },
        }),
        breakpointState,
        lineNumbers({
          domEventHandlers: {
            mousedown(v, line) {
              toggleBreakpoint(v, line.from);
              return true;
            },
          },
        }),
        execState,
        lintGutter(),
        history(),
        drawSelection(),
        indentOnInput(),
        indentUnit.of('    '),
        bracketMatching(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        lang,
        syntaxHighlighting(highlight),
        autocompletion({ override: [completeFromList(completions)] }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !silent) on.change(u.state.doc.toString());
          if (u.transactions.some((tr) => tr.effects.some((e) => e.is(breakpointEffect))) || (u.docChanged && hasBreakpoints(u.state))) {
            on.breakpoints(lines(u.state));
          }
        }),
      ],
    }),
  });

  function toggleBreakpoint(v: EditorView, pos: number) {
    let has = false;
    v.state.field(breakpointState).between(pos, pos, () => { has = true; });
    v.dispatch({ effects: breakpointEffect.of({ pos, on: !has }) });
  }
  function hasBreakpoints(s: EditorState) {
    return s.field(breakpointState).size > 0;
  }
  function lines(s: EditorState): Set<number> {
    const out = new Set<number>();
    const iter = s.field(breakpointState).iter();
    for (; iter.value; iter.next()) out.add(s.doc.lineAt(iter.from).number);
    return out;
  }

  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(text) {
      if (text === view.state.doc.toString()) return;
      silent = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      silent = false;
    },
    setError(err) {
      const diags: Diagnostic[] = [];
      if (err) {
        const len = view.state.doc.length;
        const from = Math.min(err.span.from, len);
        const to = Math.min(Math.max(err.span.to, from + 1), len);
        diags.push({ from, to: Math.max(to, from), severity: 'error', message: err.message });
      }
      view.dispatch(setDiagnostics(view.state, diags));
    },
    setExecLine(line, kind = 'run') {
      view.dispatch({ effects: execEffect.of(line ? { line, kind } : null) });
      if (line && line <= view.state.doc.lines) {
        const pos = view.state.doc.line(line).from;
        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest' }) });
      }
    },
    insert(text) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    breakpoints: () => lines(view.state),
    setBreakpoints(ls) {
      const effects = ls
        .filter((l) => l >= 1 && l <= view.state.doc.lines)
        .map((l) => breakpointEffect.of({ pos: view.state.doc.line(l).from, on: true }));
      if (effects.length) view.dispatch({ effects });
    },
  };
}
