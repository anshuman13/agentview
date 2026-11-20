import { describe, expect, it } from 'bun:test';
import { BaseStore } from './store';
import { HubError } from './hubFetch';

class Fake extends BaseStore {
  runs = 0;
  release: ((changed: boolean) => void)[] = [];
  constructor() {
    super('ready');
  }
  protected syncOnce() {
    this.runs++;
    return new Promise<boolean>((r) => this.release.push(r));
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
    s.release.shift()!(true);
    await tick();
    expect(done).toBe(false);
    expect(s.runs).toBe(2);
    s.release.shift()!(true);
    await Promise.all([first, second]);
    expect(done).toBe(true);
    expect(s.runs).toBe(2);
  });
});

describe('syncSoon', () => {
  it('joins the running sync instead of adding one', async () => {
    const s = new Fake();
    const first = s.syncNow();
    await tick();
    const joined = s.syncSoon();
    s.release.shift()!(true);
    await Promise.all([first, joined]);
    expect(s.runs).toBe(1);
    const next = s.syncSoon();
    expect(s.runs).toBe(2);
    s.release.shift()!(true);
    await next;
  });
});

describe('hub retry', () => {
  class Flaky extends Fake {
    outcomes: (Error | boolean)[] = [];
    protected async syncOnce() {
      this.runs++;
      const next = this.outcomes.shift() ?? true;
      if (typeof next !== 'boolean') throw next;
      return next;
    }
  }

  it('shows reconnecting, not an error, while it waits to retry', async () => {
    const s = new Flaky();
    s.outcomes = [new HubError('Assistant hub unreachable', 502)];
    const done = s.syncNow();
    await tick();
    expect(s.snapshot().sync).toMatchObject({ reconnecting: true, syncing: true, error: '' });
    expect(s.syncSoon()).toBe(done);
    expect(s.runs).toBe(1);
    await s.syncNow();
    await done;
    expect(s.runs).toBe(2);
    expect(s.snapshot().sync).toMatchObject({ reconnecting: false, syncing: false, error: '' });
  });

  it('shows another error at once', async () => {
    const s = new Flaky();
    s.outcomes = [new HubError('bad request', 400)];
    await s.syncNow();
    expect(s.runs).toBe(1);
    expect(s.snapshot().sync).toMatchObject({ reconnecting: false, error: 'bad request' });
  });
});
