process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { barHidden, barIdle, barState, type BarEvent } from '../../shared/bottomBar';
import { reviewLabel, usageMenuLabel } from '../../shared/chatMenu';
import { advisorBoard, advisorLoopLine, advisorLoopOf, auditCountLine, defaultAdvisorRoot, specItemPrompt, type BacklogItem } from '../../shared/advisors';
import { specRowParts, type SpecHomeItem } from '../../shared/builds';
import { appCounts } from '../../shared/counts';
import { TABLES } from '../../shared/tables';
import { editCount, stripRound } from '../../shared/edits';
import { buildsLine, finishedLine, mergeQuiet } from '../../shared/goalText';
import { exploreLabelOf, exploreRunsOf, type ExploreRow } from '../../shared/explore';
import { FEATURES, featureRows, paletteFeature, shownFeature, type UseDays } from '../../shared/featureUse';
import type { Capabilities, ChatEvent, ChatRun, LiveChat, Provider, Round, Try } from '../../shared/protocol';
import { billing, menuModes, modeSteps, newestModels, providerLabel, providerMark, providerModes, type Billing } from '../../shared/providers';
import { setupPrompt, type SetupKind } from '../../shared/setupPrompt';
import { appendRule } from '../../shared/steering';
import { addPreset, parsePresets, removePreset, type GoalPreset } from '../../shared/goalPresets';
import { goalCommand, parseEvery, planOf, type GoalForm } from '../../shared/goalForm';
import { buildPrompt, isSpecPath, planCondition, runAllPrompt, specProgress, specPrompt, specSlug, specTasks, startTaskPrompt, withoutOpenTasks, type SpecTask } from '../../shared/specTasks';
import { isSketchPath, sketchDoc, type SketchTheme } from '../../shared/sketches';
import { latestTodos, todoCount, todoCurrent, todoProgress, type TodoItem } from '../../shared/todos';
import { mergeTail } from './app/runtime/pageEvents';
import { countChat } from './app/store/counts';
import { can } from './chat/capabilitiesLogic';
import { chatState, handoffText, runLine, stoppedText } from './chat/composer/composerLogic';
import { tryColumn } from './sessions/triesLogic';
import { parseWhen, stripWhen } from './codex/data/tasks/when';
import { needsYou } from './codex/summary/needsYou';
import { reviewQueue } from './codex/wiki/reviewQueue';
import { revertBlock } from './workspace/revertBlock';
import { ago, money } from './ui/util';
import { setSystemTime } from '../../testing';
import { guessProfile } from './codex/data/ask/ask';
import type { Profile } from './codex/data/sync';
import type { Meeting } from './codex/data/wiki/wiki';
import type { ItemRow } from './codex/data/sync';
import { actionCount, displayName, filterMeetings, groupMeetings, inSeries, isEvent, meetingState, sameName, seriesTitle, type MeetingChip } from './codex/data/meetings/meetings';
import { dismissedKeys, mergeDismissed } from '../../shared/dismissed';

const cases = <T>(file: string): T[] => JSON.parse(readFileSync(new URL(`../../shared/fixtures/${file}.json`, import.meta.url), 'utf8'));

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

