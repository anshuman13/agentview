import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { configDir, isLimited, markLimited, overageUntil } from '../../server/src/agent/claude/accounts.js';
import { pushNtfy } from '../../server/src/integrations/notify.js';
import { ACCOUNT_OF } from './calendar.js';
import type { Profile } from './db.js';
import { applyChanges, type Change } from './sync.js';
import { MIN } from './time.js';

const KEEP = 20;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

type Job = { id: string; profile: Profile; name: string | null; schedule: string | null; prompt: string | null; enabled: number | null; next_run_at: number | null };

// Schedules are "hourly", "daily HH:MM", "weekdays HH:MM" or "weekly <day> HH:MM", in the hub's local time.
export function nextRun(schedule: string | null, after: number): number | null {
  const s = (schedule ?? '').trim().toLowerCase();
  // Whole UTC hours, so the repeated hour when clocks go back gets its run too.
  if (s === 'hourly') return Math.floor(after / 3600_000) * 3600_000 + 3600_000;
  const m = /^(daily|weekdays|weekly (sun|mon|tue|wed|thu|fri|sat)) (\d{1,2}):(\d{2})$/.exec(s);
  if (!m || +m[3] > 23 || +m[4] > 59) return null;
  const ok = (d: Date) => (m[1] === 'daily' ? true : m[1] === 'weekdays' ? d.getDay() % 6 !== 0 : d.getDay() === DAYS.indexOf(m[2]));
  const base = new Date(after);
  for (let i = 0; i < 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, +m[3], +m[4]);
    if (d.getTime() > after && ok(d)) return d.getTime();
  }
  return null;
}

const READ = /^(get|list|search|read|query|fetch|find)/i;

// Read-only MCP tools, also when the tool repeats its server's name, like mcp__claude_ai_Slack__slack_read_channel.
export function canRead(name: string) {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!m) return false;
  const server = m[1].split('_').pop()!.toLowerCase();
  const action = m[2].toLowerCase().startsWith(`${server}_`) ? m[2].slice(server.length + 1) : m[2];
  return READ.test(action);
}

// Runs one job on its profile's account with read-only tools; it may add tasks to Codex and returns its reply.
async function runJob(db: Database, job: Job) {
  const account = ACCOUNT_OF[job.profile];
  const dir = configDir(account);
  const added: string[] = [];
  const addTask = tool('add_task', 'Add a task for me to Codex.', { title: z.string().describe('Short imperative task'), context: z.string().optional().describe('One sentence on why, with a link if there is one') }, async (a) => {
    const now = Date.now();
    applyChanges(db, [{ table: 'items', id: randomUUID(), profile: job.profile, updated_at: now, fields: { title: a.title.trim(), text: a.context?.trim() || null, source: 'job', people: job.name, status: 'open', at: null } }]);
    added.push(a.title.trim());
    return { content: [{ type: 'text', text: 'added' }] };
  });
  const prompt = [
    job.prompt ?? '',
    '',
    'This runs on a schedule with no one watching. Only read: do not send, post, create or change anything outside Codex.',
    'Use add_task for anything I need to act on. End with a short plain-text result for a phone notification. Do not use the em dash character.',
  ].join('\n');
  let result = '';
  for await (const m of query({
    prompt,
    options: {
      persistSession: false,
      model: 'sonnet',
      maxTurns: 30,
      cwd: os.tmpdir(),
      settingSources: [],
      tools: ['WebSearch', 'WebFetch'],
      env: { ...process.env, ...(dir && { CLAUDE_CONFIG_DIR: dir }) },
      mcpServers: { codex: createSdkMcpServer({ name: 'codex', tools: [addTask] }) },
      allowedTools: ['WebSearch', 'WebFetch', 'mcp__codex__add_task'],
      canUseTool: async (name, input) => (canRead(name) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Jobs can only read.' }),
    },
  })) {
    const until = overageUntil(m);
    if (until) {
      markLimited(account, until);
      throw new Error('Stopped before using extra usage');
    }
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`Ended with ${m.subtype}`);
      result = m.result.trim();
    }
  }
  return { result, added };
}

