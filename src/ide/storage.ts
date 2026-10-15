import type { World } from '../lang/robot';
import { EXAMPLES, WORLDS } from './examples';

/** One saved program. */
export interface FileDoc {
  id: string;
  name: string;
  code: string;
  world: World;
  breakpoints: number[];
  updated: number;
}

export interface Prefs {
  view: 'text' | 'blocks' | 'split';
  speed: number;
  newlines: boolean;
}

interface Store {
  v: 2;
  files: FileDoc[];
  current: string;
  prefs: Prefs;
}

const KEY = 'csp-studio:v2';
const OLD_KEY = 'csp-studio';

export const defaultWorld = (): World => structuredClone(WORLDS['Exam-style 5×5']);
const defaultPrefs = (): Prefs => ({ view: 'split', speed: 6, newlines: false });

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

export function makeFile(name: string, code: string, world: World = defaultWorld()): FileDoc {
  return { id: newId(), name, code, world, breakpoints: [], updated: Date.now() };
}

function fresh(): Store {
  const f = makeFile('My first program', EXAMPLES[0].code);
  return { v: 2, files: [f], current: f.id, prefs: defaultPrefs() };
}

/** Read everything (migrating the single-program format from the first version). */
function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s.files?.length) {
        s.prefs = { ...defaultPrefs(), ...s.prefs };
        if (!s.files.some((f) => f.id === s.current)) s.current = s.files[0].id;
        return s;
      }
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const o = JSON.parse(old);
      const f = { ...makeFile('My program', o.code ?? EXAMPLES[0].code, o.world ?? defaultWorld()), breakpoints: o.breakpoints ?? [] };
      return { v: 2, files: [f], current: f.id, prefs: { ...defaultPrefs(), view: o.view ?? 'split', speed: o.speed ?? 6, newlines: !!o.newlines } };
    }
  } catch {
    /* corrupt storage: start fresh below */
  }
  return fresh();
}

let store = read();
let pending = 0;
const listeners = new Set<(state: 'saving' | 'saved' | 'error') => void>();

function flush() {
  pending = 0;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    listeners.forEach((l) => l('saved'));
  } catch {
    listeners.forEach((l) => l('error'));
  }
}
function persist(now = false) {
  listeners.forEach((l) => l('saving'));
  clearTimeout(pending);
  if (now) flush();
  else pending = window.setTimeout(flush, 300);
}
// never lose the last keystrokes
window.addEventListener('beforeunload', () => { if (pending) flush(); });
// another tab changed things: reload our copy
window.addEventListener('storage', (e) => { if (e.key === KEY) store = read(); });

export const files = {
  onSave(l: (state: 'saving' | 'saved' | 'error') => void) { listeners.add(l); },
  list: () => [...store.files].sort((a, b) => b.updated - a.updated),
  current: (): FileDoc => store.files.find((f) => f.id === store.current) ?? store.files[0],
  prefs: () => store.prefs,
  setPrefs(p: Partial<Prefs>) { store.prefs = { ...store.prefs, ...p }; persist(); },
  /** Change the open file. */
  update(patch: Partial<Omit<FileDoc, 'id'>>, now = false) {
    const f = files.current();
    Object.assign(f, patch, 'name' in patch && Object.keys(patch).length === 1 ? {} : { updated: Date.now() });
    persist(now);
  },
  open(id: string) { if (store.files.some((f) => f.id === id)) { store.current = id; persist(true); } },
  add(f: FileDoc) { store.files.push(f); store.current = f.id; persist(true); return f; },
  remove(id: string) {
    store.files = store.files.filter((f) => f.id !== id);
    if (!store.files.length) store.files.push(makeFile('Untitled', ''));
    if (!store.files.some((f) => f.id === store.current)) store.current = files.list()[0].id;
    persist(true);
  },
  /** A name not used yet: "Untitled", "Untitled 2", … */
  uniqueName(base: string) {
    const names = new Set(store.files.map((f) => f.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  },
};
