import { compile } from '../lang/compiler';
import { parse } from '../lang/parser';
import { traceRun } from '../lang/trace';
import { checkTyped, correctText, generate, normalizeAnswer } from './generate';
import { LEVELS } from './levels';
import { Rng } from './rng';

describe('question generator', () => {
  it.each(LEVELS.map((l) => [l.name, l.id] as const))('%s: 150 valid questions', (_, id) => {
    const codes = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const q = generate(id, seed);
      codes.add(q.code);
      // four different choices, exactly one of them correct
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices.map((c) => normalizeAnswer(c.text, q.ask))).size).toBe(4);
      // the key really is what the code produces
      const r = traceRun(compile(parse(q.code)), { maxRows: 0 });
      expect(r.error).toBeNull();
      if (q.ask.kind === 'output') expect(correctText(q)).toBe(r.output.join(' '));
      expect(checkTyped(q, correctText(q))).toBe(true);
      expect(q.choices.filter((_, i) => i !== q.answer).every((c) => !checkTyped(q, c.text))).toBe(true);
      // same seed, same question
      expect(generate(id, seed)).toEqual(q);
    }
    expect(codes.size).toBeGreaterThan(100); // plenty of variety
  });

  it('most wrong answers come from a named misconception', () => {
    let explained = 0, total = 0;
    for (const l of LEVELS) for (let s = 1; s <= 40; s++) {
      const q = generate(l.id, s);
      q.choices.forEach((c, i) => { if (i !== q.answer) { total++; if (c.why) explained++; } });
    }
    expect(explained / total).toBeGreaterThan(0.6);
  });

  it('accepts typed answers written different ways', () => {
    const q = { ask: { kind: 'vars', names: ['x', 'y'] }, choices: [{ text: 'x = 4, y = [1, 2]' }], answer: 0 } as never;
    expect(checkTyped(q, 'x = 4, y = [1,2]')).toBe(true);
    expect(checkTyped(q, '4, [1, 2]')).toBe(true);
    expect(checkTyped(q, '4 [1, 3]')).toBe(false);
    const o = { ask: { kind: 'output' }, choices: [{ text: '["a", "b"] true 7' }], answer: 0 } as never;
    expect(checkTyped(o, '[a, b] TRUE 7')).toBe(true);
    expect(checkTyped(o, '[a, b] true 77')).toBe(false);
  });

  it('rng is deterministic', () => {
    expect(new Rng(5).list(5, 1, 100)).toEqual(new Rng(5).list(5, 1, 100));
  });
});
