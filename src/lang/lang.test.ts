import { compileSource } from './compiler';
import { CompileError } from './errors';
import { parse } from './parser';
import { printProgram } from './printer';
import { Robot, type World } from './robot';
import { parseInput, type Value } from './values';
import { VM } from './vm';

function run(src: string, opts: { inputs?: string[]; world?: World; random?: () => number } = {}) {
  const out: string[] = [];
  const robot = opts.world ? new Robot(opts.world) : undefined;
  const vm = new VM(compileSource(src), { display: (t) => out.push(t), robot, random: opts.random });
  const inputs = [...(opts.inputs ?? [])];
  for (let guard = 0; guard < 100 && !vm.done; guard++) {
    vm.run(1e5);
    if (vm.status === 'input') vm.provideInput(parseInput(inputs.shift() ?? ''));
  }
  return { out: out.join(' '), error: vm.error?.message ?? null, errorLine: vm.error?.span.line, vm, robot };
}

const ok = (src: string, expected: string) => {
  const r = run(src);
  expect(r.error).toBeNull();
  expect(r.out).toBe(expected);
};
const fails = (src: string, pattern: RegExp, line?: number) => {
  const r = run(src);
  expect(r.error).toMatch(pattern);
  if (line) expect(r.errorLine).toBe(line);
};
const compileFails = (src: string, pattern: RegExp, line?: number) => {
  try {
    compileSource(src);
  } catch (e) {
    expect(e).toBeInstanceOf(CompileError);
    expect((e as Error).message).toMatch(pattern);
    if (line) expect((e as CompileError).span.line).toBe(line);
    return;
  }
  throw new Error('expected a compile error');
};

