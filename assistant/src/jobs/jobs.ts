import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { verifyLimit } from '../../../server/src/agent/claude/accounts.js';
import { pushNtfy } from '../../../server/src/integrations/notify.js';
import { errText } from '../../../shared/util.js';
import { ACCOUNT_OF } from '../calendar/calendar.js';
import { ask } from '../core/claude.js';
import { contextTool } from '../slack/draft.js';
import { replyToCommand } from '../slack/commands.js';
import type { Profile } from '../core/db.js';
import { loop, serial } from '../core/once.js';
import { applyChanges, type Change } from '../core/sync.js';
import { DAY, HOUR, MIN } from '../core/time.js';
import { nextRun } from '../../../shared/schedule.js';
import { ownProfile, PROFILE_PORT } from '../../../server/src/chrome/launch.js';

export { nextRun };

const KEEP = 20;

type Job = { id: string; profile: Profile; name: string | null; schedule: string | null; prompt: string | null; enabled: number | null; next_run_at: number | null; tools: string | null; repo: string | null };

// The tools a job may use beyond reading: "browser" for AgentView's own Chrome, or MCP tool names, where a trailing * matches a prefix.
export function jobAllows(tools: string | null) {
  const names = (tools ?? '').split(/[\s,]+/).filter(Boolean);
  const browser = names.includes('browser');
  return {
    browser,
    names,
    allows: (tool: string) => (browser && tool.startsWith('mcp__browser__')) || names.some((n) => (n.endsWith('*') ? tool.startsWith(n.slice(0, -1)) : tool === n)),
  };
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

// Runs one job on its profile's account with read-only tools plus the ones the job allows; it may add tasks to Codex,
// push a notification and returns its reply.
async function runJob(db: Database, job: Job, notify = pushNtfy) {
  const account = ACCOUNT_OF[job.profile];
  const added: string[] = [];
  let notified = false;
  const addTask = tool('add_task', 'Add a task for me to Codex.', { title: z.string().describe('Short imperative task'), context: z.string().optional().describe('One sentence on why, with a link if there is one') }, async (a) => {
    const now = Date.now();
    applyChanges(db, [{ table: 'items', id: randomUUID(), profile: job.profile, updated_at: now, fields: { title: a.title.trim(), text: a.context?.trim() || null, source: 'job', people: job.name, status: 'open', at: null } }]);
    added.push(a.title.trim());
    return { content: [{ type: 'text', text: 'added' }] };
  });
  const push = tool('notify', 'Send me a push notification on my phone now.', { title: z.string().max(80), text: z.string().max(500) }, async (a) => {
    notified = true;
    const ok = await notify(a.title, '', a.text, '').catch(() => false);
    return { content: [{ type: 'text', text: ok ? 'sent' : 'push is not set up, so nothing was sent' }] };
  });
  const stop = tool('stop_job', 'Turn this job off so it does not run again, for a job whose work is done.', {}, async () => {
    applyChanges(db, [{ table: 'jobs', id: job.id, profile: job.profile, updated_at: Date.now(), fields: { enabled: 0, next_run_at: null } }]);
    return { content: [{ type: 'text', text: 'turned off' }] };
  });
  const allow = jobAllows(job.tools);
  const browser = allow.browser && ownProfile();
  const prompt = [
    job.prompt ?? '',
    '',
    allow.names.length
      ? `This runs on a schedule with no one watching. Only read, except with the tools this job allows: ${allow.names.join(', ')}.`
      : 'This runs on a schedule with no one watching. Only read: do not send, post, create or change anything outside Codex.',
    ...(browser ? ['The mcp__browser tools drive AgentView\'s own Chrome, which holds its own logins. Wait for a page to finish loading before you read it.'] : []),
    'Use ask_context to see what my wiki, meetings, Slack decisions and open tasks say about something. Use add_task for anything I need to act on, notify for anything I must see right away, and stop_job once its work is done for good. End with a short plain-text result for a phone notification. Do not use the em dash character.',
  ].join('\n');
  let result = '';
  let cost: number | null = null;
  for await (const m of ask(account, prompt, {
    model: 'sonnet',
    maxTurns: 30,
    cwd: os.tmpdir(),
    tools: ['WebSearch', 'WebFetch'],
    mcpServers: {
      codex: createSdkMcpServer({ name: 'codex', tools: [addTask, push, stop, contextTool(db)] }),
      ...(browser ? { browser: { type: 'stdio' as const, command: 'npx', args: ['-y', '@playwright/mcp@latest', '--cdp-endpoint', `http://127.0.0.1:${PROFILE_PORT}`] } } : {}),
    },
    allowedTools: ['WebSearch', 'WebFetch', 'mcp__codex__add_task', 'mcp__codex__notify', 'mcp__codex__stop_job', 'mcp__codex__ask_context'],
    canUseTool: async (name, input) => (canRead(name) || allow.allows(name) ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'This job can only read and use the tools it allows.' }),
  }, 20 * 60_000, job.id)) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`Ended with ${m.subtype}`);
      result = m.result.trim();
      cost = m.total_cost_usd;
    }
  }
  return { result, added, notified, cost };
}

