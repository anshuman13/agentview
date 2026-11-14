import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { BuildEntry } from '../../../shared/builds.js';
import type { AgentEvent, ChatEvent } from '../../../shared/protocol.js';
import { claudeSession } from '../agent/claude/driver.js';
import { buildList, buildOne, reviewBuild, splitPhases } from './builds.js';
import { stubGlobal, unstubAllGlobals, waitFor } from '../../../testing.js';
import { announceApproval } from '../host/approval.js';
import { firstSeen } from './approvalSeen.js';

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'agentview-builds-')));
const repo = path.join(root, 'repo');
const worktree = path.join(root, 'wt');
const store = path.join(root, 'store');
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
let commit = '';
let tree = '';

beforeAll(() => {
  process.env.AGENTVIEW_BUILDS = store;
  mkdirSync(repo);
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 't@t');
  sh(repo, 'config', 'user.name', 't');
  writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'init');
  sh(root, 'init', '-q', '--bare', 'origin.git');
  sh(repo, 'remote', 'add', 'origin', path.join(root, 'origin.git'));
  sh(repo, 'push', '-q', 'origin', 'main');
  sh(repo, 'remote', 'set-head', 'origin', 'main');
  sh(repo, 'checkout', '-q', '-b', 'feat/x');
  writeFileSync(path.join(repo, 'feat.txt'), 'f\n');
  sh(repo, 'add', '.');
  sh(repo, 'commit', '-q', '-m', 'Add the kettle');
  commit = sh(repo, 'rev-parse', 'HEAD');
  tree = sh(repo, 'rev-parse', 'HEAD^{tree}');
  sh(repo, 'checkout', '-q', 'main');
  sh(repo, 'worktree', 'add', '-q', worktree, '-b', 'wt-branch');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const agent = (id: string, description: string, status: AgentEvent['status'] = 'running'): AgentEvent => ({ id: `${id}:agent`, kind: 'agent', toolUseId: id, description, subagentType: 'Build', model: null, background: false, prompt: '', status, startedAt: 1000 + n++, endedAt: status === 'running' ? null : 2000, progress: null, usage: null, at: 1000 });
const result = (id: string, text: string): ChatEvent => ({ id: `${id}:result${n++}`, kind: 'tool_result', toolUseId: id, text, isError: false, at: 2000 });
const stored = (slug: string) => JSON.parse(readFileSync(path.join(store, encodeURIComponent(repo), `${slug}.json`), 'utf8')) as BuildEntry[];

