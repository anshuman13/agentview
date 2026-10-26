import { describe, expect, it } from 'vitest';
import { BaseStore } from './store';

class Fake extends BaseStore {
  runs = 0;
  release: (() => void)[] = [];
  constructor() {
    super('ready');
  }
  protected syncOnce() {
    this.runs++;
    return new Promise<void>((r) => this.release.push(r));
  }
  protected async refresh() {}
}

const tick = () => new Promise((r) => setTimeout(r));

describe('syncNow', () => {
  it('resolves a call made during a sync only after one more sync', async () => {
    const s = new Fake();
    const first = s.syncNow();
    await tick();
    let done = false;
    const second = s.syncNow().then(() => (done = true));
    s.release.shift()!();
    await tick();
    expect(done).toBe(false);
    expect(s.runs).toBe(2);
    s.release.shift()!();
    await Promise.all([first, second]);
    expect(done).toBe(true);
    expect(s.runs).toBe(2);
  });
});