describe('cases shared with the Android app', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    setSystemTime();
  });

  type Guess = { name: string; question: string; fallback: Profile; expected: Profile; meetings: { title: string; profile: Profile; startsInHours: number; deleted?: boolean }[] };
  for (const c of cases<Guess>('guess-profile')) {
    it(`guessProfile: ${c.name}`, () => {
      const meetings = c.meetings.map((m, i) => ({ id: `m${i}`, profile: m.profile, deleted: m.deleted ? 1 : 0, state: 'live', title: m.title, starts_at: NOW + m.startsInHours * HOUR, others: null, links: null }) as unknown as Meeting);
      expect(guessProfile(c.question, meetings, c.fallback, NOW)).toBe(c.expected);
    });
  }

  for (const c of cases<{ name: string; tool: string; input: Record<string, unknown>; expected: { add: number; del: number } | null }>('edit-count')) {
    it(`editCount: ${c.name}`, () => expect(editCount(c.tool, c.input)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; rows: ExploreRow[]; runs: { start: number; end: number }[]; labels: string[] }>('explore-runs')) {
    it(`explore: ${c.name}`, () => {
      const runs = exploreRunsOf(c.rows);
      expect(runs).toEqual(c.runs);
      expect(runs.map((r) => exploreLabelOf(c.rows.slice(r.start, r.end).map((x) => x.name!)))).toEqual(c.labels);
    });
  }

  for (const c of cases<{ name: string; held: string[]; heldEarlier: number; tail: string[]; earlier: number; expected: string[]; expectedEarlier: number }>('merge-tail')) {
    it(`mergeTail: ${c.name}`, () => {
      const events = (ids: string[]) => ids.map((id) => ({ id, kind: 'user', text: '', at: 0 }) as ChatEvent);
      const m = mergeTail(events(c.held), c.heldEarlier, events(c.tail), c.earlier);
      expect(m.events.map((e) => e.id)).toEqual(c.expected);
      expect(m.earlier).toBe(c.expectedEarlier);
    });
  }

  for (const c of cases<{ name: string; text: string; expected: string }>('strip-round')) {
    it(`stripRound: ${c.name}`, () => expect(stripRound(c.text)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; ageMs: number; suffix: string; expected: string }>('ago')) {
    it(`ago: ${c.name}`, () => expect(ago(NOW - c.ageMs, c.suffix)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; items: TodoItem[]; progress: string; current: string }>('checklist')) {
    it(`todos: ${c.name}`, () => {
      expect(todoProgress(todoCount(c.items))).toBe(c.progress);
      expect(todoCurrent(c.items)).toBe(c.current);
    });
  }

  for (const c of cases<{ name: string; path: string; isSpec: boolean; md: string; tasks: SpecTask[]; progress: string; start: string | null; all: string }>('spec-tasks')) {
    it(`specTasks: ${c.name}`, () => {
      const tasks = specTasks(c.md);
      const open = tasks.find((t) => !t.done);
      expect(tasks).toEqual(c.tasks);
      expect(isSpecPath(c.path)).toBe(c.isSpec);
      expect(specProgress(tasks)).toBe(c.progress);
      expect(open && startTaskPrompt(open, c.path)).toBe(c.start ?? undefined);
      expect(runAllPrompt(c.path)).toBe(c.all);
    });
  }

  for (const c of cases<{ name: string; brief: string; expected: string }>('build-prompt')) {
    it(`buildPrompt: ${c.name}`, () => expect(buildPrompt(c.brief)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; md: string; expected: string }>('spec-open-tasks')) {
    it(`withoutOpenTasks: ${c.name}`, () => expect(withoutOpenTasks(c.md)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; path: string; slug: string }>('spec-slug')) {
    it(`specSlug: ${c.name}`, () => expect(specSlug(c.path)).toBe(c.slug));
  }

  for (const c of cases<{ name: string; html: string; theme: SketchTheme; doc: string }>('sketch-doc')) {
    it(`sketchDoc: ${c.name}`, () => {
      expect(sketchDoc(c.html, c.theme)).toBe(c.doc);
      expect(c.doc).toContain(`data-theme="${c.theme}"`);
      expect(c.doc.replace(/^<!doctype html>\s*/i, '').replace(/^<html[^>]*>(<head[^>]*>)?/i, '')).toMatch(/^<meta http-equiv="Content-Security-Policy"/);
    });
  }

  for (const c of cases<{ name: string; path: string; sketch: boolean }>('sketch-path')) {
    it(`isSketchPath: ${c.name}`, () => expect(isSketchPath(c.path)).toBe(c.sketch));
  }

  for (const c of cases<{ name: string; form?: GoalForm; now?: number; command?: string; what?: string; plan?: string | null; path?: string; md?: string; condition?: string; every?: string; ms?: number | null }>('goal-command')) {
    it(`goalForm: ${c.name}`, () => {
      if (c.every !== undefined) expect(parseEvery(c.every)).toBe(c.ms!);
      else if (c.form) expect(goalCommand(c.form, c.now!)).toBe(c.command);
      else if (c.condition) expect(planCondition(c.path!, c.md!)).toBe(c.condition);
      else expect(planOf(c.what!)).toBe(c.plan);
    });
  }

  type PresetCase = { name: string; op: string; raw?: unknown; rawText?: string; list?: GoalPreset[]; preset?: GoalPreset; target?: string; expected: GoalPreset[] };
  for (const c of cases<PresetCase>('goal-presets')) {
    it(`goalPresets: ${c.name}`, () => {
      if (c.op === 'parse') expect(parsePresets(c.rawText ?? JSON.stringify(c.raw))).toEqual(c.expected);
      else if (c.op === 'add') expect(addPreset(c.list!, c.preset!)).toEqual(c.expected);
      else expect(removePreset(c.list!, c.target!)).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; text: string; rule: string; expected: string | null }>('append-rule')) {
    it(`appendRule: ${c.name}`, () => expect(appendRule(c.text, c.rule)).toBe(c.expected));
  }

  const dismissed = cases<never>('dismissed') as unknown as { keys: { name: string; value: string | null; expected: string[] }[]; merge: { name: string; a: string | null; b: string | null; expected: string | null }[] };
  for (const c of dismissed.keys) it(`dismissedKeys: ${c.name}`, () => expect(dismissedKeys(c.value)).toEqual(c.expected));
  for (const c of dismissed.merge) it(`mergeDismissed: ${c.name}`, () => expect(mergeDismissed(c.a, c.b)).toBe(c.expected));

  for (const c of cases<{ name: string; id: string; people: string; links: string | null; expected: boolean }>('event-rule')) {
    it(`isEvent: ${c.name}`, () => expect(isEvent({ id: c.id, people: c.people, links: c.links } as Meeting)).toBe(c.expected));
  }

  type MeetingSpec = { id: string; profile?: Profile; title?: string; startsInHours?: number; endsInHours?: number; people?: string; transcript?: string; summary?: string; organizerMe?: number; state?: string; deleted?: boolean };
  type ItemSpec = { meeting: string; profile?: Profile; status: string; assignee?: string; deleted?: boolean };
  const meetingOf = (m: MeetingSpec) =>
    ({ id: m.id, profile: m.profile ?? 'work', deleted: m.deleted ? 1 : 0, state: m.state ?? 'live', title: m.title ?? null, starts_at: m.startsInHours == null ? null : NOW + m.startsInHours * HOUR, ends_at: m.endsInHours == null ? null : NOW + m.endsInHours * HOUR, people: m.people ?? null, transcript: m.transcript ?? null, summary: m.summary ?? null, organizer_me: m.organizerMe ?? null }) as unknown as Meeting;
  const itemOf = (r: ItemSpec, i: number) => ({ id: `i${i}`, profile: r.profile ?? 'work', deleted: r.deleted ? 1 : 0, meeting_id: r.meeting, status: r.status, assignee: r.assignee ?? null }) as unknown as ItemRow;
  const meetingCases = JSON.parse(readFileSync(new URL('../../shared/fixtures/meetings.json', import.meta.url), 'utf8')) as {
    state: { name: string; meeting: MeetingSpec; expected: string }[];
    groups: { name: string; meetings: MeetingSpec[]; expected: { today: boolean; ids: string[] }[] }[];
    seriesTitle: { name: string; title: string | null; expected: string }[];
    inSeries: { name: string; meetings: MeetingSpec[]; expected: string[] }[];
    names: { name: string; a: string; b: string; display: string; same: boolean }[];
    actionCount: { name: string; items: ItemSpec[]; expected: unknown }[];
    filter: { meetings: MeetingSpec[]; items: ItemSpec[]; cases: { name: string; chips: MeetingChip[]; expected: string[] }[] };
  };
  for (const c of meetingCases.state) it(`meetingState: ${c.name}`, () => expect(meetingState(meetingOf(c.meeting), NOW)).toBe(c.expected));
  for (const c of meetingCases.groups) {
    it(`groupMeetings: ${c.name}`, () => {
      const groups = groupMeetings(c.meetings.map(meetingOf), NOW);
      expect(groups.map((g) => ({ today: g.label === 'Today', ids: g.rows.map((m) => m.id) }))).toEqual(c.expected);
    });
  }
  for (const c of meetingCases.seriesTitle) it(`seriesTitle: ${c.name}`, () => expect(seriesTitle(c.title)).toBe(c.expected));
  for (const c of meetingCases.inSeries) {
    it(`inSeries: ${c.name}`, () => {
      const meetings = c.meetings.map(meetingOf);
      const keys = inSeries(meetings);
      expect(meetings.filter((m) => keys.has(m.profile + m.id)).map((m) => m.id)).toEqual(c.expected);
    });
  }
  for (const c of meetingCases.names) {
    it(`displayName and sameName: ${c.name}`, () => {
      expect(displayName(c.a)).toBe(c.display);
      expect(sameName(c.a, c.b)).toBe(c.same);
    });
  }
  for (const c of meetingCases.actionCount) it(`actionCount: ${c.name}`, () => expect(actionCount(c.items.map(itemOf), { profile: 'work', id: 'cal:a' })).toEqual(c.expected));
  for (const c of meetingCases.filter.cases) {
    it(`filterMeetings: ${c.name}`, () => {
      const meetings = meetingCases.filter.meetings.map(meetingOf);
      expect(filterMeetings(meetings, meetingCases.filter.items.map(itemOf), c.chips, NOW).map((m) => m.id)).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; request: string; expected: string }>('spec-prompt')) {
    it(`specPrompt: ${c.name}`, () => expect(specPrompt(c.request)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; kind: SetupKind; repo: string; mcpCommand: string; expected: string }>('setup-prompts')) {
    it(`setupPrompt: ${c.name}`, () => expect(setupPrompt(c.kind, c.repo, c.mcpCommand)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; sessionId: string; expected: string }>('handoff-text')) {
    it(`handoffText: ${c.name}`, () => expect(handoffText(c.sessionId)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; events: unknown[]; expected: TodoItem[] | null }>('checklist-events')) {
    it(`latestTodos: ${c.name}`, () => expect(latestTodos(c.events as ChatEvent[])).toEqual(c.expected));
  }

  const run = (over: Partial<ChatRun>): ChatRun => ({ id: 'r', kind: 'loop', sessionId: 's', chatId: 'c', title: '', what: '', startedAt: 1, endedAt: null, state: 'running', why: '', round: 0, max: 0, nextAt: null, costUsd: 0, rounds: [], needsYou: false, ...over });

  for (const c of cases<{ name: string; run: Partial<ChatRun>; working: boolean; expected: string }>('stopped-text')) {
    it(`stoppedText: ${c.name}`, () => expect(stoppedText(run(c.run), c.working)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; pipeline: SpecHomeItem['pipeline']; conclusion: string; updatedAt: number; meta: string; when: string }>('spec-row-parts')) {
    it(`specRowParts: ${c.name}`, () => expect(specRowParts(c, (t) => `${t}h ago`)).toEqual({ meta: c.meta, when: c.when }));
  }

  for (const c of cases<{ name: string; why: string; endedAt: number | null; expected: string | null }>('finished-line')) {
    it(`finishedLine: ${c.name}`, () => expect(finishedLine(c, (t) => `${t}h ago`)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; rounds: Round[]; expected: [number, number, number, number][] }>('merge-quiet')) {
    it(`mergeQuiet: ${c.name}`, () => expect(mergeQuiet(c.rounds).map((g) => [g.first.n, g.last.n, g.count, g.costUsd])).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; run: Omit<Partial<ChatRun>, 'tries'> & { tries?: Partial<Try>[] }; phase: string | null; expected: string }>('run-line')) {
    it(`runLine: ${c.name}`, () => expect(runLine(run({ ...c.run, tries: c.run.tries?.map((t) => ({ n: 0, chatId: '', sessionId: '', branch: '', ...t })) }), c.phase)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; open: string | null; repos: { cwd: string; last: number }[]; expected: string | null }>('advisor-root')) {
    it(`defaultAdvisorRoot: ${c.name}`, () => {
      expect(defaultAdvisorRoot(c.open, c.repos)).toBe(c.expected);
    });
  }

  for (const c of cases<{ name: string; root: string; runs: Partial<ChatRun>[]; expected: { id: string; line: string; builds?: string } | null }>('advisor-loop')) {
    it(`advisorLoop: ${c.name}`, () => {
      const found = advisorLoopOf(c.runs.map(run), c.root);
      expect(found ? { id: found.id, line: advisorLoopLine(found), builds: buildsLine(found) } : null).toEqual(c.expected && { builds: '', ...c.expected });
    });
  }

  for (const c of cases<{ name: string; statuses: string[]; expected: string }>('audit-count')) {
    it(`auditCountLine: ${c.name}`, () => {
      expect(auditCountLine(c.statuses.map((status) => ({ status })))).toBe(c.expected);
    });
  }

  type BoardCase = { name: string; backlog: BacklogItem[]; specs: SpecHomeItem[]; loopNeedsYou: boolean; expected: { defaultStage: string } & Record<string, unknown> };
  for (const c of cases<BoardCase>('advisor-board')) {
    it(`advisorBoard: ${c.name}`, () => {
      const { stages, defaultStage } = advisorBoard(c.backlog, c.specs, c.loopNeedsYou);
      const slim = Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v.map(({ slug, action, needsYou }) => ({ slug, action, needsYou }))]));
      expect({ ...slim, defaultStage }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; root: string; item: BacklogItem; expected: string }>('spec-item-prompt')) {
    it(`specItemPrompt: ${c.name}`, () => expect(specItemPrompt(c.root, c.item)).toBe(c.expected));
  }

  type StateCase = { name: string; chat: Partial<LiveChat> & { agents?: number; run?: { state: ChatRun['state']; why?: string; nextAtLocal?: string } }; expected: unknown };
  for (const c of cases<StateCase>('chat-state')) {
    it(`chatState: ${c.name}`, () => {
      const { agents = 0, run, ...chat } = c.chat;
      const agentList = Array.from({ length: agents }, (_, i) => ({ id: `a${i}`, description: '', type: '', startedAt: 0 }));
      expect(chatState({ pending: 0, running: false, status: '', ...chat, agentList, run: run && { state: run.state, why: run.why, nextAt: run.nextAtLocal ? new Date(run.nextAtLocal).getTime() : null } })).toEqual(c.expected);
    });
  }

  type CountsCase = { name: string; viewing: string; seen?: Record<string, number>; attention?: number; chats: (Partial<LiveChat> & { run?: Partial<NonNullable<LiveChat['run']>> })[]; mcp?: { name: string; status: string }[]; hidden?: Record<string, string>; needsYouRows?: number; replyRows?: number; expected: unknown };
  for (const c of cases<CountsCase>('counts')) {
    it(`appCounts: ${c.name}`, () => {
      const chats = c.chats.map((chat) => countChat({ pending: 0, running: false, status: '', lastActive: 0, cwd: '', title: '', sessionId: null, ...chat } as LiveChat, c.seen ?? {}));
      expect(appCounts({ chats, viewing: c.viewing, attention: c.attention ?? 0, mcp: c.mcp ?? [], hidden: c.hidden ?? {}, needsYouRows: c.needsYouRows ?? 0, replyRows: c.replyRows ?? 0 })).toEqual(c.expected);
    });
  }

  const menu = JSON.parse(readFileSync(new URL('../../shared/fixtures/chat-menu.json', import.meta.url), 'utf8'));
  for (const c of menu.review) it(`reviewLabel: ${c.name}`, () => expect(reviewLabel(c.running, c.hasChanges)).toBe(c.expected));
  for (const c of menu.usage) it(`usageMenuLabel: ${c.name}`, () => expect(usageMenuLabel(c.account, c.week, c.fiveHour)).toBe(c.expected));

  type TryCase = { name: string; run: { rounds: Partial<ChatRun['rounds'][number]>[] }; try: Partial<Try>; live: Partial<LiveChat>[]; expected: { n: number; branch: string; state: string; line: string; edits: { add: number; del: number } | null; cost: number; archived: boolean } };
  for (const c of cases<TryCase>('try-column')) {
    it(`tryColumn: ${c.name}`, () => {
      const col = tryColumn(run({ rounds: c.run.rounds.map((r) => ({ n: 0, at: 0, outcome: 'done', line: '', costUsd: 0, ...r })) }), { chatId: '', ...c.try } as Try, c.live as LiveChat[]);
      const state = col.state.status === 'waiting' ? col.state.label : col.state.status === 'skipped' ? col.state.reason : { running: 'Running', failed: 'Failed', done: 'Done' }[col.state.status as string];
      expect({ ...col, state, edits: col.edits ?? null }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; original: string; content: string; block: number; expected: string }>('revert-block')) {
    it(`revertBlock: ${c.name}`, () => expect(revertBlock(c.original, c.content, c.block)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; text: string; expected: { title: string; url: string | null; why: string }[] }>('brief-bullets')) {
    it(`needsYou: ${c.name}`, () => expect(needsYou(c.text)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; text: string; now: string; expected: { at: string | null; spans: [number, number][]; stripped: string } | null }>('parse-when')) {
    it(`parseWhen: ${c.name}`, () => {
      const w = parseWhen(c.text, new Date(c.now));
      expect(w && { at: w.at === null ? null : new Date(w.at).toISOString().replace('.000Z', 'Z'), spans: w.spans, stripped: stripWhen(c.text, w) }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; order: string[]; skipped: string[]; open: string[]; expected: string[] }>('review-queue')) {
    it(`reviewQueue: ${c.name}`, () => expect(reviewQueue(c.order, c.skipped, new Set(c.open))).toEqual(c.expected));
  }

  type Caps = { name: string; capabilities: Capabilities | null; can: Record<keyof Capabilities, boolean> };
  for (const c of cases<Caps>('capabilities')) {
    it(`capabilities: ${c.name}`, () => {
      const caps = c.capabilities ?? undefined;
      expect(Object.fromEntries(Object.keys(c.can).map((k) => [k, can(caps, k as keyof Capabilities)]))).toEqual(c.can);
    });
  }

  type Table = { name: string; provider: Provider | null; label: string; billing: Billing; mark: string | null; modes: string[] };
  for (const c of cases<Table>('providers')) {
    it(`provider table: ${c.name}`, () => {
      const p = c.provider ?? undefined;
      expect(providerLabel(p)).toBe(c.label);
      expect(billing(p)).toBe(c.billing);
      expect(providerMark(p) ?? null).toBe(c.mark);
      expect(providerModes(p).map((m) => m.value)).toEqual(c.modes);
    });
  }

  for (const c of cases<{ name: string; provider: Provider; mode: string; review: boolean; list: string[]; checked: string; label: string }>('menu-modes')) {
    it(`menuModes: ${c.name}`, () => {
      const m = menuModes(c.provider, c.mode, c.review);
      expect({ list: m.list.map((o) => o.value), checked: m.checked, label: m.label }).toEqual({ list: c.list, checked: c.checked, label: c.label });
    });
  }

  for (const c of cases<{ name: string; current: string | null; models: string[]; shown: string[] }>('newest-models')) {
    it(`newestModels: ${c.name}`, () => expect(newestModels(c.models.map((n) => ({ value: n, displayName: n })), c.current).map((m) => m.value)).toEqual(c.shown));
  }

  for (const c of cases<{ name: string; mode: string; review: boolean; picked: string; send: { mode: string | null; review: boolean | null } }>('mode-steps')) {
    it(`modeSteps: ${c.name}`, () => expect(modeSteps(c.mode, c.review, c.picked)).toEqual(c.send));
  }

  for (const c of cases<{ name: string; n: number; billing: Billing; expected: string }>('money')) {
    it(`money: ${c.name}`, () => expect(money(c.n, c.billing)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; events: BarEvent[]; hidden: boolean[] }>('bottom-bar')) {
    it(`barState: ${c.name}`, () => {
      let state = barIdle;
      expect(c.events.map((e) => barHidden((state = barState(state, e))))).toEqual(c.hidden);
    });
  }



  const featureUse = JSON.parse(readFileSync(new URL('../../shared/fixtures/feature-use.json', import.meta.url), 'utf8')) as {
    ids: string[];
    hideable: string[];
    shown: { id: string; hidden: string[]; expected: boolean }[];
    palette: { id: string; expected: string | null }[];
    rows: { name: string; today: string; window: 7 | 30; days: UseDays; never: string[]; used: [string, number, number, string][] }[];
  };
  it('hub tables match the fixture the phone checks its synced columns against', () =>
    expect(TABLES).toEqual(JSON.parse(readFileSync(new URL('../../shared/fixtures/tables.json', import.meta.url), 'utf8'))));
  it('feature catalogue ids', () => expect(FEATURES.map((f) => f.id)).toEqual(featureUse.ids));
  it('hideable ids', () => expect(FEATURES.filter((f) => f.hideable).map((f) => f.id)).toEqual(featureUse.hideable));
  for (const c of featureUse.shown) it(`shownFeature: ${c.id} with ${c.hidden.join(',') || 'nothing'} hidden`, () => expect(shownFeature(c.id, c.hidden)).toBe(c.expected));
  for (const c of featureUse.palette) it(`paletteFeature: ${c.id}`, () => expect(paletteFeature(c.id)).toBe(c.expected));
  for (const c of featureUse.rows) {
    it(`featureRows: ${c.name}`, () => {
      const r = featureRows(c.days, c.today, c.window);
      expect(r.never.map((f) => f.id)).toEqual(c.never);
      expect(r.used.map((u) => [u.id, u.n7, u.n30, u.last])).toEqual(c.used);
    });
  }
});