describe('recording builds', () => {
  it('catches a stale running entry up from a loaded history', async () => {
    const s = claudeSession(repo);
    s.pushEvent(agent('h1', 'test:blue-cup#1'));
    await waitFor(() => expect(stored('blue-cup')).toMatchObject([{ id: 'h1', status: 'running' }]));
    s.replaceHistory({ events: [agent('h1', 'test:blue-cup#1', 'done'), result('h1', '1. pass: ok')], context: null, cache: null } as never);
    await waitFor(() => expect(stored('blue-cup')).toMatchObject([{ id: 'h1', status: 'done', report: '1. pass: ok' }]));
  });

  it('records the agents of a run whose call is before a compaction', async () => {
    const s = claudeSession(repo);
    s.replaceHistory({ events: [], context: null, cache: null, unshown: [agent('u1', 'test:gold-key#1', 'done'), result('u1', '1. pass: ok')] } as never);
    await waitFor(() => expect(stored('gold-key')).toMatchObject([{ id: 'u1', status: 'done', report: '1. pass: ok' }]));
    expect(s.state.events).toHaveLength(0);
  });

  it('keeps one entry for a running agent that ends, and one for a hand-back emitted twice', async () => {
    const s = claudeSession(repo);
    const a = agent('t1', 'test:red-lamp#1');
    s.pushEvent(a);
    await waitFor(() => expect(stored('red-lamp')).toMatchObject([{ id: 't1', stage: 'test', round: 1, status: 'running', chat: s.id }]));
    Object.assign(a, { status: 'done', endedAt: 2000 });
    s.pushEvent(result('t1', 'Launched'));
    s.emit({ type: 'event', event: result('t1', '1. pass: ok') });
    await waitFor(() => expect(stored('red-lamp')).toMatchObject([{ id: 't1', status: 'done', endedAt: 2000, report: '1. pass: ok' }]));
  });

  it('keeps both of two agents that end together, in the next round when the label has none', async () => {
    const s = claudeSession(repo);
    for (const id of ['p1', 'p2']) {
      const a = agent(id, 'pm:green-door', 'done');
      s.pushEvent(a);
      s.pushEvent(result(id, `spec ${id}`));
    }
    await waitFor(() => expect(stored('green-door').map((e) => [e.id, e.round, e.report])).toEqual([['p1', 1, 'spec p1'], ['p2', 2, 'spec p2']]));
  });

  it('records a chat in a worktree under the main checkout and ignores other agents', async () => {
    const s = claudeSession(worktree);
    s.pushEvent({ ...agent('g1', 'Search the code', 'done'), subagentType: 'general-purpose' });
    s.pushEvent(agent('w1', 'impl:blue-cup', 'done'));
    await waitFor(() => expect(stored('blue-cup')).toHaveLength(1));
    expect(readdirSync(store)).toEqual([encodeURIComponent(repo)]);
  });

  it('stores the first token that is a commit, skipping a tree', async () => {
    const s = claudeSession(repo);
    s.pushEvent(agent('i1', 'impl:red-lamp', 'done'));
    s.pushEvent(result('i1', `tree ${tree} commit ${commit}`));
    await waitFor(() => expect(stored('red-lamp').find((e) => e.id === 'i1')?.commit).toMatchObject({ sha: commit, subject: 'Add the kettle', branch: 'feat/x', files: [{ path: 'feat.txt', additions: 1, deletions: 0 }] }));
    s.pushEvent(agent('i2', 'impl:blue-cup', 'done'));
    s.pushEvent(result('i2', `tree ${tree}`));
    await waitFor(() => expect(stored('blue-cup').find((e) => e.id === 'i2')).toBeTruthy());
    expect(stored('blue-cup').find((e) => e.id === 'i2')?.commit).toBeUndefined();
  });
});

describe('recorded tokens', () => {
  it('stores the final usage, none while running, and keeps it through a replay without usage', async () => {
    const s = claudeSession(repo);
    const a = agent('k1', 'test:pink-vase#1');
    s.pushEvent({ ...a, usage: { tokens: 10, toolUses: 1, durationMs: 1 } });
    await waitFor(() => expect(stored('pink-vase')).toMatchObject([{ id: 'k1', status: 'running' }]));
    expect(stored('pink-vase')[0].tokens).toBeUndefined();
    const done = { ...a, status: 'done' as const, endedAt: 2000, usage: { tokens: 4200, toolUses: 3, durationMs: 900 } };
    s.pushEvent(done);
    await waitFor(() => expect(stored('pink-vase')[0].tokens).toBe(4200));
    s.replaceHistory({ events: [{ ...done, usage: null }, result('k1', '1. pass: ok')], context: null, cache: null } as never);
    await waitFor(() => expect(stored('pink-vase')[0].report).toBe('1. pass: ok'));
    expect(stored('pink-vase')[0].tokens).toBe(4200);
  });
});

