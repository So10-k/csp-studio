import type { LevelId } from './levels';

export const SET_SIZE = 10;

export interface Result {
  seed: number;
  /** chosen option (multiple choice) */
  choice: number | null;
  /** typed answer */
  typed: string | null;
  correct: boolean;
  /** pressed "run it for me" */
  peeked: boolean;
  /** used the hint */
  hinted: boolean;
  /** times the page was left while the question was open */
  leftPage: number;
  /** left tracing mode or reloaded with the question unanswered */
  skipped: boolean;
  ms: number;
}

export interface Session {
  level: LevelId;
  seeds: number[];
  results: Result[];
  started: number;
  /** the question currently on screen (so leaving can be detected after a reload) */
  open: { seed: number; since: number; leftPage: number; hinted: boolean } | null;
}

export interface LevelStats {
  answered: number;
  correct: number;
  peeked: number;
  sets: number;
  /** best finished set, as a fraction */
  best: number;
}

interface Store {
  levels: Partial<Record<LevelId, LevelStats>>;
  session: Session | null;
}

const KEY = 'csp-studio:tracing';

function read(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') return { levels: s.levels ?? {}, session: s.session ?? null };
  } catch { /* fall through */ }
  return { levels: {}, session: null };
}

let store = read();
const write = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage full */ } };

export const emptyStats = (): LevelStats => ({ answered: 0, correct: 0, peeked: 0, sets: 0, best: 0 });

export const progress = {
  stats: (id: LevelId): LevelStats => ({ ...emptyStats(), ...store.levels[id] }),
  session: () => store.session,

  start(level: LevelId): Session {
    const base = Math.floor(Math.random() * 1e9);
    store.session = { level, seeds: Array.from({ length: SET_SIZE }, (_, i) => base + i * 31), results: [], started: Date.now(), open: null };
    write();
    return store.session;
  },

  /** A question is now on screen. */
  open(seed: number) {
    const s = store.session;
    if (!s) return;
    if (!s.open || s.open.seed !== seed) s.open = { seed, since: Date.now(), leftPage: 0, hinted: false };
    write();
  },
  noteLeft() {
    if (store.session?.open) { store.session.open.leftPage++; write(); }
  },
  noteHint() {
    if (store.session?.open) { store.session.open.hinted = true; write(); }
  },

  record(r: Omit<Result, 'leftPage' | 'hinted' | 'ms'>): Result {
    const s = store.session!;
    const o = s.open;
    const full: Result = { ...r, leftPage: o?.leftPage ?? 0, hinted: o?.hinted ?? false, ms: o ? Date.now() - o.since : 0 };
    s.results.push(full);
    s.open = null;
    const st = progress.stats(s.level);
    st.answered++;
    if (full.correct) st.correct++;
    if (full.peeked) st.peeked++;
    if (s.results.length === s.seeds.length) {
      st.sets++;
      st.best = Math.max(st.best, s.results.filter((x) => x.correct).length / s.seeds.length);
    }
    store.levels[s.level] = st;
    write();
    return full;
  },

  /** Abandon the open question (counts as missed). */
  skipOpen() {
    const s = store.session;
    if (!s?.open) return;
    progress.record({ seed: s.open.seed, choice: null, typed: null, correct: false, peeked: false, skipped: true });
  },

  end() {
    store.session = null;
    write();
  },
};
