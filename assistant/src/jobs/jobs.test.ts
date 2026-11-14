import { afterEach, describe, expect, test } from 'bun:test';
import { openDb } from '../core/db.js';
import { applyChanges } from '../core/sync.js';
import { canRead, dropOrphanRuns, dueJobs, jobAllows, nextRun, orphansDue, runDue } from './jobs.js';
import { HOUR } from '../core/time.js';
import { queueCommands, replyToCommand } from '../slack/commands.js';

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('nextRun', () => {
  // Mon 26 Oct 2026, 10:00
  const now = at(2026, 10, 26, 10);
  test('daily runs later today or tomorrow', () => {
    expect(nextRun('daily 16:00', now)).toBe(at(2026, 10, 26, 16));
    expect(nextRun('daily 07:30', now)).toBe(at(2026, 10, 27, 7, 30));
  });
  test('daily keeps its hour across the spring-forward change', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Europe/Oslo';
    try {
      expect(nextRun('daily 02:30', at(2026, 3, 29, 3, 40))).toBe(at(2026, 3, 30, 2, 30));
    } finally {
      process.env.TZ = tz;
    }
  });
  test('weekdays skip the weekend', () => {
    expect(nextRun('weekdays 07:30', at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 7, 30));
  });
  test('weekly lands on its day', () => {
    expect(nextRun('weekly fri 16:00', now)).toBe(at(2026, 10, 30, 16));
    expect(nextRun('weekly mon 09:00', now)).toBe(at(2026, 11, 2, 9));
  });
  test('hourly is the next full hour', () => {
    expect(nextRun('hourly', at(2026, 10, 26, 10, 15))).toBe(at(2026, 10, 26, 11));
  });
  test('a bad schedule has no next run', () => {
    expect(nextRun('sometimes', now)).toBeNull();
    expect(nextRun('daily 25:00', now)).toBeNull();
    expect(nextRun('*/15 0-8 * *', now)).toBeNull();
    expect(nextRun('0 24 * * *', now)).toBeNull();
  });
  test('cron steps through a window and skips to the next matching day', () => {
    expect(nextRun('*/15 0-8 2 11 *', now)).toBe(at(2026, 11, 2, 0));
    expect(nextRun('*/15 0-8 2 11 *', at(2026, 11, 2, 0, 7))).toBe(at(2026, 11, 2, 0, 15));
    expect(nextRun('*/15 0-8 2 11 *', at(2026, 11, 2, 8, 45))).toBe(at(2027, 11, 2, 0));
    expect(nextRun('30 7 * * 1-5', at(2026, 10, 30, 9))).toBe(at(2026, 11, 2, 7, 30));
  });
  test('once runs at its time and never after', () => {
    expect(nextRun('once 2026-11-02 00:00', now)).toBe(at(2026, 11, 2, 0));
    expect(nextRun('once 2026-11-02 00:00', at(2026, 11, 2, 0))).toBeNull();
  });
});

describe('dueJobs', () => {
  test('plans enabled jobs and returns the due ones, including Run now on a job that is off', () => {
    const db = openDb(':memory:');
    const now = at(2026, 10, 26, 10);
    applyChanges(db, [
      { table: 'jobs', id: 'a', profile: 'work', updated_at: 1, fields: { name: 'A', schedule: 'daily 09:00', prompt: 'x', enabled: 1 } },
      { table: 'jobs', id: 'b', profile: 'work', updated_at: 1, fields: { name: 'B', schedule: 'daily 09:00', prompt: 'x', enabled: 1, next_run_at: now - 1 } },
      { table: 'jobs', id: 'c', profile: 'work', updated_at: 1, fields: { name: 'C', schedule: 'daily 09:00', prompt: 'x', enabled: 0, next_run_at: now - 1 } },
      { table: 'jobs', id: 'd', profile: 'work', updated_at: 1, fields: { name: 'D', schedule: 'daily 09:00', prompt: 'x', enabled: 0 } },
    ]);
    expect(dueJobs(db, now).map((j) => j.id)).toEqual(['b', 'c']);
    expect((db.prepare("SELECT next_run_at FROM jobs WHERE id = 'a'").get() as { next_run_at: number }).next_run_at).toBe(at(2026, 10, 27, 9));
  });
  test('runs of a deleted job are deleted', () => {
    const db = openDb(':memory:');
    applyChanges(db, [
      { table: 'jobs', id: 'a', profile: 'work', updated_at: 1, deleted: true, fields: { name: 'A' } },
      { table: 'jobs', id: 'b', profile: 'work', updated_at: 1, fields: { name: 'B' } },
      { table: 'runs', id: 'ra', profile: 'work', updated_at: 1, fields: { job_id: 'a', output: 'x' } },
      { table: 'runs', id: 'rb', profile: 'work', updated_at: 1, fields: { job_id: 'b', output: 'x' } },
    ]);
    expect(dropOrphanRuns(db, 2)).toBe(0);
    expect(dropOrphanRuns(db, 2 * 86_400_000)).toBe(1);
    expect(db.prepare('SELECT id, deleted, output FROM runs ORDER BY id').all()).toEqual([{ id: 'ra', deleted: 1, output: null }, { id: 'rb', deleted: 0, output: 'x' }]);
  });
});