describe('build routes', () => {
  it('reports a build merged once its commit is cherry-picked onto the default branch', async () => {
    expect(await buildOne(repo, 'red-lamp')).toMatchObject({ title: 'red-lamp', summary: { state: 'done', conclusion: 'Passed · not merged yet' } });
    execFileSync('git', ['cherry-pick', commit], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: new Date(Date.now() + 60_000).toISOString() } });
    const picked = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
    expect(picked).not.toBe(commit);
    expect(await buildOne(worktree, 'red-lamp')).toMatchObject({ summary: { conclusion: `Merged as ${picked.slice(0, 7)}` } });
  });

  it('keeps a build merged and sees a later build merge as the default branch moves', async () => {
    const conclusion = async () => ((await buildOne(repo, 'red-lamp')) as { summary: { conclusion: string } }).summary.conclusion;
    const before = await conclusion();
    expect(await conclusion()).toEqual(before);
    sh(repo, 'commit', '-q', '--allow-empty', '-m', 'Unrelated');
    expect(await conclusion()).toEqual(before);
  });

  it('gives the slug as the title and no spec when the spec file is missing, and 404 for a bad slug', async () => {
    const one = await buildOne(repo, 'red-lamp');
    expect(one).toMatchObject({ title: 'red-lamp', phases: [], commit: { files: [{ path: 'feat.txt' }] } });
    expect(await buildOne(repo, '../x')).toMatchObject({ status: 404 });
    expect(await buildOne(repo, 'missing')).toMatchObject({ status: 404 });
  });
});

