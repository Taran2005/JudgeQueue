export class BoxPool {
  private readonly free: number[];
  private readonly leased = new Set<number>();
  private readonly waiters: Array<(id: number) => void> = [];

  constructor(readonly ids: readonly number[]) {
    if (ids.length === 0) throw new Error('BoxPool needs at least one box id');
    if (new Set(ids).size !== ids.length) throw new Error('BoxPool box ids must be unique');
    this.free = [...ids];
  }

  get size(): number {
    return this.ids.length;
  }

  get available(): number {
    return this.free.length;
  }

  acquire(): Promise<number> {
    const id = this.free.shift();
    if (id !== undefined) {
      this.leased.add(id);
      return Promise.resolve(id);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(id: number): void {
    if (!this.leased.has(id)) throw new Error(`box ${id} is not leased`);
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(id);
      return;
    }
    this.leased.delete(id);
    this.free.push(id);
  }
}

export function boxIds(count: number, start: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}
