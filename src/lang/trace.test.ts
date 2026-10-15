import { compileSource } from './compiler';
import { traceRun } from './trace';

const run = (src: string, inputs: string[] = []) => traceRun(compileSource(src), { inputs });

describe('trace table', () => {
  it('records each statement and what it changed', () => {
    const { tracer, output } = run('a ← 3\nb ← a * 2\na ← a + b\nDISPLAY(a)');
    expect(tracer.rows.map((r) => [r.line, r.changes])).toEqual([
      [1, { a: '3' }],
      [2, { b: '6' }],
      [3, { a: '9' }],
      [4, {}],
    ]);
    expect(tracer.rows[3].output).toEqual(['9']);
    expect(output).toEqual(['9']);
    expect(tracer.columns.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('records conditions as written (IF and REPEAT UNTIL)', () => {
    const { tracer } = run('i ← 1\nREPEAT UNTIL (i > 2)\n{\n  i ← i + 1\n}\nIF (i = 3) { DISPLAY("yes") }');
    const conds = tracer.rows.filter((r) => r.cond !== undefined).map((r) => [r.line, r.cond]);
    expect(conds).toEqual([[2, false], [2, false], [2, true], [6, true]]);
  });

  it('counts how many times each line ran', () => {
    const { tracer } = run('n ← 0\nREPEAT 4 TIMES\n{\n  n ← n + 1\n}');
    expect(tracer.lineCounts.get(4)).toBe(4);
    expect(tracer.lineValues.get(4)).toEqual({ n: '4' });
  });

  it('gives a procedure result to the caller, and parameters their own column', () => {
    const { tracer } = run('a ← 2\nb ← double(a)\nPROCEDURE double(n)\n{\n  RETURN(n * 2)\n}');
    const line2 = tracer.rows.find((r) => r.line === 2)!;
    expect(line2.changes.b).toBe('4');
    expect(tracer.columns.map((c) => c.key)).toEqual(['a', 'n·double', 'b']);
    const ret = tracer.rows.find((r) => r.line === 5)!;
    expect(ret.scope).toBe('double');
    expect(ret.changes.b).toBeUndefined();
  });

  it('records inputs and asks for more when they run out', () => {
    const r = run('x ← INPUT()\ny ← INPUT()\nDISPLAY(x + y)', ['4', '5']);
    expect(r.output).toEqual(['9']);
    expect(r.tracer.rows[0].input).toEqual(['4']);
    const short = run('x ← INPUT()\ny ← INPUT()', ['4']);
    expect(short.needsInput).toBe(true);
    expect(short.error?.message).toMatch(/more INPUT/);
  });

  it('stops runaway loops and caps the table', () => {
    const r = traceRun(compileSource('REPEAT UNTIL (false) { x ← 1 }'), { maxRows: 50, maxInstructions: 100_000 });
    expect(r.error?.message).toMatch(/never ends/);
    expect(r.tracer.rows.length).toBe(50);
    expect(r.tracer.truncated).toBe(true);
  });

  it('reports runtime errors with the line', () => {
    const r = run('l ← [1]\nDISPLAY(l[2])');
    expect(r.error).toMatchObject({ line: 2 });
  });
});