describe('spec review', () => {
  const specs = path.join(repo, '.claude', 'specs');
  const body = '# Pink Door\n\nIntro\n\n## Behaviour\n1. x\n\n### Detail\nkept\n\n## Touches\na.ts\n\n## Acceptance criteria\n- [ ] one\n\n## Other\nstays with tasks\n';
  const reviews = (slug: string) => JSON.parse(readFileSync(path.join(store, encodeURIComponent(repo), `${slug}.reviews.json`), 'utf8'));

  beforeAll(() => {
    appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude/specs/\n');
    mkdirSync(specs, { recursive: true });
    writeFileSync(path.join(specs, 'pink-door.md'), body);
    writeFileSync(path.join(specs, 'tracked.md'), body);
    sh(repo, 'add', '-f', '.claude/specs/tracked.md');
    mkdirSync(path.join(repo, '.kiro', 'specs', 'kiro-one'), { recursive: true });
    writeFileSync(path.join(repo, '.kiro', 'specs', 'kiro-one', 'requirements.md'), '# Kiro title\n\nreq\n');
    writeFileSync(path.join(repo, '.kiro', 'specs', 'kiro-one', 'tasks.md'), '- [ ] t\n');
  });

  it('reads a spec no agent touched and a Kiro folder, and splits a spec into phases', async () => {
    expect(await buildOne(repo, 'pink-door')).toMatchObject({ title: 'Pink Door', pipeline: 'written', summary: { conclusion: 'Not started' } });
    expect(await buildOne(repo, 'kiro-one')).toMatchObject({ title: 'Kiro title', entries: [] });
    const one = (await buildOne(repo, 'pink-door')) as { entries: unknown[]; phases: { key: string; markdown: string }[] };
    expect(one.entries).toEqual([]);
    expect(one.phases.map((p) => p.key)).toEqual(['requirements', 'design', 'tasks']);
    expect(one.phases[0].markdown).toContain('kept');
    expect(one.phases[1].markdown).toContain('a.ts');
    expect(one.phases[2].markdown).toContain('stays with tasks');
    expect(((await buildOne(repo, 'kiro-one')) as { phases: { key: string }[] }).phases.map((p) => p.key)).toEqual(['requirements', 'tasks']);
  });

  it('adds the sketch file as a last phase holding its HTML, and takes a sketch decision', async () => {
    writeFileSync(path.join(specs, 'drawn.md'), body);
    mkdirSync(path.join(repo, '.claude', 'sketches'), { recursive: true });
    writeFileSync(path.join(repo, '.claude', 'sketches', 'drawn.html'), '<p>mock</p>');
    const one = (await buildOne(repo, 'drawn')) as { phases: { key: string; markdown: string }[]; flow: { key: string }[] };
    expect(one.phases.map((p) => p.key)).toEqual(['requirements', 'design', 'tasks', 'sketch']);
    expect(one.phases[3].markdown).toBe('<p>mock</p>');
    expect(one.flow.map((f) => f.key)).toContain('sketch');
    expect(await reviewBuild(repo, { slug: 'drawn', phase: 'sketch', decision: 'changes', note: 'bigger' })).toEqual({ ok: true });
    expect(((await buildOne(repo, 'pink-door')) as { phases: { key: string }[] }).phases.map((p) => p.key)).not.toContain('sketch');
  });

  it('records a decision in the JSON and one line under a single Review notes section of an ignored spec', async () => {
    expect(await reviewBuild(repo, { slug: 'pink-door', phase: 'requirements', decision: 'approve', note: '' })).toEqual({ ok: true });
    expect(await reviewBuild(repo, { slug: 'pink-door', phase: 'design', decision: 'changes', note: 'split\nit' })).toEqual({ ok: true });
    const text = readFileSync(path.join(specs, 'pink-door.md'), 'utf8');
    expect(text.startsWith(body)).toBe(true);
    expect(text.slice(body.length).split('\n')).toEqual(['', '## Review notes', expect.stringMatching(/^- \d{4}-\d\d-\d\d \d\d:\d\d Requirements: Approved$/), expect.stringMatching(/^- \d{4}-\d\d-\d\d \d\d:\d\d Design: Changes requested: split it$/), '']);
    expect(reviews('pink-door')).toMatchObject([{ phase: 'requirements', decision: 'approve' }, { phase: 'design', decision: 'changes', note: 'split it' }]);
    const one = (await buildOne(repo, 'pink-door')) as { phases: { markdown: string }[]; pipeline: string };
    expect(one.phases.some((p) => p.markdown.includes('Review notes'))).toBe(false);
    expect(one.pipeline).toBe('reviewed');
  });

  it('writes one Review notes heading for two reviews at once', async () => {
    writeFileSync(path.join(specs, 'racing.md'), body);
    await Promise.all([reviewBuild(repo, { slug: 'racing', phase: 'design', decision: 'approve' }), reviewBuild(repo, { slug: 'racing', phase: 'tasks', decision: 'approve' })]);
    const text = readFileSync(path.join(specs, 'racing.md'), 'utf8');
    expect(text.match(/^## Review notes$/gm)).toHaveLength(1);
    expect(reviews('racing')).toHaveLength(2);
  });

  it('leaves a tracked spec file unchanged', async () => {
    expect(await reviewBuild(repo, { slug: 'tracked', phase: 'tasks', decision: 'changes', note: 'x' })).toEqual({ ok: true });
    expect(readFileSync(path.join(specs, 'tracked.md'), 'utf8')).toBe(body);
    expect(reviews('tracked')).toMatchObject([{ phase: 'tasks', decision: 'changes' }]);
  });

  it('records a code decision once an implement entry exists, and a hold then its release', async () => {
    writeFileSync(path.join(specs, 'coded.md'), body);
    expect(await reviewBuild(repo, { slug: 'coded', phase: 'code', decision: 'approve' })).toMatchObject({ status: 400 });
    const entry = { id: 'i1', stage: 'implement', round: 1, status: 'done', startedAt: 1, endedAt: 2, report: 'done', chat: 'c', session: null };
    writeFileSync(path.join(store, encodeURIComponent(repo), 'coded.json'), JSON.stringify([entry]));
    expect(await reviewBuild(repo, { slug: 'coded', phase: 'code', decision: 'changes', note: 'rename it' })).toEqual({ ok: true });
    expect(await reviewBuild(repo, { slug: 'coded', decision: 'hold' })).toEqual({ ok: true });
    const held = (await buildOne(repo, 'coded')) as { hold: boolean; codeReview: { decision: string } };
    expect(held).toMatchObject({ hold: true, codeReview: { decision: 'changes' } });
    expect(await reviewBuild(repo, { slug: 'coded', decision: 'release' })).toEqual({ ok: true });
    expect(((await buildOne(repo, 'coded')) as { hold: boolean }).hold).toBe(false);
    const lines = readFileSync(path.join(specs, 'coded.md'), 'utf8').slice(body.length).split('\n').slice(2, -1);
    expect(lines).toEqual([expect.stringMatching(/ Code: Changes requested: rename it$/), expect.stringMatching(/ Hold: do not start or continue this spec$/), expect.stringMatching(/ Hold released$/)]);
    expect(reviews('coded')).toHaveLength(3);
  });

  it('answers 400 for bad input and 404 for a missing spec', async () => {
    for (const bad of [{ slug: '../x', phase: 'design', decision: 'approve' }, { slug: 'pink-door', phase: 'code', decision: 'approve' }, { slug: 'pink-door', phase: 'design', decision: 'hold' }, { slug: 'pink-door', phase: 'hold', decision: 'hold' }, { slug: 'pink-door', decision: 'approve' }, { slug: 'pink-door', phase: 'design', decision: 'changes', note: '  ' }]) {
      expect(await reviewBuild(repo, bad)).toMatchObject({ status: 400 });
    }
    expect(await reviewBuild(repo, { slug: 'no-such-spec', phase: 'design', decision: 'approve' })).toMatchObject({ status: 404 });
  });
});

describe('approval', () => {
  const specs = path.join(repo, '.claude', 'specs');
  const sent = vi.fn(async (_url: string, _init: RequestInit) => new Response(''));
  const tell = vi.fn();
  const live = (id: string) => ({ id, cwd: repo, title: 'T' }) as never;
  const gate = (toolUseId: string, slug: string, over: Partial<AgentEvent> = {}) => ({ ...agent(toolUseId, `gate:${slug}`), startedAt: Date.now(), ...over });
  const start = (chatId: string, ev: AgentEvent, away = true) => announceApproval({ id: chatId, cwd: repo }, ev, () => (away ? live(chatId) : null), tell).then(() => waitFor(() => undefined));
  const decisions = (slug: string) => JSON.parse(readFileSync(path.join(store, encodeURIComponent(repo), `${slug}.reviews.json`), 'utf8')).map((r: { phase: string }) => r.phase);

  beforeAll(() => {
    appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.claude/specs/\n.claude/sketches/\n');
    mkdirSync(specs, { recursive: true });
    writeFileSync(path.join(specs, 'warm-lamp.md'), '# Warm Lamp\n\n## Problem\nThe lamp is cold. It stays cold.\n\n## Behaviour\n1. x\n\n## Design\nd\n\n## Acceptance criteria\n- [ ] one\n');
    writeFileSync(path.join(specs, 'bare.md'), 'Just words\n\n## Behaviour\n1. x\n');
  });
  beforeEach(() => {
    process.env.AGENTVIEW_NTFY = 'topic';
    stubGlobal('fetch', sent);
  });
  afterEach(() => {
    unstubAllGlobals();
    delete process.env.AGENTVIEW_NTFY;
    sent.mockClear();
    tell.mockClear();
  });

  it('pushes a running gate once, with the spec title, problem and link, and tells the clients', async () => {
    await start('a1', gate('g1', 'warm-lamp'));
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    const [, init] = sent.mock.calls[0];
    expect(init.headers).toMatchObject({ Title: 'Approve Warm Lamp?', Click: 'http://localhost:7777/?chat=a1&slug=warm-lamp' });
    expect(init.body).toBe('T\nThe lamp is cold.');
    expect(tell).toHaveBeenCalledWith({ type: 'approval', chat: 'a1', slug: 'warm-lamp', title: 'Warm Lamp' });
    await start('a1', gate('g1', 'warm-lamp'));
    await start('a2', gate('g2', 'warm-lamp', { status: 'done' }));
    await start('a2', gate('g3', 'warm-lamp', { startedAt: Date.now() - 120_000 }));
    await start('a2', gate('g4', 'warm-lamp'), false);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(tell).toHaveBeenCalledTimes(1);
  });

  it('never repeats a chat and slug from the stored set, and pushes the same slug for another chat', async () => {
    expect(await firstSeen('a1:warm-lamp')).toBe(false);
    expect(await firstSeen('a9:warm-lamp')).toBe(true);
    await start('a1', gate('g5', 'warm-lamp'));
    await start('a3', gate('g6', 'warm-lamp'));
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(tell).toHaveBeenCalledWith(expect.objectContaining({ chat: 'a3' }));
  });

  it('falls back to the slug and a ready line, and skips a held, removed or fully approved spec', async () => {
    await start('b1', gate('h1', 'bare'));
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    expect(sent.mock.calls[0][1].headers).toMatchObject({ Title: 'Approve bare?' });
    expect(sent.mock.calls[0][1].body).toBe('T\nSpec bare is ready');
    await reviewBuild(repo, { slug: 'warm-lamp', decision: 'hold' });
    await start('b2', gate('h2', 'warm-lamp'));
    await start('b2', gate('h3', 'no-such-spec'));
    await reviewBuild(repo, { slug: 'warm-lamp', decision: 'release' });
    await reviewBuild(repo, { slug: 'warm-lamp', phase: 'all', decision: 'approve' });
    await start('b2', gate('h4', 'warm-lamp'));
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('approves the missing phases in one update, with the sketch when present, never code, and only once', async () => {
    writeFileSync(path.join(specs, 'flat-cap.md'), '# Flat Cap\n\n## Problem\np\n\n## Design\nd\n\n## Acceptance criteria\n- [ ] one\n');
    mkdirSync(path.join(repo, '.claude', 'sketches'), { recursive: true });
    writeFileSync(path.join(repo, '.claude', 'sketches', 'flat-cap.html'), '<p>x</p>');
    await reviewBuild(repo, { slug: 'flat-cap', phase: 'design', decision: 'approve' });
    expect(await reviewBuild(repo, { slug: 'flat-cap', phase: 'all', decision: 'approve' })).toEqual({ ok: true });
    expect(decisions('flat-cap')).toEqual(['design', 'requirements', 'tasks', 'sketch']);
    expect(await reviewBuild(repo, { slug: 'flat-cap', phase: 'all', decision: 'approve' })).toEqual({ ok: true, already: true });
    expect(decisions('flat-cap')).toHaveLength(4);
    expect(await reviewBuild(repo, { slug: 'flat-cap', phase: 'all', decision: 'changes', note: 'x' })).toMatchObject({ status: 400 });
    await reviewBuild(repo, { slug: 'bare', decision: 'hold' });
    expect(await reviewBuild(repo, { slug: 'bare', phase: 'all', decision: 'approve' })).toEqual({ status: 400, body: { error: 'Held' } });
  });
});

describe('spec criteria and flow', () => {
  const specs = path.join(repo, '.claude', 'specs');
  const spec = '# Crit\n\n## Behaviour\n```\n## Fake\n```\nb\n\n## Acceptance criteria\n1. One (1)\n2. Two (UI)\n3. Three\n\n## Review notes\n- note\n';
  const write = (slug: string, reports: string[]) =>
    writeFileSync(path.join(store, encodeURIComponent(repo), `${slug}.json`), JSON.stringify(reports.map((report, i) => ({ id: `t${i}`, stage: 'test', round: i + 1, status: 'done', startedAt: i, endedAt: i, report, chat: 'c', session: null }))));

  it('splits a spec into phases without its Review notes', () => {
    const phases = splitPhases(spec);
    expect(phases.map((p) => p.key)).toEqual(['requirements', 'tasks']);
    expect(phases[0].markdown).toBe('# Crit\n\n## Behaviour\n```\n## Fake\n```\nb');
    expect(phases[1].markdown).not.toContain('note');
  });

  it('joins spec criteria with the latest test report, and lists test lines the spec lacks', async () => {
    writeFileSync(path.join(specs, 'crit-one.md'), spec);
    write('crit-one', ['1. fail: old', '', '1. pass: ok\n2. fail: no\n9. unverified: later']);
    const one = (await buildOne(repo, 'crit-one')) as { criteria: unknown[]; flow: unknown[] };
    expect(one.criteria).toEqual([
      { n: 1, text: 'One', ui: false, result: 'pass', evidence: 'ok' },
      { n: 2, text: 'Two', ui: true, result: 'fail', evidence: 'no' },
      { n: 3, text: 'Three', ui: false, result: 'pending', evidence: '' },
      { n: 9, text: 'Criterion 9', ui: false, result: 'unverified', evidence: 'later' },
    ]);
    expect(one.flow).toHaveLength(7);
  });

  it('gives pending criteria and a seven-step flow for a spec with no entries', async () => {
    writeFileSync(path.join(specs, 'crit-none.md'), spec);
    const one = (await buildOne(repo, 'crit-none')) as { criteria: { result: string }[]; flow: unknown[]; entries: unknown[]; hold: boolean };
    expect(one.criteria.map((c) => c.result)).toEqual(['pending', 'pending', 'pending']);
    expect(one).toMatchObject({ entries: [], hold: false });
    expect(one.flow).toHaveLength(7);
  });
});

describe('build list', () => {
  const specs = path.join(repo, '.claude', 'specs');
  const list = async () => (await buildList(repo)) as { slug: string; built: boolean; waiting: boolean; pipeline: string; sketched: boolean }[];

  it('lists specs with their build state, skipping bad names', async () => {
    mkdirSync(specs, { recursive: true });
    writeFileSync(path.join(specs, 'plain-one.md'), '# Plain\n');
    writeFileSync(path.join(specs, 'notes.txt'), 'x');
    writeFileSync(path.join(specs, 'a..b.md'), '# Bad\n');
    const items = await list();
    expect(items.map((i) => i.slug)).not.toContain('a..b');
    expect(items.map((i) => i.slug)).not.toContain('notes');
    expect(items.find((i) => i.slug === 'plain-one')).toMatchObject({ built: false, waiting: false });
  });

  it('marks a spec waiting once its spec review is done without approval, and a merged build merged', async () => {
    writeFileSync(path.join(specs, 'wait-one.md'), '# Wait\n\n## Behaviour\n1. x\n');
    const s = claudeSession(repo);
    s.pushEvent(agent('r1', 'review:wait-one', 'done'));
    s.pushEvent(result('r1', 'Verdict: approve'));
    await waitFor(() => expect(stored('wait-one')).toHaveLength(1));
    expect((await list()).find((i) => i.slug === 'wait-one')).toMatchObject({ waiting: true, built: false });
    expect((await list()).find((i) => i.slug === 'red-lamp')).toBeUndefined();
    writeFileSync(path.join(specs, 'red-lamp.md'), '# Lamp\n');
    expect((await list()).find((i) => i.slug === 'red-lamp')).toMatchObject({ built: true, pipeline: 'merged' });
  });

  it('marks a spec sketched by its sketch file or a sketch run', async () => {
    mkdirSync(specs, { recursive: true });
    writeFileSync(path.join(specs, 'sk-none.md'), '# None\n');
    writeFileSync(path.join(specs, 'sk-file.md'), '# File\n');
    writeFileSync(path.join(specs, 'sk-run.md'), '# Run\n');
    mkdirSync(path.join(repo, '.claude', 'sketches'), { recursive: true });
    writeFileSync(path.join(repo, '.claude', 'sketches', 'sk-file.html'), '<p>mock</p>');
    const s = claudeSession(repo);
    s.pushEvent(agent('sk1', 'sketch:sk-run', 'done'));
    await waitFor(() => expect(stored('sk-run')).toHaveLength(1));
    const by = Object.fromEntries((await list()).map((i) => [i.slug, i.sketched]));
    expect(by).toMatchObject({ 'sk-none': false, 'sk-file': true, 'sk-run': true, 'red-lamp': false });
  });

  it('returns the 20 newest specs, newest first', async () => {
    for (let i = 0; i < 25; i++) {
      const file = path.join(specs, `many-${String(i).padStart(2, '0')}.md`);
      writeFileSync(file, `# Many ${i}\n`);
      utimesSync(file, new Date(2030, 0, 1, 0, i), new Date(2030, 0, 1, 0, i));
    }
    expect((await list()).map((i) => i.slug)).toEqual(Array.from({ length: 20 }, (_, i) => `many-${String(24 - i).padStart(2, '0')}`));
  });
});
