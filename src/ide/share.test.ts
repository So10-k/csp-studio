import { decodeShare, encodeShare } from './share';

it('share links round-trip', async () => {
  const s = { name: 'Test ← ≠', code: 'x ← 1\nDISPLAY("héllo")\n'.repeat(20), world: { width: 3, height: 3, walls: ['1,1'], start: { x: 0, y: 0, dir: 1 as const }, goal: null } };
  const token = await encodeShare(s);
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(token.length).toBeLessThan(200);
  expect(await decodeShare(token)).toEqual(s);
});

it('bad links decode to null', async () => {
  expect(await decodeShare('not-a-real-token')).toBeNull();
});
