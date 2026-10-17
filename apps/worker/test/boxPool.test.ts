import { describe, expect, it } from 'vitest';
import { BoxPool, boxIds } from '../src/boxPool.js';

describe('BoxPool', () => {
  it('hands out every box exactly once', async () => {
    const pool = new BoxPool([0, 1, 2]);
    const got = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
    expect([...got].sort()).toEqual([0, 1, 2]);
    expect(pool.available).toBe(0);
  });

  it('makes acquirers wait until a box is released', async () => {
    const pool = new BoxPool([7]);
    const first = await pool.acquire();
    let granted: number | undefined;
    const pending = pool.acquire().then((id) => (granted = id));

    await Promise.resolve();
    expect(granted).toBeUndefined();

    pool.release(first);
    await pending;
    expect(granted).toBe(7);
  });

  it('serves waiters in FIFO order', async () => {
    const pool = new BoxPool([0]);
    const held = await pool.acquire();
    const order: string[] = [];
    const a = pool.acquire().then((id) => {
      order.push('a');
      pool.release(id);
    });
    const b = pool.acquire().then((id) => {
      order.push('b');
      pool.release(id);
    });
    pool.release(held);
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('returns released boxes to the free list', async () => {
    const pool = new BoxPool([0, 1]);
    const id = await pool.acquire();
    pool.release(id);
    expect(pool.available).toBe(2);
  });

  it('rejects releasing a box that is not leased', async () => {
    const pool = new BoxPool([0, 1]);
    expect(() => pool.release(0)).toThrow(/not leased/);
    const id = await pool.acquire();
    pool.release(id);
    expect(() => pool.release(id)).toThrow(/not leased/);
  });

  it('rejects empty and duplicate id lists', () => {
    expect(() => new BoxPool([])).toThrow();
    expect(() => new BoxPool([1, 1])).toThrow(/unique/);
  });

  it('builds consecutive box ids', () => {
    expect(boxIds(3, 10)).toEqual([10, 11, 12]);
  });
});
