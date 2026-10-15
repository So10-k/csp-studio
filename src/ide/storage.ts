import type { World } from '../lang/robot';
import { EXAMPLES, WORLDS } from './examples';

export interface Saved {
  code: string;
  world: World;
  view: 'text' | 'blocks' | 'split';
  speed: number;
  newlines: boolean;
  breakpoints: number[];
}

const KEY = 'csp-studio';

function defaults(): Saved {
  return { code: EXAMPLES[0].code, world: structuredClone(WORLDS['Exam-style 5×5']), view: 'split', speed: 6, newlines: false, breakpoints: [] };
}

export function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    return defaults();
  }
}

export function save(patch: Partial<Saved>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* storage full or blocked: nothing to do */
  }
}