describe('runDue', () => {
  test('keeps a Run now pressed during the run on a phone whose clock is behind', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    applyChanges(db, [{ table: 'jobs', id: 'a', profile: 'work', updated_at: now - 3_600_000, fields: { name: 'A', schedule: 'daily 09:00', prompt: 'x', enabled: 1, next_run_at: now - 1 } }]);
    const run = async () => {
      applyChanges(db, [{ table: 'jobs', id: 'a', profile: 'work', updated_at: now - 60_000, fields: { next_run_at: now - 60_000 } }]);
      return { result: 'done', added: [], notified: false, cost: null };
    };
    await runDue(db, now, run, async () => true);
    expect((db.prepare("SELECT next_run_at FROM jobs WHERE id = 'a'").get() as { next_run_at: number }).next_run_at).toBe(now - 60_000);
  });
  const ok = async () => (await new Promise((r) => setTimeout(r, 5)), { result: 'done', added: [], notified: false, cost: null });
  const reply = async (_db: unknown, _jobId: string, _ok: boolean, _output: string) => {};
  const seed = (enabled: number) => {
    const db = openDb(':memory:');
    const now = Date.now();
    applyChanges(db, [{ table: 'jobs', id: 'a', profile: 'work', updated_at: 1, fields: { name: 'A', schedule: 'daily 09:00', prompt: 'x', enabled, next_run_at: now - 1 } }]);
    return { db, now };
  };
  const state = (db: ReturnType<typeof openDb>) => db.prepare("SELECT enabled, next_run_at FROM jobs WHERE id = 'a'").get();
  test('an enabled job keeps its schedule after Run now', async () => {
    const { db, now } = seed(1);
    await runDue(db, now, ok, async () => true, reply);
    expect(state(db)).toEqual({ enabled: 1, next_run_at: nextRun('daily 09:00', Date.now()) });
  });
  test('a disabled job runs once and stays off', async () => {
    const { db, now } = seed(0);
    await runDue(db, now, ok, async () => true, reply);
    expect(state(db)).toEqual({ enabled: 0, next_run_at: null });
    expect(db.prepare('SELECT status FROM runs').all()).toEqual([{ status: 'ok' }]);
  });
  test('a failed run is saved as an error and notified', async () => {
    const { db, now } = seed(1);
    const titles: string[] = [];
    const boom = async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('boom'); };
    await runDue(db, now, boom, async (t: string) => (titles.push(t), true), reply);
    expect(db.prepare('SELECT status, output FROM runs').all()).toEqual([{ status: 'error', output: 'boom' }]);
    expect(titles.length).toBe(1);
    expect(titles[0].endsWith('failed')).toBe(true);
    expect(db.prepare('SELECT cost FROM runs').all()).toEqual([{ cost: null }]);
  });
  test('a run stores the cost its job reports', async () => {
    const { db, now } = seed(1);
    await runDue(db, now, async () => ({ result: 'done', added: [], notified: false, cost: 0.04 }), async () => true, reply);
    expect(db.prepare('SELECT cost FROM runs').all()).toEqual([{ cost: 0.04 }]);
  });
  describe('coding jobs', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });
    const seedRepo = () => {
      const db = openDb(':memory:');
      const now = Date.now();
      applyChanges(db, [{ table: 'jobs', id: 'a', profile: 'work', updated_at: 1, fields: { name: 'Fix tests', schedule: 'daily 09:00', prompt: 'push the fix', enabled: 1, next_run_at: now - 1, repo: '/Users/me/workspace/app' } }]);
      return { db, now };
    };
    const never = async () => {
      throw new Error('runJob called');
    };
    const go = async (answer: () => Response | Promise<Response>) => {
      const { db, now } = seedRepo();
      const calls: { url: string; body: unknown }[] = [];
      globalThis.fetch = (async (url: string, init: RequestInit) => (calls.push({ url, body: JSON.parse(String(init.body)) }), await new Promise((r) => setTimeout(r, 5)), answer())) as never;
      const pushes: string[] = [];
      await runDue(db, now, never, async (t: string) => (pushes.push(t), true), reply);
      return { calls, pushes, run: db.prepare('SELECT status, output FROM runs WHERE deleted = 0').get() };
    };
    test('posts the job to the server and records the branch it started', async () => {
      const { calls, pushes, run } = await go(() => Response.json({ chatId: 'c1', branch: 'jobs/fix-tests-1105' }));
      expect(calls).toEqual([{ url: 'http://127.0.0.1:7777/api/jobs/start', body: { jobId: 'a', title: 'Fix tests', repo: '/Users/me/workspace/app', prompt: 'push the fix' } }]);
      expect(run).toEqual({ status: 'ok', output: 'Started jobs/fix-tests-1105 in app' });
      expect(pushes).toEqual([]);
    });
    test('a 2xx answer that is not JSON still counts as started', async () => {
      const { run } = await go(() => new Response('ok'));
      expect(run).toEqual({ status: 'ok', output: 'Started a chat in app' });
    });
    test('an open last run is skipped without a push or a run row', async () => {
      const { pushes, run } = await go(() => Response.json({ error: 'The last run is still open' }, { status: 409 }));
      expect(run).toBeNull();
      expect(pushes).toEqual([]);
    });
    test('a server that is down or answers an error is a failed run with a push', async () => {
      const down = await go(() => Promise.reject(new Error('connect refused')));
      expect(down.run).toEqual({ status: 'error', output: 'Could not start: connect refused' });
      expect(down.pushes).toEqual(['Fix tests failed']);
      const bad = await go(() => Response.json({ error: 'Not a workspace repo' }, { status: 400 }));
      expect(bad.run).toEqual({ status: 'error', output: 'Could not start: Not a workspace repo' });
    });
  });
  describe('concurrency', () => {
    const seedMany = (ids: string[]) => {
      const db = openDb(':memory:');
      const now = Date.now();
      applyChanges(db, ids.map((id) => ({ table: 'jobs', id, profile: 'work' as const, updated_at: 1, fields: { name: id, schedule: 'daily 09:00', prompt: id, enabled: 1, next_run_at: now - 1 } })));
      return { db, now };
    };
    const finish = async () => (await new Promise((r) => setTimeout(r, 5)), { result: 'done', added: [], notified: false, cost: null });
    const gate = () => {
      let open!: () => void;
      const p = new Promise<void>((r) => (open = r));
      return { p, open };
    };
    const tick = () => new Promise((r) => setTimeout(r, 50));
    const statuses = (db: ReturnType<typeof openDb>) => db.prepare('SELECT j.id, r.status FROM runs r JOIN jobs j ON j.id = r.job_id ORDER BY j.id').all();

    test('runs at most 2 jobs at once and starts the next when one finishes', async () => {
      const { db, now } = seedMany(['a', 'b', 'c']);
      const g = gate();
      const started: string[] = [];
      let flying = 0;
      let peak = 0;
      const run = async (_db: unknown, job: { id: string }) => {
        started.push(job.id);
        peak = Math.max(peak, ++flying);
        await g.p;
        flying--;
        return finish();
      };
      const done = runDue(db, now, run as never, async () => true, reply);
      await tick();
      expect(started.length).toBe(2);
      g.open();
      await done;
      expect(started.length).toBe(3);
      expect(peak).toBe(2);
    });
    test('browser jobs take turns', async () => {
      const { db, now } = seedMany(['a', 'b']);
      applyChanges(db, ['a', 'b'].map((id) => ({ table: 'jobs', id, profile: 'work' as const, updated_at: 2, fields: { tools: 'browser' } })));
      let flying = 0;
      let peak = 0;
      const run = async () => {
        peak = Math.max(peak, ++flying);
        await new Promise((r) => setTimeout(r, 10));
        flying--;
        return finish();
      };
      await runDue(db, now, run as never, async () => true, reply);
      expect(statuses(db)).toEqual([{ id: 'a', status: 'ok' }, { id: 'b', status: 'ok' }]);
      expect(peak).toBe(1);
    });
    test('a hung job does not hold back the others, and runDue waits for it', async () => {
      const { db, now } = seedMany(['a', 'b', 'c']);
      const hang = gate();
      const run = async (_db: unknown, job: { id: string }) => {
        if (job.id === 'a') await hang.p;
        return finish();
      };
      let finished = false;
      const done = runDue(db, now, run as never, async () => true, reply).then(() => (finished = true));
      await tick();
      expect(statuses(db)).toEqual([{ id: 'a', status: 'running' }, { id: 'b', status: 'ok' }, { id: 'c', status: 'ok' }]);
      expect(finished).toBe(false);
      hang.open();
      await done;
      expect(finished).toBe(true);
    });
    test('a throwing job ends as an error and the other job still ends ok', async () => {
      const { db, now } = seedMany(['a', 'b']);
      const run = async (_db: unknown, job: { id: string }) => {
        if (job.id === 'a') {
          await new Promise((r) => setTimeout(r, 5));
          throw new Error('boom');
        }
        return finish();
      };
      await runDue(db, now, run as never, async () => true, reply);
      expect(db.prepare('SELECT status, output FROM runs ORDER BY status').all()).toEqual([{ status: 'error', output: 'boom' }, { status: 'ok', output: 'done' }]);
    });
    test('a job turned off while queued is skipped', async () => {
      const { db, now } = seedMany(['a', 'b', 'c']);
      const g = gate();
      const ran: string[] = [];
      const run = async (_db: unknown, job: { id: string }) => {
        ran.push(job.id);
        await g.p;
        return finish();
      };
      const done = runDue(db, now, run as never, async () => true, reply);
      await tick();
      applyChanges(db, [{ table: 'jobs', id: 'c', profile: 'work', updated_at: Date.now(), fields: { enabled: 0, next_run_at: null } }]);
      g.open();
      await done;
      expect(ran).toEqual(['a', 'b']);
    });
  });
  test('orphan cleanup is due on the first tick and then once an hour', () => {
    expect(orphansDue(null, 1000)).toBe(true);
    expect(orphansDue(1000, 1000 + HOUR - 1)).toBe(false);
    expect(orphansDue(1000, 1000 + HOUR)).toBe(true);
  });
});

