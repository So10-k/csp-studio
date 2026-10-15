/** Small seeded random generator (mulberry32), so a question can be rebuilt from its seed. */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [a, b] */
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /** k distinct items */
  sample<T>(xs: readonly T[], k: number): T[] { return this.shuffle([...xs]).slice(0, k); }
  list(n: number, a: number, b: number): number[] { return Array.from({ length: n }, () => this.int(a, b)); }
}
