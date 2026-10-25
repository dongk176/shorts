/** A failed or slow source never serializes all the other ranks. */
export class RankingSourceQueue {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly limit = 3) {}
  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await action(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); // Transfer the occupied slot, without a race for it.
      else this.active--;
    }
  }
}
