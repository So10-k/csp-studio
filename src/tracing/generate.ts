import type { Program, Stmt } from '../lang/ast';
import { compile, type Compiled } from '../lang/compiler';
import { NO_SPAN } from '../lang/errors';
import { parse } from '../lang/parser';
import { printProgram } from '../lang/printer';
import { traceRun } from '../lang/trace';
import { levelById, type Ask, type LevelId } from './levels';
import { mutants } from './mutate';
import { Rng } from './rng';

export interface Choice {
  text: string;
  /** for a wrong choice: the mistake that leads to it */
  why?: string;
}

export interface Question {
  level: LevelId;
  seed: number;
  code: string;
  stem: string;
  ask: Ask;
  choices: Choice[];
  /** index of the correct choice */
  answer: number;
  /** the student types the answer instead of choosing */
  typed: boolean;
  /** variables, in order of appearance (columns for the trace table) */
  variables: string[];
}

const STEM_OUTPUT = 'What is displayed as a result of running the code segment?';
const MAX_ANSWER = 48;

/** Run a program and turn the result into answer text (null if it errors or runs too long). */
function evaluate(p: Program, ask: Ask): string | null {
  const prog: Program = structuredClone(p);
  if (ask.kind === 'vars') {
    for (const n of ask.names) {
      prog.body.push({ id: `q${n}`, span: NO_SPAN, kind: 'expr', expr: { kind: 'call', name: 'DISPLAY', args: [{ kind: 'var', name: n, span: NO_SPAN }], span: NO_SPAN, nameSpan: NO_SPAN } } as Stmt);
    }
  }
  let c: Compiled;
  try { c = compile(prog); } catch { return null; }
  const r = traceRun(c, { maxRows: 0, maxInstructions: 200_000 });
  if (r.error || !r.output.length) return null;
  if (ask.kind === 'vars') {
    const vals = r.output.slice(-ask.names.length);
    return ask.names.map((n, i) => `${n} = ${vals[i]}`).join(', ');
  }
  return r.output.join(' ');
}

/** Wrong answers that look like right ones, when the mistakes don't give enough. */
function perturb(truth: string, r: Rng): string {
  const parts = truth.split(/(-?\d+(?:\.\d+)?|true|false)/);
  const idx = parts.map((p, i) => (/^(-?\d+(\.\d+)?|true|false)$/.test(p) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return truth + ' ' + truth.split(' ')[0];
  const i = r.pick(idx);
  const p = parts[i];
  if (p === 'true' || p === 'false') parts[i] = p === 'true' ? 'false' : 'true';
  else parts[i] = String(Number(p) + r.pick([-2, -1, 1, 2, 10]));
  return parts.join('');
}

function variablesOf(p: Program): string[] {
  const seen: string[] = [];
  const visit = (stmts: Stmt[]) => stmts.forEach((s) => {
    if (s.kind === 'assign' && s.target.kind === 'var' && !seen.includes(s.target.name)) seen.push(s.target.name);
    if (s.kind === 'foreach' && !seen.includes(s.item)) seen.push(s.item);
    if (s.kind === 'proc') { s.params.forEach((x) => { if (!seen.includes(x)) seen.push(x); }); visit(s.body); }
    if (s.kind === 'if') { visit(s.then); if (s.else) visit(s.else); }
    if (s.kind === 'repeat' || s.kind === 'until' || s.kind === 'foreach') visit(s.body);
  });
  visit(p.body);
  return seen;
}

/** Build question `seed` of a level. Deterministic: the same seed always gives the same question. */
export function generate(level: LevelId, seed: number): Question {
  const lv = levelById(level);
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = new Rng(seed * 1009 + attempt * 7919 + 17);
    const t = r.pick(lv.templates)(r);
    const program = parse(printProgram(parse(t.code)));
    const truth = evaluate(program, t.ask);
    if (!truth || truth.length > MAX_ANSWER) continue;

    // wrong answers from misconceptions, then near-misses
    const wrong = new Map<string, string | undefined>();
    for (const m of r.shuffle(mutants(program))) {
      const v = evaluate(m.program, t.ask);
      if (v && v !== truth && v.length <= MAX_ANSWER && !wrong.has(v)) wrong.set(v, m.why);
    }
    // prefer distractors with different explanations
    const picked: Choice[] = [];
    const usedWhy = new Set<string>();
    for (const [text, why] of wrong) if (picked.length < 3 && why && !usedWhy.has(why)) { picked.push({ text, why }); usedWhy.add(why); }
    for (const [text, why] of wrong) if (picked.length < 3 && !picked.some((c) => c.text === text)) picked.push({ text, why });
    for (let k = 0; picked.length < 3 && k < 50; k++) {
      const v = perturb(truth, r);
      if (v !== truth && !picked.some((c) => c.text === v)) picked.push({ text: v });
    }
    if (picked.length < 3) continue;

    const choices = r.shuffle([{ text: truth }, ...picked]);
    const stem = t.ask.kind === 'output' ? STEM_OUTPUT : `What are the values of ${t.ask.names.join(' and ')} after the code segment runs?`;
    return {
      level, seed, code: printProgram(program).trimEnd(), stem, ask: t.ask, choices,
      answer: choices.findIndex((c) => c.text === truth),
      typed: r.chance(lv.typed),
      variables: variablesOf(program),
    };
  }
  throw new Error(`could not generate a ${level} question for seed ${seed}`);
}

export function correctText(q: Question): string {
  return q.choices[q.answer].text;
}

/** Normalize an answer so harmless differences (spacing, quotes, "x =") don't matter. */
export function normalizeAnswer(s: string, ask: Ask): string {
  let t = s.trim().replace(/[“”]/g, '"');
  if (ask.kind === 'vars') {
    // accept "x = 4, y = 9" or just "4, 9" / "4 9"
    for (const n of ask.names) t = t.replace(new RegExp(`\\b${n}\\s*[=:]\\s*`, 'g'), '');
    t = t.replace(/,/g, ' ');
  }
  return t
    .replace(/"/g, '')
    .replace(/\s*,\s*/g, ',')
    .replace(/\[\s*/g, '[').replace(/\s*\]/g, ']')
    .replace(/\s+/g, ' ')
    .replace(/\b(true|false)\b/gi, (m) => m.toLowerCase())
    .trim();
}

export function checkTyped(q: Question, typed: string): boolean {
  return normalizeAnswer(typed, q.ask) === normalizeAnswer(correctText(q), q.ask);
}

/** The worked solution: the code's trace table. */
export function solve(q: Question) {
  return traceRun(compile(parse(q.code)), { maxRows: 400 });
}
