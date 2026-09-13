import { describe, expect, it } from 'vitest';
import { cacheGet, cachePut, contentKey } from '../src/lib/cache';

describe('contentKey', () => {
  it('is a stable SHA-256 hex digest', async () => {
    const key = await contentKey(['a', 'b']);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentKey(['a', 'b'])).toBe(key);
  });

  it('changes when any part changes', async () => {
    const base = await contentKey(['clause', 'rental', 'v5', 'model']);
    expect(await contentKey(['clause', 'rental', 'v6', 'model'])).not.toBe(base);
    expect(await contentKey(['clause', 'employment', 'v5', 'model'])).not.toBe(base);
    expect(await contentKey(['clause2', 'rental', 'v5', 'model'])).not.toBe(base);
  });

  it('cannot be collided by moving a boundary between parts', async () => {
    // Without a separator, ['ab','c'] and ['a','bc'] would hash identically.
    expect(await contentKey(['ab', 'c'])).not.toBe(await contentKey(['a', 'bc']));
  });

  it('handles unicode and very long inputs', async () => {
    await expect(contentKey(['करार'.repeat(5000)])).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('cacheGet / cachePut', () => {
  it('round-trips a stored value', async () => {
    const key = await contentKey([`roundtrip-${crypto.randomUUID()}`]);
    await cachePut(key, { heading: 'Lock-in', risk: 'high' });
    await expect(cacheGet(key)).resolves.toEqual({ heading: 'Lock-in', risk: 'high' });
  });

  it('returns null for a key that was never written', async () => {
    await expect(cacheGet(await contentKey([`absent-${crypto.randomUUID()}`]))).resolves.toBeNull();
  });

  it('keeps entries for different keys separate', async () => {
    const a = await contentKey([`a-${crypto.randomUUID()}`]);
    const b = await contentKey([`b-${crypto.randomUUID()}`]);
    await cachePut(a, { v: 1 });
    await cachePut(b, { v: 2 });
    await expect(cacheGet(a)).resolves.toEqual({ v: 1 });
    await expect(cacheGet(b)).resolves.toEqual({ v: 2 });
  });

  it('overwrites a key on a second write', async () => {
    const key = await contentKey([`overwrite-${crypto.randomUUID()}`]);
    await cachePut(key, { v: 1 });
    await cachePut(key, { v: 2 });
    await expect(cacheGet(key)).resolves.toEqual({ v: 2 });
  });
});