// A job with a repo starts a worktree chat on the AgentView server of this Mac, which does the work; returns the run's output.
async function startCoding(job: Job, repo: string) {
  const res = await fetch(`${process.env.AGENTVIEW_URL ?? 'http://127.0.0.1:7777'}/api/jobs/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, title: job.name ?? 'Job', repo, prompt: job.prompt }),
    signal: AbortSignal.timeout(2 * MIN),
  }).catch((err) => Promise.reject(new Error(`Could not start: ${errText(err)}`)));
  if (res.status === 409) return 'Skipped: the last run is still open';
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Could not start: ${body?.error ?? res.status}`);
  return `Started ${body.branch} in ${path.basename(repo)}`;
}

// Fills in the next run of enabled jobs that have none and returns the jobs that are due. A job that is off has a next
// run only when Run now was pressed.
export function dueJobs(db: Database, now = Date.now()): Job[] {
  const jobs = db.prepare('SELECT id, profile, name, schedule, prompt, enabled, next_run_at, tools, repo FROM jobs WHERE deleted = 0').all() as Job[];
  const plan: Change[] = [];
  for (const j of jobs) {
    if (j.next_run_at != null || !j.enabled) continue;
    const next = nextRun(j.schedule, now);
    if (next) plan.push({ table: 'jobs', id: j.id, profile: j.profile, updated_at: now, fields: { next_run_at: next } });
  }
  applyChanges(db, plan);
  return jobs.filter((j) => j.next_run_at != null && j.next_run_at <= now && j.prompt?.trim());
}

// Keeps the last runs of each job; the output of older ones is dropped, since their rows stay behind for sync.
function prune(db: Database, job: Job, now: number) {
  const old = db.prepare('SELECT id FROM runs WHERE deleted = 0 AND profile = ? AND job_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET ?').all(job.profile, job.id, KEEP) as { id: string }[];
  applyChanges(db, old.map((r) => ({ table: 'runs', id: r.id, profile: job.profile, deleted: true, updated_at: now, fields: { output: null } })));
}

const CONCURRENCY = 2;