describe('Slack commands', () => {
  test('a command in my self-DM runs once as a job and its result is posted in its thread', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    const dm = 'https://example.slack.com/archives/D012AB3CD/p1730700000000100';
    // The scan that finds it started a while before the jobs tick.
    const queued = queueCommands(db, [{ text: 'summarise the launch thread', url: dm }, { text: 'x', url: 'https://example.slack.com/archives/C0123/p1730700000000200' }], now - 60_000);
    expect(queued.length).toBe(1);
    expect(queueCommands(db, [{ text: 'summarise the launch thread', url: dm }], now)).toEqual([]);
    const prompts: string[] = [];
    const posts: [string, string][] = [];
    const run = async (_db: unknown, job: { prompt: string | null }) => (prompts.push(job.prompt ?? ''), { result: 'Three points: a, b, c', added: [], notified: false, cost: null });
    const reply = (d: typeof db, id: string, ok: boolean, out: string) => replyToCommand(d, id, ok, out, async (url, text) => (posts.push([url, text]), 'posted'), async () => true);
    await runDue(db, now, run, async () => true, reply);
    await runDue(db, now + 60_000, run, async () => true, reply);
    expect(prompts.length).toBe(1);
    expect(prompts[0]).toContain('summarise the launch thread');
    expect(posts).toEqual([[dm, 'Assistant: Three points: a, b, c']]);
  });
});