describe('assignment, display, arithmetic', () => {
  it('assigns with ← and <-', () => ok('a ← 3\nb <- a + 4\nDISPLAY(b)', '7'));
  it('follows precedence and real division', () => ok('DISPLAY(2 + 3 * 4)\nDISPLAY((2 + 3) * 4)\nDISPLAY(7 / 2)', '14 20 3.5'));
  it('MOD', () => ok('DISPLAY(17 MOD 5)\nDISPLAY(-7 MOD 3)', '2 2'));
  it('unary minus', () => ok('x ← 5\nDISPLAY(-x)\nDISPLAY(2 - -3)', '-5 5'));
  it('hides float noise', () => ok('DISPLAY(0.1 + 0.2)', '0.3'));
  it('joins text with + (extension)', () => ok('n ← 3\nDISPLAY("n is " + n)', 'n is 3'));
  it('divide by zero', () => fails('x ← 0\nDISPLAY(5 / x)', /divide by zero/, 2));
  it('unassigned variable', () => fails('DISPLAY(y)', /y hasn't been given a value/, 1));
  it('type errors', () => fails('DISPLAY("a" * 2)', /\* needs a number/));
  it('allows several statements on one line', () => ok('a ← 1 b ← 2 DISPLAY(a + b)', '3'));
  it('comments (extension)', () => ok('// hi\nDISPLAY(1) // there', '1'));
});

describe('relational and Boolean', () => {
  it('compares', () => ok('DISPLAY(3 = 3)\nDISPLAY(3 ≠ 3)\nDISPLAY(2 ≤ 3)\nDISPLAY(4 >= 5)\nDISPLAY("a" < "b")', 'true false true false true'));
  it('NOT AND OR', () => ok('DISPLAY(NOT (1 = 2))\nDISPLAY(true AND false)\nDISPLAY(false OR true)\nDISPLAY(NOT 1 = 2)', 'true false true true'));
  it('short-circuits', () => ok('x ← 0\nIF (x ≠ 0 AND 10 / x > 1) { DISPLAY("no") } ELSE { DISPLAY("safe") }', 'safe'));
  it('needs Booleans in conditions', () => fails('IF (1) { DISPLAY(1) }', /condition needs true or false/i));
  it('lists compare by contents', () => ok('DISPLAY([1, 2] = [1, 2])', 'true'));
  it('true/false any case', () => ok('DISPLAY(TRUE)\nDISPLAY(False)', 'true false'));
});

describe('selection and iteration', () => {
  it('IF / ELSE', () => ok('x ← 5\nIF (x > 3)\n{\n DISPLAY("big")\n}\nELSE\n{\n DISPLAY("small")\n}', 'big'));
  it('ELSE IF', () => ok('x ← 2\nIF (x = 1) { DISPLAY("one") } ELSE IF (x = 2) { DISPLAY("two") } ELSE { DISPLAY("many") }', 'two'));
  it('REPEAT n TIMES', () => ok('n ← 0\nREPEAT 4 TIMES { n ← n + 1 }\nDISPLAY(n)', '4'));
  it('REPEAT 0 TIMES', () => ok('REPEAT 0 TIMES { DISPLAY("x") }\nDISPLAY("done")', 'done'));
  it('REPEAT count must be a whole number', () => fails('REPEAT 2.5 TIMES { }', /whole number/));
  it('REPEAT UNTIL', () => ok('i ← 1\nREPEAT UNTIL (i > 3) { DISPLAY(i) i ← i + 1 }', '1 2 3'));
  it('nested loops', () => ok('REPEAT 2 TIMES { REPEAT 3 TIMES { DISPLAY("*") } }', '* * * * * *'));
});

describe('lists', () => {
  it('1-based indexing and assignment', () => ok('a ← [10, 20, 30]\nDISPLAY(a[1])\na[3] ← 99\nDISPLAY(a)', '10 [10, 20, 99]'));
  it('assignment copies the list', () => ok('a ← [1, 2]\nb ← a\nAPPEND(b, 3)\nDISPLAY(a)\nDISPLAY(b)', '[1, 2] [1, 2, 3]'));
  it('INSERT / APPEND / REMOVE / LENGTH', () =>
    ok('a ← []\nAPPEND(a, "x")\nAPPEND(a, "z")\nINSERT(a, 2, "y")\nDISPLAY(a)\nREMOVE(a, 1)\nDISPLAY(LENGTH(a))\nDISPLAY(a)', '["x", "y", "z"] 2 ["y", "z"]'));
  it('INSERT at the end', () => ok('a ← [1]\nINSERT(a, 2, 2)\nDISPLAY(a)', '[1, 2]'));
  it('index too big terminates', () => fails('a ← [1, 2, 3]\nDISPLAY(a[4])', /index 4 is out of range.*1 to 3.*terminates/, 2));
  it('index 0 terminates', () => fails('a ← [1]\na[0] ← 5', /index 0 is out of range/));
  it('REMOVE out of range', () => fails('a ← []\nREMOVE(a, 1)', /list is empty/));
  it('INSERT out of range', () => fails('a ← [1]\nINSERT(a, 3, 9)', /position 3 is out of range/));
  it('FOR EACH', () => ok('total ← 0\nFOR EACH n IN [3, 4, 5] { total ← total + n }\nDISPLAY(total)', '12'));
  it('FOR EACH item is a copy', () => ok('a ← [1, 2]\nFOR EACH x IN a { x ← 0 }\nDISPLAY(a)', '[1, 2]'));
  it('lists of lists', () => ok('g ← [[1, 2], [3, 4]]\ng[2][1] ← 9\nDISPLAY(g[2])', '[9, 4]'));
});

describe('procedures', () => {
  it('call before definition, RETURN', () =>
    ok('DISPLAY(square(5))\nPROCEDURE square(n)\n{\n RETURN(n * n)\n}', '25'));
  it('recursion', () => ok('PROCEDURE fact(n) { IF (n ≤ 1) { RETURN(1) } RETURN(n * fact(n - 1)) }\nDISPLAY(fact(6))', '720'));
  it('lists are passed by reference', () => ok('PROCEDURE addOne(l) { APPEND(l, 1) }\nx ← []\naddOne(x)\naddOne(x)\nDISPLAY(x)', '[1, 1]'));
  it('parameters are local', () => ok('n ← 1\nPROCEDURE f(n) { n ← 99 }\nf(5)\nDISPLAY(n)', '1'));
  it('assigning an existing global updates it', () => ok('count ← 0\nPROCEDURE bump() { count ← count + 1 }\nbump()\nbump()\nDISPLAY(count)', '2'));
  it('new names inside a procedure stay local', () => fails('PROCEDURE f() { t ← 1 }\nf()\nDISPLAY(t)', /t hasn't been given a value/));
  it('RETURN stops the procedure', () => ok('PROCEDURE f() { RETURN(1) DISPLAY("never") }\nDISPLAY(f())', '1'));
  it('using a missing return value', () => fails('PROCEDURE f() { x ← 1 }\ny ← f()', /f doesn't RETURN a value/));
  it('runaway recursion is caught', () => fails('PROCEDURE f(n) { RETURN(f(n + 1)) }\nDISPLAY(f(1))', /Too many procedure calls/));
});

describe('input and random', () => {
  it('INPUT turns numbers into numbers', () => {
    const r = run('a ← INPUT()\nb ← INPUT()\nDISPLAY(a + b)\nDISPLAY(INPUT())', { inputs: ['2', '3', 'hi'] });
    expect(r.out).toBe('5 hi');
  });
  it('RANDOM is inclusive', () => {
    expect(run('DISPLAY(RANDOM(1, 6))', { random: () => 0 }).out).toBe('1');
    expect(run('DISPLAY(RANDOM(1, 6))', { random: () => 0.9999 }).out).toBe('6');
  });
});

describe('compile errors', () => {
  it('= for assignment', () => compileFails('x = 5', /use ←/));
  it('== for comparison', () => compileFails('IF (x == 5) { }', /single =/));
  it('lowercase keyword', () => compileFails('if (true) { }', /capitals: write IF/));
  it('unknown procedure with a hint', () => compileFails('x ← 1\ndisplay(x)', /Did you mean DISPLAY/, 2));
  it('wrong argument count', () => compileFails('APPEND([1])', /APPEND takes 2 inputs/));
  it('non-value builtin in expression', () => compileFails('x ← DISPLAY(1)', /doesn't produce a value/));
  it('unclosed brace', () => compileFails('IF (true)\n{\n DISPLAY(1)', /never closed/, 2));
  it('missing quote', () => compileFails('DISPLAY("hi)', /closing quote/));
  it('RETURN outside a procedure', () => compileFails('RETURN(1)', /inside a PROCEDURE/));
  it('nested PROCEDURE', () => compileFails('IF (true) { PROCEDURE f() { } }', /top level/));
  it('procedure named like a builtin', () => compileFails('PROCEDURE LENGTH(x) { }', /built-in/));
});

describe('robot', () => {
  const world: World = { width: 3, height: 3, walls: ['1,1'], start: { x: 0, y: 2, dir: 0 }, goal: { x: 2, y: 0 } };
  it('moves, turns and senses', () => {
    const r = run('MOVE_FORWARD()\nMOVE_FORWARD()\nROTATE_RIGHT()\nDISPLAY(CAN_MOVE(forward))\nMOVE_FORWARD()\nMOVE_FORWARD()\nDISPLAY(CAN_MOVE(left))', { world });
    expect(r.error).toBeNull();
    expect(r.out).toBe('true false');
    expect(r.robot!.atGoal()).toBe(true);
  });
  it('blocked move terminates', () => {
    const r = run('ROTATE_RIGHT()\nMOVE_FORWARD()\nROTATE_LEFT()\nMOVE_FORWARD()', { world });
    expect(r.error).toMatch(/blocked square.*terminates/);
    expect([r.robot!.x, r.robot!.y]).toEqual([1, 2]);
  });
  it('edge terminates', () => {
    const r = run('ROTATE_LEFT()\nMOVE_FORWARD()', { world });
    expect(r.error).toMatch(/off the edge/);
  });
  it('maze solver', () => {
    const r = run(
      'REPEAT UNTIL (NOT CAN_MOVE(forward) AND NOT CAN_MOVE(right)) {\n IF (CAN_MOVE(forward)) { MOVE_FORWARD() } ELSE { ROTATE_RIGHT() }\n}',
      { world: { ...world, walls: ['1,1', '1,2', '2,1', '2,2'] } },
    );
    expect(r.error).toBeNull();
    expect(r.robot!.atGoal()).toBe(true);
  });
});

describe('debugger stepping', () => {
  const src = 'a ← 1\nb ← double(a)\nDISPLAY(b)\nPROCEDURE double(n)\n{\n  RETURN(n * 2)\n}';
  const lines = (mode: 'into' | 'over') => {
    const vm = new VM(compileSource(src), { display: () => {} });
    const seen: number[] = [];
    while (!vm.done && seen.length < 20) {
      vm.run(1e6, mode);
      if (vm.status === 'paused') seen.push(vm.current!.span.line);
    }
    return seen;
  };
  it('step into enters procedures', () => expect(lines('into')).toEqual([1, 2, 6, 3]));
  it('step over skips them', () => expect(lines('over')).toEqual([1, 2, 3]));
  it('breakpoints stop the run', () => {
    const vm = new VM(compileSource(src), { display: () => {} });
    vm.breakpoints.add(6);
    expect(vm.run(1e6)).toBe('paused');
    expect(vm.current!.span.line).toBe(6);
    expect(vm.frames.length).toBe(2);
    expect(vm.scopes()[0].vars).toEqual([['n', 1]]);
    expect(vm.run(1e6)).toBe('done');
  });
  it('a breakpoint on line 1 stops before anything runs', () => {
    const vm = new VM(compileSource(src), { display: () => {} });
    vm.breakpoints.add(1);
    vm.run(1e6);
    expect(vm.current!.span.line).toBe(1);
    expect(vm.globals.size).toBe(0);
  });
  it('infinite loops yield back after the budget', () => {
    const vm = new VM(compileSource('REPEAT UNTIL (false) { x ← 1 }'), { display: () => {} });
    expect(vm.run(10000)).toBe('paused');
  });
});

describe('printer', () => {
  const samples = [
    'a ← (1 + 2) * 3 - (4 - 5)',
    'IF (NOT (a = b) AND c) { x ← [1, "two", true] } ELSE { IF (d) { y ← -x } }',
    'REPEAT UNTIL (i > LENGTH(list)) { list[i] ← list[i] MOD 2 }',
    'FOR EACH item IN data { DISPLAY(item) }\nPROCEDURE f(a, b) { RETURN(a / (b * 2)) }\nREPEAT 3 TIMES { f(1, 2) }',
    'x ← a - (b - c) + -d',
  ];
  const strip = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(strip) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'span' && k !== 'id' && k !== 'nameSpan').map(([k, x]) => [k, strip(x)]))
      : v;
  it.each(samples)('round-trips %s', (src) => {
    const p = parse(src);
    const printed = printProgram(p);
    expect(strip(parse(printed))).toEqual(strip(p));
    expect(printProgram(parse(printed))).toBe(printed);
  });
});

it('parseInput', () => {
  const cases: [string, Value][] = [['42', 42], ['-1.5', -1.5], ['true', true], ['hello', 'hello'], ['', '']];
  for (const [i, v] of cases) expect(parseInput(i)).toEqual(v);
});