export async function runDue(db: Database, now = Date.now(), run: typeof runJob = runJob, notify = pushNtfy, reply = replyToCommand) {
  const queue = dueJobs(db, now);
  const worker = async () => {
    for (let due = queue.shift(); due; due = queue.shift()) await runOne(db, due, run, notify, reply).catch(() => {});
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
}

async function runOne(db: Database, due: Job, run: typeof runJob, notify: typeof pushNtfy, reply: typeof replyToCommand) {
  // Earlier jobs can run for minutes; skip or update this one if it was turned off, deleted or edited meanwhile.
  const live = db.prepare('SELECT prompt, tools, repo, next_run_at, field_times FROM jobs WHERE id = ? AND profile = ? AND deleted = 0').get(due.id, due.profile) as { prompt: string | null; tools: string | null; repo: string | null; next_run_at: number | null; field_times: string } | null;
  if (!live || live.next_run_at == null || live.next_run_at > Date.now() || !live.prompt?.trim()) return;
  const job = { ...due, prompt: live.prompt, tools: live.tools, repo: live.repo };
  const planned = JSON.parse(live.field_times).next_run_at;
  if (await verifyLimit(ACCOUNT_OF[job.profile])) return;
  const id = randomUUID();
  const started = Date.now();
  applyChanges(db, [{ table: 'runs', id, profile: job.profile, updated_at: started, fields: { job_id: job.id, started_at: started, status: 'running' } }]);
  let status = 'ok';
  let output = '';
  let notified = false;
  let cost: number | null = null;
  try {
    if (job.repo) output = await startCoding(job, job.repo);
    else {
      // Two jobs on AgentView's one Chrome would fight over its tabs, so browser jobs take turns.
      const go = () => run(db, job, notify);
      const { result, added, ...r } = await (jobAllows(job.tools).browser ? serial('job-browser', go) : go());
      notified = r.notified;
      cost = r.cost;
      output = [result, added.length ? `Added: ${added.join('; ')}` : ''].filter(Boolean).join('\n\n') || 'Finished with nothing to report';
    }
  } catch (err) {
    status = 'error';
    output = errText(err);
  }
  const done = Date.now();
  const changes: Change[] = [{ table: 'runs', id, profile: job.profile, updated_at: done, fields: { finished_at: done, status, output, cost } }];
  // An edit made during the run (Off, a new schedule, Run now) set next_run_at itself, so it is kept. Its field time
  // comes from the client's clock, so only whether it changed is compared.
  const cur = db.prepare('SELECT schedule, enabled, field_times FROM jobs WHERE id = ? AND profile = ?').get(job.id, job.profile) as { schedule: string | null; enabled: number | null; field_times: string } | null;
  if (cur && JSON.parse(cur.field_times).next_run_at === planned) {
    // A schedule with no run left (a one-off) turns the job off.
    const next = cur.enabled ? nextRun(cur.schedule, done) : null;
    changes.push({ table: 'jobs', id: job.id, profile: job.profile, updated_at: done, fields: next == null ? { next_run_at: null, enabled: 0 } : { next_run_at: next } });
  }
  applyChanges(db, changes);
  prune(db, job, done);
  await reply(db, job.id, status === 'ok', output);
  if (status !== 'ok' || (!job.repo && !notified && /\b(push|notify)\b/i.test(job.prompt ?? ''))) await notify(status === 'ok' ? job.name ?? 'Job' : `${job.name ?? 'Job'} failed`, '', output.slice(0, 500), '').catch(() => {});
}

// A run cut off by a hub restart is marked failed; its job runs again at the next tick.
function endInterrupted(db: Database, now = Date.now()) {
  const stuck = db.prepare("SELECT id, profile FROM runs WHERE deleted = 0 AND status = 'running'").all() as { id: string; profile: Profile }[];
  applyChanges(db, stuck.map((r) => ({ table: 'runs', id: r.id, profile: r.profile, updated_at: now, fields: { finished_at: now, status: 'error', output: 'Interrupted by a restart' } })));
}

// Runs of a job deleted a day ago are deleted too; the wait leaves time to undo the delete.
export function dropOrphanRuns(db: Database, now = Date.now()) {
  const rows = db.prepare("SELECT r.id, r.profile FROM runs r JOIN jobs j ON j.profile = r.profile AND j.id = r.job_id AND j.deleted = 1 AND CAST(json_extract(j.field_times, '$.deleted') AS INTEGER) < ? WHERE r.deleted = 0").all(now - DAY) as { id: string; profile: Profile }[];
  return applyChanges(db, rows.map((r) => ({ table: 'runs', id: r.id, profile: r.profile, deleted: true, updated_at: now, fields: { output: null } }))).applied;
}

export const orphansDue = (last: number | null, now = Date.now()) => last == null || now - last >= HOUR;

export function startJobs(db: () => Database, every = MIN) {
  endInterrupted(db());
  let orphansAt: number | null = null;
  loop('jobs', every, async () => {
    if (orphansDue(orphansAt)) {
      dropOrphanRuns(db());
      orphansAt = Date.now();
    }
    await runDue(db());
  });
}
