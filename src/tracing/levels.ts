import type { Rng } from './rng';

export type LevelId = 'basic' | 'easy' | 'medium' | 'hard' | 'extra' | 'advanced' | 'challenging';

/** What the question asks for. */
export type Ask =
  | { kind: 'output' }
  | { kind: 'vars'; names: string[] };

export interface Template {
  code: string;
  ask: Ask;
}

export interface Level {
  id: LevelId;
  name: string;
  topics: string;
  /** share of questions that need a typed answer instead of multiple choice */
  typed: number;
  /** a hint is offered on these levels */
  hints: boolean;
  /** suggested minutes per question (the AP exam averages a bit over 1 minute) */
  minutes: number;
  templates: ((r: Rng) => Template)[];
}

const NAMES = ['a', 'b', 'c', 'x', 'y', 'z', 'n', 'm', 'p', 'q', 'num', 'val', 'count', 'total', 'w', 'k'];
const names = (r: Rng, k: number) => r.sample(NAMES, k);
const out: Ask = { kind: 'output' };
const vars = (...names: string[]): Ask => ({ kind: 'vars', names });
const L = (xs: (number | string)[]) => `[${xs.map((x) => (typeof x === 'string' ? `"${x}"` : x)).join(', ')}]`;

export const LEVELS: Level[] = [
  {
    id: 'basic', name: 'Basic', topics: 'Assignment, arithmetic, DISPLAY', typed: 0, hints: true, minutes: 1,
    templates: [
      (r) => {
        const [a, b] = names(r, 2);
        return { code: `${a} ← ${r.int(2, 9)}\n${b} ← ${r.int(2, 9)}\n${a} ← ${a} + ${b}\n${b} ← ${a} - ${b}\nDISPLAY(${a})\nDISPLAY(${b})`, ask: out };
      },
      (r) => {
        const [x, y] = names(r, 2);
        return { code: `${x} ← ${r.int(1, 8)}\n${y} ← ${x} * ${r.int(2, 4)}\n${x} ← ${y} - ${x}\n${y} ← ${x} + ${y}`, ask: vars(x, y) };
      },
      (r) => {
        const [n] = names(r, 1);
        return { code: `${n} ← ${r.int(2, 9)}\n${n} ← ${n} + ${r.int(1, 6)}\n${n} ← ${n} * ${r.int(2, 3)}\n${n} ← ${n} - ${r.int(1, 9)}\nDISPLAY(${n})`, ask: out };
      },
      (r) => {
        const [a, b, c] = names(r, 3);
        // a swap with a temporary variable (sometimes done wrong on purpose)
        const right = r.chance(0.6);
        return {
          code: right
            ? `${a} ← ${r.int(1, 9)}\n${b} ← ${r.int(10, 20)}\n${c} ← ${a}\n${a} ← ${b}\n${b} ← ${c}`
            : `${a} ← ${r.int(1, 9)}\n${b} ← ${r.int(10, 20)}\n${a} ← ${b}\n${b} ← ${a}`,
          ask: vars(a, b),
        };
      },
      (r) => {
        const [x, y] = names(r, 2);
        const n = r.int(11, 30), d = r.pick([3, 4, 5, 6]);
        return { code: `${x} ← ${n} MOD ${d}\n${y} ← ${n} / ${d * 1}\n${x} ← ${x} + ${y}\nDISPLAY(${x})`, ask: out };
      },
    ],
  },
  {
    id: 'easy', name: 'Easy', topics: 'IF / ELSE, relational operators, MOD, AND / OR / NOT', typed: 0, hints: true, minutes: 1,
    templates: [
      (r) => {
        const [x] = names(r, 1);
        return { code: `${x} ← ${r.int(3, 30)}\nIF (${x} MOD 2 = 0)\n{\n${x} ← ${x} / 2\n}\nELSE\n{\n${x} ← 3 * ${x} + 1\n}\nDISPLAY(${x})`, ask: out };
      },
      (r) => {
        const [a, b] = names(r, 2);
        const va = r.int(1, 20), vb = r.chance(0.25) ? va : r.int(1, 20);
        return { code: `${a} ← ${va}\n${b} ← ${vb}\nIF (${a} > ${b})\n{\nDISPLAY(${a} - ${b})\n}\nELSE\n{\nDISPLAY(${b} - ${a})\n}`, ask: out };
      },
      (r) => {
        const s = r.pick([79, 80, 81, 89, 90, 91, 95, 70, 85]);
        return {
          code: `score ← ${s}\nIF (score ≥ 90)\n{\ngrade ← "A"\n}\nELSE\n{\nIF (score ≥ 80)\n{\ngrade ← "B"\n}\nELSE\n{\ngrade ← "C"\n}\n}\nDISPLAY(grade)`,
          ask: out,
        };
      },
      (r) => {
        const [x, y] = names(r, 2);
        const vx = r.int(1, 9), vy = r.int(1, 12);
        return {
          code: `${x} ← ${vx}\n${y} ← ${vy}\nIF (${x} < ${y} AND ${y} < 10)\n{\n${x} ← ${x} + ${y}\n}\nIF (${x} > 10 OR ${y} = ${vy})\n{\n${y} ← ${y} * 2\n}`,
          ask: vars(x, y),
        };
      },
      (r) => {
        const [n, c] = names(r, 2);
        return {
          code: `${n} ← ${r.int(5, 30)}\n${c} ← 0\nIF (NOT (${n} MOD 3 = 0))\n{\n${c} ← ${c} + 1\n}\nIF (${n} MOD 5 = 0)\n{\n${c} ← ${c} + 10\n}\nDISPLAY(${c})`,
          ask: out,
        };
      },
    ],
  },
  {
    id: 'medium', name: 'Medium', topics: 'REPEAT n TIMES, REPEAT UNTIL, counters and accumulators', typed: 0, hints: true, minutes: 1.5,
    templates: [
      (r) => {
        const k = r.int(1, 3);
        return { code: `sum ← 0\ni ← ${r.int(0, 3)}\nREPEAT ${r.int(3, 5)} TIMES\n{\nsum ← sum + i\ni ← i + ${k}\n}\nDISPLAY(sum)`, ask: out };
      },
      (r) => {
        const [x] = names(r, 1);
        return { code: `${x} ← ${r.int(1, 5)}\nREPEAT UNTIL (${x} > ${r.int(20, 60)})\n{\n${x} ← ${x} * 2\n}\nDISPLAY(${x})`, ask: out };
      },
      (r) => {
        const [n, c] = names(r, 2);
        return { code: `${n} ← ${r.int(15, 40)}\n${c} ← 0\nREPEAT UNTIL (${n} ≤ ${r.int(0, 5)})\n{\n${n} ← ${n} - ${r.int(3, 7)}\n${c} ← ${c} + 1\n}\nDISPLAY(${c})\nDISPLAY(${n})`, ask: out };
      },
      (r) => {
        const [a, b, t] = ['a', 'b', 't'];
        return { code: `${a} ← ${r.int(0, 2)}\n${b} ← 1\nREPEAT ${r.int(3, 5)} TIMES\n{\n${t} ← ${a}\n${a} ← ${b}\n${b} ← ${t} + ${b}\n}`, ask: vars(a, b) };
      },
      (r) => {
        const [x] = names(r, 1);
        return { code: `${x} ← ${r.int(0, 3)}\nREPEAT ${r.int(4, 6)} TIMES\n{\nIF (${x} MOD 2 = 0)\n{\n${x} ← ${x} + 3\n}\nELSE\n{\n${x} ← ${x} - 1\n}\n}\nDISPLAY(${x})`, ask: out };
      },
      (r) => {
        const s = r.int(1, 4), k = r.int(2, 3);
        return { code: `i ← ${s}\nREPEAT UNTIL (i > ${s + k * r.int(2, 4)})\n{\nDISPLAY(i)\ni ← i + ${k}\n}`, ask: out };
      },
    ],
  },
  {
    id: 'hard', name: 'Hard', topics: 'Lists: indexes from 1, APPEND / INSERT / REMOVE / LENGTH, FOR EACH', typed: 0.15, hints: false, minutes: 1.5,
    templates: [
      (r) => {
        const xs = r.list(5, 1, 20);
        const [i, j, k] = [r.int(1, 5), r.int(1, 5), r.int(1, 5)];
        return { code: `list ← ${L(xs)}\nDISPLAY(list[${i}])\nlist[${j}] ← list[${k}] + 1\nDISPLAY(list)`, ask: out };
      },
      (r) => {
        const xs = r.list(3, 1, 9);
        return { code: `list ← ${L(xs)}\nAPPEND(list, ${r.int(10, 20)})\nINSERT(list, ${r.int(1, 3)}, ${r.int(21, 30)})\nREMOVE(list, ${r.int(1, 4)})\nDISPLAY(list)`, ask: out };
      },
      (r) => {
        const xs = r.list(6, 1, 15), t = r.int(5, 10);
        return { code: `nums ← ${L(xs)}\ntotal ← 0\nFOR EACH n IN nums\n{\nIF (n > ${t})\n{\ntotal ← total + n\n}\n}\nDISPLAY(total)`, ask: out };
      },
      (r) => {
        const xs = r.list(5, 1, 9);
        return { code: `list ← ${L(xs)}\ni ← ${r.int(1, 2)}\nREPEAT UNTIL (i > LENGTH(list))\n{\nlist[i] ← list[i] * 2\ni ← i + 2\n}\nDISPLAY(list)`, ask: out };
      },
      (r) => {
        const xs = r.list(3, 1, 9);
        return { code: `a ← ${L(xs)}\nb ← a\nAPPEND(b, ${r.int(1, 9)})\nb[1] ← ${r.int(10, 20)}\nDISPLAY(LENGTH(a))\nDISPLAY(a[1])`, ask: out };
      },
      (r) => {
        const pool = ['cat', 'dog', 'owl'];
        const ws = Array.from({ length: 6 }, () => r.pick(pool));
        const target = r.pick(pool);
        return { code: `words ← ${L(ws)}\ncount ← 0\nFOR EACH w IN words\n{\nIF (w = "${target}")\n{\ncount ← count + 1\n}\n}\nDISPLAY(count)`, ask: out };
      },
    ],
  },
  {
    id: 'extra', name: 'Extra Hard', topics: 'Nested loops, nested IFs, Boolean logic, changing lists inside loops', typed: 0.25, hints: false, minutes: 2,
    templates: [
      (r) => ({ code: `count ← 0\nREPEAT ${r.int(2, 4)} TIMES\n{\nREPEAT ${r.int(2, 4)} TIMES\n{\ncount ← count + 1\n}\ncount ← count * 2\n}\nDISPLAY(count)`, ask: out }),
      (r) => {
        const xs = r.list(5, -9, 9);
        return { code: `nums ← ${L(xs)}\nbest ← 0\nFOR EACH n IN nums\n{\nIF (n > best)\n{\nbest ← n\n}\n}\nDISPLAY(best)`, ask: out };
      },
      (r) => {
        const xs = r.list(6, 1, 20), k = r.int(8, 14);
        return { code: `nums ← ${L(xs)}\nresult ← []\nFOR EACH n IN nums\n{\nIF (n MOD 2 = 0 OR n > ${k})\n{\nINSERT(result, 1, n)\n}\n}\nDISPLAY(result)`, ask: out };
      },
      (r) => {
        const xs = r.list(5, 1, 9);
        return { code: `list ← ${L(xs)}\ni ← 1\nj ← LENGTH(list)\nREPEAT UNTIL (i ≥ j)\n{\ntemp ← list[i]\nlist[i] ← list[j]\nlist[j] ← temp\ni ← i + 1\nj ← j - 1\n}\nDISPLAY(list)`, ask: out };
      },
      (r) => {
        const v = r.int(1, 3);
        const xs = r.shuffle([v, v, r.int(4, 9), v, r.int(4, 9), r.int(4, 9)]);
        return { code: `list ← ${L(xs)}\ni ← 1\nREPEAT UNTIL (i > LENGTH(list))\n{\nIF (list[i] = ${v})\n{\nREMOVE(list, i)\n}\ni ← i + 1\n}\nDISPLAY(list)`, ask: out };
      },
      (r) => ({
        code: `a ← ${r.pick(['true', 'false'])}\nb ← ${r.pick(['true', 'false'])}\nREPEAT ${r.int(2, 4)} TIMES\n{\ntemp ← a\na ← b OR NOT a\nb ← temp AND NOT b\n}`,
        ask: vars('a', 'b'),
      }),
    ],
  },
  {
    id: 'advanced', name: 'Advanced', topics: 'Procedures, parameters, RETURN, lists passed to procedures', typed: 0.35, hints: false, minutes: 2,
    templates: [
      (r) => {
        const k = r.int(2, 3);
        return { code: `PROCEDURE f(x, y)\n{\nRETURN(x * ${k} + y)\n}\nDISPLAY(f(f(${r.int(1, 5)}, ${r.int(1, 5)}), ${r.int(1, 5)}))`, ask: out };
      },
      (r) => {
        const xs = r.list(3, 1, 9);
        return {
          code: `PROCEDURE addTo(list, v)\n{\nAPPEND(list, v)\nRETURN(LENGTH(list))\n}\nnums ← ${L(xs)}\nn ← addTo(nums, ${r.int(1, 9)})\nn ← n + addTo(nums, ${r.int(1, 9)})\nDISPLAY(n)\nDISPLAY(LENGTH(nums))`,
          ask: out,
        };
      },
      (r) => {
        const a = r.int(1, 9), k = r.int(5, 20);
        return { code: `x ← ${a}\nPROCEDURE change(x)\n{\nx ← x + ${k}\nRETURN(x * 2)\n}\ny ← change(x)\nDISPLAY(x)\nDISPLAY(y)`, ask: out };
      },
      (r) => {
        const xs = r.sample([2, 4, 6, 8, 10, 12, 14, 16, 18], 5);
        const hit = r.pick(xs), miss = 3;
        return {
          code: `PROCEDURE find(list, target)\n{\ni ← 1\nREPEAT UNTIL (i > LENGTH(list))\n{\nIF (list[i] = target)\n{\nRETURN(i)\n}\ni ← i + 1\n}\nRETURN(-1)\n}\ndata ← ${L(xs)}\nDISPLAY(find(data, ${hit}))\nDISPLAY(find(data, ${miss}))`,
          ask: out,
        };
      },
      (r) => ({
        code: `PROCEDURE step(n)\n{\nIF (n MOD 2 = 0)\n{\nRETURN(n / 2)\n}\nRETURN(3 * n + 1)\n}\nx ← ${r.int(3, 12)}\nREPEAT ${r.int(3, 4)} TIMES\n{\nx ← step(x)\nDISPLAY(x)\n}`,
        ask: out,
      }),
      (r) => {
        const xs = r.list(5, 1, 9);
        return {
          code: `PROCEDURE countIf(list, limit)\n{\ncount ← 0\nFOR EACH item IN list\n{\nIF (item ≥ limit)\n{\ncount ← count + 1\n}\n}\nRETURN(count)\n}\nvals ← ${L(xs)}\nDISPLAY(countIf(vals, ${r.int(3, 7)}))\nDISPLAY(countIf(vals, ${r.int(1, 3)}))`,
          ask: out,
        };
      },
    ],
  },
  {
    id: 'challenging', name: 'Challenging', topics: 'Recursion, nested procedure calls, multi-step list algorithms', typed: 0.5, hints: false, minutes: 2.5,
    templates: [
      (r) => {
        const k = r.int(1, 2), base = r.int(0, 2), op = r.pick(['+', '*']);
        return { code: `PROCEDURE r(n)\n{\nIF (n ≤ ${base + 1})\n{\nRETURN(${base + 1})\n}\nRETURN(n ${op} r(n - ${k}))\n}\nDISPLAY(r(${r.int(4, 7)}))`, ask: out };
      },
      (r) => {
        const xs = r.list(r.int(4, 6), 1, 12);
        return { code: `PROCEDURE sumFrom(list, i)\n{\nIF (i > LENGTH(list))\n{\nRETURN(0)\n}\nRETURN(list[i] + sumFrom(list, i + ${r.int(1, 2)}))\n}\nDISPLAY(sumFrom(${L(xs)}, ${r.int(1, 3)}))`, ask: out };
      },
      (r) => {
        const xs = r.list(5, 1, 30), k = r.int(2, 5);
        return {
          code: `PROCEDURE keep(list, k)\n{\nresult ← []\nFOR EACH n IN list\n{\nIF (n MOD k = 0)\n{\nAPPEND(result, n)\n}\nELSE\n{\nINSERT(result, 1, n MOD k)\n}\n}\nRETURN(result)\n}\nDISPLAY(keep(${L(xs)}, ${k}))`,
          ask: out,
        };
      },
      (r) => ({ code: `PROCEDURE p(a, b)\n{\nIF (b = 0)\n{\nRETURN(a)\n}\nRETURN(p(b, a MOD b))\n}\nDISPLAY(p(${r.int(12, 60)}, ${r.int(6, 30)}))`, ask: out }),
      (r) => {
        const k = r.int(1, 2);
        return { code: `PROCEDURE show(n)\n{\nIF (n > 0)\n{\nDISPLAY(n)\nshow(n - ${k + 1})\nDISPLAY(n * ${r.int(2, 10)})\n}\n}\nshow(${r.int(3, 6)})`, ask: out };
      },
      (r) => {
        const xs = r.list(5, 1, 20);
        return {
          code: `list ← ${L(xs)}\ni ← 1\nREPEAT LENGTH(list) - 1 TIMES\n{\nIF (list[i] > list[i + 1])\n{\ntemp ← list[i]\nlist[i] ← list[i + 1]\nlist[i + 1] ← temp\n}\ni ← i + 1\n}\nDISPLAY(list)`,
          ask: out,
        };
      },
      (r) => {
        const n = r.int(3, 5);
        return { code: `PROCEDURE pow(b, e)\n{\nIF (e = 0)\n{\nRETURN(1)\n}\nRETURN(b * pow(b, e - 1))\n}\ntotal ← 0\ni ← 1\nREPEAT ${n} TIMES\n{\ntotal ← total + pow(2, i)\ni ← i + 1\n}\nDISPLAY(total)`, ask: out };
      },
      (r) => {
        const xs = r.sample([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23], 8).sort((a, b) => a - b);
        const t = r.chance(0.7) ? r.pick(xs) : r.pick([2, 10, 16]);
        return {
          code: `list ← ${L(xs)}\nlow ← 1\nhigh ← LENGTH(list)\nsteps ← 0\nfound ← false\nREPEAT UNTIL (low > high OR found)\n{\nmid ← (low + high) / 2\nmid ← mid - (mid MOD 1)\nsteps ← steps + 1\nIF (list[mid] = ${t})\n{\nfound ← true\n}\nELSE\n{\nIF (list[mid] < ${t})\n{\nlow ← mid + 1\n}\nELSE\n{\nhigh ← mid - 1\n}\n}\n}\nDISPLAY(steps)\nDISPLAY(found)`,
          ask: out,
        };
      },
    ],
  },
];

export const levelById = (id: LevelId) => LEVELS.find((l) => l.id === id)!;
