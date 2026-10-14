/** Runtime values. Lists are plain arrays (so they behave as references when passed to procedures). */
export type Value = number | string | boolean | Value[];

/** What a procedure call evaluates to when it doesn't RETURN a value. */
export class NoValue {
  constructor(public from: string) {}
}
export type Slot = Value | NoValue;

export function isList(v: Slot): v is Value[] {
  return Array.isArray(v);
}

export function typeName(v: Slot): string {
  if (v instanceof NoValue) return 'nothing';
  if (Array.isArray(v)) return 'a list';
  switch (typeof v) {
    case 'number': return 'a number';
    case 'string': return 'text';
    default: return 'a Boolean (true/false)';
  }
}

/** Deep copy (assigning a list stores a copy of it). */
export function copy(v: Value): Value {
  return Array.isArray(v) ? v.map(copy) : v;
}

export function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => equal(x, b[i]));
  }
  return a === b;
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (!Number.isFinite(n)) return String(n);
  // hide floating-point noise like 0.30000000000000004
  return String(Number(n.toPrecision(12)));
}

/** How DISPLAY shows a value. */
export function show(v: Slot): string {
  if (v instanceof NoValue) return '(nothing)';
  if (Array.isArray(v)) return `[${v.map(showInList).join(', ')}]`;
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v;
}

/** Inside a list (and in the inspector), strings are quoted so [1, "1"] is unambiguous. */
export function showInList(v: Slot): string {
  return typeof v === 'string' ? `"${v}"` : show(v);
}

/** INPUT() turns typed text into a number or Boolean when it looks like one. */
export function parseInput(text: string): Value {
  const t = text.trim();
  if (t !== '' && /^-?(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  return text;
}