describe('jobAllows', () => {
  test('allows the browser and named tools, with * as a prefix', () => {
    const a = jobAllows('browser, mcp__claude_ai_Slack__slack_send_message mcp__linear__*');
    expect(['mcp__browser__browser_click', 'mcp__claude_ai_Slack__slack_send_message', 'mcp__linear__create_issue'].every(a.allows)).toBe(true);
    expect(a.allows('mcp__claude_ai_Gmail__send_message') || jobAllows(null).allows('mcp__browser__browser_click')).toBe(false);
  });
});

describe('canRead', () => {
  test('allows read tools, also when named after their server', () => {
    for (const t of ['mcp__claude_ai_Slack__slack_read_channel', 'mcp__claude_ai_Slack__slack_search_public_and_private', 'mcp__claude_ai_Slack__slack_list_user_channels', 'mcp__claude_ai_Gmail__search_threads', 'mcp__linear__list_issues']) expect(canRead(t)).toBe(true);
  });
  test('denies writes', () => {
    for (const t of ['mcp__claude_ai_Slack__slack_send_message', 'mcp__claude_ai_Slack__slack_create_list', 'mcp__claude_ai_Gmail__send_message', 'mcp__linear__create_issue', 'Bash']) expect(canRead(t)).toBe(false);
  });
});