// Fills in the next run of enabled jobs that have none and returns the jobs that are due. A job that is off has a next
// run only when Run now was pressed.
export function dueJobs(db: Database, now = Date.now()): Job[] {
  const jobs = db.prepare('SELECT id, profile, name, schedule, prompt, enabled, next_run_at FROM jobs WHERE deleted = 0').all() as Job[];
  const plan: Change[] = [];
  for (const j of jobs) {
    if (j.next_run_at != null || !j.enabled) continue;
    const next = nextRun(j.schedule, now);
    if (next) plan.push({ table: 'jobs', id: j.id, profile: j.profile, updated_at: now, fields: { next_run_at: next } });
  }
  applyChanges(db, plan);
  return jobs.filter((j) => j.next_run_at != null && j.next_run_at <= now && j.prompt?.trim());
}

// Keeps the last runs of each job.
function prune(db: Database, job: Job, now: number) {
  const old = db.prepare('SELECT id FROM runs WHERE deleted = 0 AND profile = ? AND job_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET ?').all(job.profile, job.id, KEEP) as { id: string }[];
  applyChanges(db, old.map((r) => ({ table: 'runs', id: r.id, profile: job.profile, deleted: true, updated_at: now, fields: {} })));
}

export async function runDue(db: Database, now = Date.now()) {
  for (const due of dueJobs(db, now)) {
    // An earlier job can run for minutes; skip or update this one if it was turned off, deleted or edited meanwhile.
    const live = db.prepare('SELECT prompt, next_run_at FROM jobs WHERE id = ? AND profile = ? AND deleted = 0').get(due.id, due.profile) as { prompt: string | null; next_run_at: number | null } | null;
    if (!live || live.next_run_at == null || live.next_run_at > Date.now() || !live.prompt?.trim()) continue;
    const job = { ...due, prompt: live.prompt };
    if (isLimited(ACCOUNT_OF[job.profile])) continue;
    const id = randomUUID();
    const started = Date.now();
    applyChanges(db, [{ table: 'runs', id, profile: job.profile, updated_at: started, fields: { job_id: job.id, started_at: started, status: 'running' } }]);
    let status = 'ok';
    let output = '';
    try {
      const { result, added } = await runJob(db, job);
      output = [result, added.length ? `Added: ${added.join('; ')}` : ''].filter(Boolean).join('\n\n');
    } catch (err) {
      status = 'error';
      output = err instanceof Error ? err.message : String(err);
    }
    const done = Date.now();
    const changes: Change[] = [{ table: 'runs', id, profile: job.profile, updated_at: done, fields: { finished_at: done, status, output } }];
    // An edit made during the run (Off, a new schedule, Run now) set next_run_at itself, so it is kept.
    const cur = db.prepare('SELECT schedule, enabled, field_times FROM jobs WHERE id = ? AND profile = ?').get(job.id, job.profile) as { schedule: string | null; enabled: number | null; field_times: string } | null;
    if (cur && (JSON.parse(cur.field_times).next_run_at ?? 0) < started) {
      changes.push({ table: 'jobs', id: job.id, profile: job.profile, updated_at: done, fields: { next_run_at: cur.enabled ? nextRun(cur.schedule, done) : null } });
    }
    applyChanges(db, changes);
    prune(db, job, done);
    await pushNtfy(status === 'ok' ? job.name ?? 'Job' : `${job.name ?? 'Job'} failed`, '', output.slice(0, 500), '').catch(() => {});
  }
}

// A run cut off by a hub restart is marked failed; its job runs again at the next tick.
export function endInterrupted(db: Database, now = Date.now()) {
  const stuck = db.prepare("SELECT id, profile FROM runs WHERE deleted = 0 AND status = 'running'").all() as { id: string; profile: Profile }[];
  applyChanges(db, stuck.map((r) => ({ table: 'runs', id: r.id, profile: r.profile, updated_at: now, fields: { finished_at: now, status: 'error', output: 'Interrupted by a restart' } })));
}

export function startJobs(db: () => Database, every = MIN) {
  endInterrupted(db());
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await runDue(db());
    } catch (err) {
      console.error('jobs:', err instanceof Error ? err.message : err);
    }
    busy = false;
  };
  setInterval(run, every).unref();
}
