process.env.TZ = 'UTC';

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { barHidden, barIdle, barState, type BarEvent } from '../../shared/bottomBar';
import { reviewLabel, usageMenuLabel } from '../../shared/chatMenu';
import { chatNotices, type ChatNotice } from '../../shared/notices';
import { advisorBoard, advisorLoopLine, advisorLoopOf, auditCountLine, defaultAdvisorRoot, specItemPrompt, type BacklogItem } from '../../shared/advisors';
import { specRowParts, type SpecHomeItem } from '../../shared/builds';
import { appCounts } from '../../shared/counts';
import { TABLES } from '../../shared/tables';
import { editCount, stripRound } from '../../shared/edits';
import { limitResume } from '../../shared/limitResume';
import { buildsLine, finishedLine, goalEnd, mergeQuiet, runDetail } from '../../shared/goalText';
import { exploreLabelOf, exploreRunsOf, type ExploreRow } from '../../shared/explore';
import { FEATURES, featureRows, paletteFeature, shownFeature, type UseDays } from '../../shared/featureUse';
import type { Capabilities, ChatEvent, ChatRun, LiveChat, Provider, Round, Try } from '../../shared/protocol';
import { billing, menuModes, modeSteps, newestModels, providerLabel, providerMark, providerModes, shortModel, startModeFor, type Billing } from '../../shared/providers';
import { buildFolders, chatPlace } from './sessions/folders';
import { setupPrompt, type SetupKind } from '../../shared/setupPrompt';
import { appendRule } from '../../shared/steering';
import { addPreset, parsePresets, removePreset, type GoalPreset } from '../../shared/goalPresets';
import { goalCommand, parseEvery, planOf, rerunForm, type GoalForm } from '../../shared/goalForm';
import { buildPrompt, isSpecPath, planCondition, runAllPrompt, specProgress, specPrompt, specSlug, specTasks, startTaskPrompt, withoutOpenTasks, type SpecTask } from '../../shared/specTasks';
import { isSketchPath, sketchDoc, type SketchTheme } from '../../shared/sketches';
import { taskChatPrompt } from '../../shared/taskChat';
import { latestTodos, todoCount, todoCurrent, todoProgress, type TodoItem } from '../../shared/todos';
import { mergeTail } from './app/runtime/pageEvents';
import { buildTranscript } from './chat/transcript/steps';
import { foldTurns, workTitle } from './chat/transcript/workFold';
import { countChat } from './app/shell/counts';
import { can } from './chat/capabilitiesLogic';
import { chatMarkdown, draftKey, failedLine, handoffText, joinMarks, lastReply, markChip, splitMarks, turnEnd, userParts } from './chat/composer/composerLogic';
import { headerState, runLine, stoppedText } from './sessions/runLogic';
import { tryColumn } from './sessions/triesLogic';
import { parseWhen, stripWhen } from './codex/data/tasks/when';
import { cadenceLine, cadenceOf } from './codex/data/tasks/recur';
import { needsYou } from './codex/summary/needsYou';
import { ignoredToday } from './codex/data/tasks/review';
import { HubError, hubRetry } from './codex/data/hubFetch';
import type { Brief } from './codex/data/wiki/wiki';
import { reviewQueue } from './codex/wiki/reviewQueue';
import { revertBlock } from './workspace/revertBlock';
import { ago, money } from './ui/util';
import { setSystemTime } from '../../testing';
import { guessProfile } from './codex/data/ask/ask';
import type { Profile } from './codex/data/sync';
import { pageClaims, restatedClaim, staleFacts, type Fact, type Job, type Meeting, type Page } from './codex/data/wiki/wiki';
import { hasLiveClaims, wikiMarkdown } from './codex/data/wiki/wikiMarkdown';
import { heldUntil, jobEdits, newJob, tasksOf } from './codex/jobs/schedule';
import { WEEKLY_DIGEST } from './codex/data/tasks/presets';
import { sourceLink } from './codex/tasks/taskSource';
import type { ItemRow } from './codex/data/sync';
import { agendaMarkdown, draftFor, followUpText, hasContent, toMarkdown } from './codex/data/meetings/meetingMarkdown';
import { actionCount, displayName, filterMeetings, groupMeetings, inSeries, isEvent, meetingState, sameName, seriesTitle, type MeetingChip } from './codex/data/meetings/meetings';
import { dismissedKeys, mergeDismissed } from '../../shared/dismissed';
import { isOld } from '../../shared/claimAge';
import { similarClaim } from '../../shared/claimMatch';
import { editedClaimText } from '../../shared/claimEdit';
import { claimActions } from '../../shared/claimActions';
import { actionMenu } from '../../shared/actionMenu';
import { isLate } from '../../shared/waiting';
import { goalAtRisk } from './codex/data/tasks/goals';
import { afterNextMeeting, nextFreeSlot, weekFreeMinutes, type Span } from './codex/data/tasks/plan';
import { heldOrder } from '../../shared/util';

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

  for (const c of cases<{ name: string; events: ChatEvent[]; billing: Billing; rows: string[]; titles: { text: string; failed: string; detail: string }[] }>('work-fold')) {
    it(`foldTurns: ${c.name}`, () => {
      const rows = foldTurns(buildTranscript(c.events), c.events);
      expect(rows.map((r) => (r.kind === 'fold' ? `work:${r.id}` : r.it.id))).toEqual(c.rows);
      // The phone always shows the narrow title.
      expect(rows.flatMap((r) => (r.kind === 'fold' ? [workTitle(r.work, false, c.billing, true)] : []))).toEqual(c.titles);
      if (c.steps) expect(rows.flatMap((r) => (r.kind === 'fold' ? [r.steps] : []))).toEqual(c.steps);
      if (c.now) expect(rows.flatMap((r) => (r.kind === 'fold' ? [r.now] : []))).toEqual(c.now);
      if (c.proposed) expect(rows.flatMap((r) => (r.kind === 'fold' ? [r.proposed] : []))).toEqual(c.proposed);
    });
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

  for (const c of cases<{ name: string; failures: number; status: number | null; expected: number | null }>('hub-retry')) {
    it(`hub retry: ${c.name}`, () => expect(hubRetry(c.failures, c.status === null ? new Error('rejected') : new HubError('failed', c.status))).toBe(c.expected));
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

  for (const c of cases<{ name: string; run: Parameters<typeof rerunForm>[0]; form: ReturnType<typeof rerunForm> }>('rerun-form')) {
    it(`rerunForm: ${c.name}`, () => expect(rerunForm(c.run)).toEqual(c.form));
  }

  type PresetCase ={ name: string; op: string; raw?: unknown; rawText?: string; list?: GoalPreset[]; preset?: GoalPreset; target?: string; expected: GoalPreset[] };
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

  for (const c of cases<{ name: string; state: string | null; at: number | null; used_at?: number | null; now: number; expected: boolean }>('claim-age')) {
    it(`isOld: ${c.name}`, () => expect(isOld(c, c.now)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; text: string; claims: { id: string; text: string }[]; expected: string | null }>('similar-claim')) {
    it(`similarClaim: ${c.name}`, () => expect(similarClaim(c.text, c.claims)?.id ?? null).toBe(c.expected));
  }

  type RememberCase = { name: string; text: string; profile: Profile; facts: { id: string; profile: Profile; text: string; page_id?: string; state?: string; superseded_by?: string }[]; expected: string | null };
  for (const c of cases<RememberCase>('remember')) {
    it(`restatedClaim: ${c.name}`, () => expect(restatedClaim(c.text, c.facts as unknown as Fact[], c.profile)?.id ?? null).toBe(c.expected));
  }

  type MarkdownCase = { name: string; title: string | null; now: number; claims: { heading: string | null; text: string; sources: string[]; state: string | null; at: number }[]; hasLive: boolean; markdown: string };
  for (const c of cases<MarkdownCase>('wiki-markdown')) {
    it(`wikiMarkdown: ${c.name}`, () => {
      const facts = c.claims.map((x, i) => ({ ...x, id: `f${i}`, profile: 'work', page_id: 'p', deleted: 0, sources: JSON.stringify(x.sources.map((label) => ({ kind: 'doc', label }))) }) as unknown as Fact);
      const groups = pageClaims(facts, 'p', c.now);
      expect(wikiMarkdown(c.title, groups)).toBe(c.markdown);
      expect(hasLiveClaims(groups)).toBe(c.hasLive);
    });
  }

  it('cadence', () => {
    const c = cases<never>('cadence') as unknown as { lines: { name: string; cadence: 'daily' | 'weekdays' | 'weekly' | 'monthly'; at: string | null; now: string; expected: string }[]; reads: { name: string; text: string | null; at: string | null; expected: string }[] };
    const time = (s: string | null) => (s === null ? null : new Date(s).getTime());
    for (const l of c.lines) expect(cadenceLine(l.cadence, time(l.at), time(l.now) as number), l.name).toBe(l.expected);
    for (const r of c.reads) expect(cadenceOf(r.text, time(r.at)), r.name).toBe(r.expected);
  });

  it('staleFacts', () => {
    type Row = Record<string, unknown>;
    const c = cases<never>('stale-claims') as unknown as { now: number; pages: Row[]; meetings: (Row & { startsAgoDays: number })[]; facts: Row[]; expected: string[] };
    const common = { profile: 'work', version: 0, updated_at: 0, deleted: 0, field_times: '{}', dirty: 0 };
    const pages = c.pages.map((p) => ({ ...common, ...p })) as unknown as Page[];
    const meetings = c.meetings.map(({ startsAgoDays, ...m }) => ({ ...common, ...m, starts_at: c.now - startsAgoDays * 86_400_000 })) as unknown as Meeting[];
    const facts = c.facts.map((f) => ({ ...common, ...f })) as unknown as Fact[];
    expect(staleFacts(facts, pages, meetings, c.now).map((f) => f.id)).toEqual(c.expected);
  });

  for (const c of cases<{ name: string; old: string | null; next: string; expected: string | null }>('claim-edit')) {
    it(`editedClaimText: ${c.name}`, () => expect(editedClaimText(c.old, c.next)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; state: string | null; contested: boolean; stale: boolean; buttons: string[]; menu: string[] }>('claim-actions')) {
    it(`claimActions: ${c.name}`, () => expect(claimActions(c.state, c.contested, { stale: c.stale })).toEqual({ buttons: c.buttons, menu: c.menu }));
  }

  for (const c of cases<{ status: string; notMine: boolean; assign: boolean; snooze: boolean }>('action-menu')) {
    const { status, ...menu } = c;
    it(`actionMenu: ${status}`, () => expect(actionMenu(status)).toEqual(menu));
  }

  for (const c of cases<{ name: string; since: number[]; now: number[]; expected: boolean }>('late-promise')) {
    const at = ([y, m, d, h]: number[]) => new Date(y, m - 1, d, h).getTime();
    it(`isLate: ${c.name}`, () => expect(isLate(at(c.since), at(c.now))).toBe(c.expected));
  }

  type RiskCase = { name: string; now: number[]; busy: number[][][]; tasks: { status: string; title?: string }[]; free: number; risk: boolean };
  for (const c of cases<RiskCase>('goal-risk')) {
    const at = ([y, m, d, h, mi]: number[]) => new Date(y, m - 1, d, h, mi).getTime();
    it(`goalAtRisk: ${c.name}`, () => {
      const goal = { id: 'g', profile: 'work', deleted: 0, status: 'goal' } as unknown as ItemRow;
      const items = c.tasks.map((t, i) => ({ id: `t${i}`, profile: 'work', deleted: 0, goal: 'g', title: t.title ?? 'x', status: t.status }) as unknown as ItemRow);
      const free = weekFreeMinutes(c.busy.map(([a, b]) => [at(a), at(b)] as Span), at(c.now));
      expect(free).toBe(c.free);
      expect(goalAtRisk(items, goal, free)).toBe(c.risk);
    });
  }

  type Clock = [number, number];
  for (const c of cases<{ name: string; now: Clock; busy: Clock[][]; afterNext: Clock | null; freeSlot: Clock | null }>('free-slot')) {
    const at = ([h, m]: Clock) => new Date(2026, 9, 30, h, m).getTime();
    const busy = c.busy.map(([a, b]) => [at(a), at(b)] as Span);
    it(`afterNextMeeting and nextFreeSlot: ${c.name}`, () => {
      expect(afterNextMeeting(busy, at(c.now))).toBe(c.afterNext && at(c.afterNext));
      expect(nextFreeSlot(busy, at(c.now))).toBe(c.freeSlot && at(c.freeSlot));
    });
  }

  type JobTaskSpec ={ id: string; status: string; madeAt: number; profile?: Profile; deleted?: boolean; source?: string; people?: string };
  for (const c of cases<{ name: string; job: { name: string; profile: Profile }; items: JobTaskSpec[]; expected: string[] }>('job-tasks')) {
    const items = c.items.map((i) => ({ id: i.id, profile: i.profile ?? c.job.profile, deleted: i.deleted ? 1 : 0, source: i.source ?? 'job', people: i.people ?? c.job.name, status: i.status, updated_at: i.madeAt, field_times: '{}' }) as unknown as ItemRow);
    it(`tasksOf: ${c.name}`, () => expect(tasksOf(items, c.job as Job).map((r) => r.id)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; job: { profile: Profile }; paused: { scan: string; until: number }[]; now: number; expected: number | null }>('job-held')) {
    it(`heldUntil: ${c.name}`, () => expect(heldUntil(c.job as Job, c.paused.map((p) => ({ ...p, reason: 'Claude usage limit' })), c.now)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; job: Pick<Job, 'name' | 'prompt'>; name_in: string; prompt_in: string; expected: object }>('job-edit')) {
    it(`jobEdits: ${c.name}`, () => expect(jobEdits(c.job, c.name_in, c.prompt_in)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; profile: Profile; preset: 'weekly-digest' | null; expected: object }>('new-job')) {
    it(`newJob: ${c.name}`, () => {
      const { name, schedule, prompt, enabled, profile } = newJob(c.profile, c.preset ? WEEKLY_DIGEST : undefined);
      expect({ name, schedule, prompt, enabled, profile }).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; id: string; source: string | null; meeting_id: string | null; expected: { icon: string; label: string } }>('task-source')) {
    it(`sourceLink: ${c.name}`, () => expect(sourceLink(c as unknown as ItemRow)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; held: string[] | null; keys: string[]; expected: string[] }>('held-order')) {
    it(`heldOrder: ${c.name}`, () => expect(heldOrder(c.held, c.keys)).toEqual(c.expected));
  }

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

  type CopyCase = { name: string; meeting: Record<string, unknown>; actions: { title: string; status: string }[]; hasContent: boolean; followUp: string; markdown: string };
  for (const c of cases<CopyCase>('meeting-copy')) {
    it(`meeting copy: ${c.name}`, () => {
      const m = { id: 'm', profile: 'work', ...c.meeting } as unknown as Meeting;
      const actions = c.actions as unknown as ItemRow[];
      expect(hasContent(m, actions)).toBe(c.hasContent);
      expect(followUpText(m, actions)).toBe(c.followUp);
      expect(toMarkdown(m, actions)).toBe(c.markdown);
    });
  }

  for (const c of cases<{ name: string; meeting: Record<string, unknown>; action: Record<string, unknown>; expected: string }>('action-draft')) {
    it(`draftFor: ${c.name}`, () => expect(draftFor(c.action as unknown as ItemRow, c.meeting as unknown as Meeting)).toBe(c.expected));
  }

  type AgendaCase = { name: string; meeting: Record<string, unknown>; points: { people: string | null; title: string }[]; actions: string[]; questions: string[]; markdown: string };
  for (const c of cases<AgendaCase>('agenda')) {
    it(`agendaMarkdown: ${c.name}`, () => {
      const m = { id: 'm', profile: 'work', ...c.meeting } as unknown as Meeting;
      expect(agendaMarkdown(m, { points: c.points as unknown as ItemRow[], actions: c.actions, questions: c.questions })).toBe(c.markdown);
    });
  }

  for (const c of cases<{ name: string; request: string; expected: string }>('spec-prompt')) {
    it(`specPrompt: ${c.name}`, () => expect(specPrompt(c.request)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; kind: SetupKind; repo: string; mcpCommand: string; expected: string }>('setup-prompts')) {
    it(`setupPrompt: ${c.name}`, () => expect(setupPrompt(c.kind, c.repo, c.mcpCommand)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; title: string; events: ChatEvent[]; markdown: string; lastReply: string | null }>('chat-markdown')) {
    it(`chatMarkdown: ${c.name}`, () => {
      expect(chatMarkdown(c.events, c.title)).toBe(c.markdown);
      expect(lastReply(c.events)).toBe(c.lastReply);
    });
  }

  for (const c of cases<{ name: string; events: ChatEvent[]; expected: { prompt: string; reset: number } | null }>('limit-resume')) {
    it(`limitResume: ${c.name}`, () => expect(limitResume(c.events)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; sessionId: string; expected: string }>('handoff-text')) {
    it(`handoffText: ${c.name}`, () => expect(handoffText(c.sessionId)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; text: string; body: string; marks: string[]; names: string[]; joined: string }>('attachments')) {
    it(`splitMarks: ${c.name}`, () => {
      const s = splitMarks(c.text);
      expect(s).toEqual({ body: c.body, marks: c.marks });
      expect(s.marks.map((m) => `${markChip(m).kind} ${markChip(m).name}`)).toEqual(c.names);
      expect(joinMarks(s.body, s.marks)).toBe(c.joined);
    });
  }

  for (const c of cases<{ name: string; text: string; parts: unknown[] }>('user-parts')) {
    it(`userParts: ${c.name}`, () => expect(userParts(c.text)).toEqual(c.parts));
  }

  for (const c of cases<{ name: string; chat: string; sessionId: string | null; expected: string }>('draft-key')) {
    it(`draftKey: ${c.name}`, () => expect(draftKey(c.chat, c.sessionId)).toBe(c.expected));
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

  for (const c of cases<{ name: string; kind: ChatRun['kind']; state: ChatRun['state']; expected: ReturnType<typeof runDetail> }>('run-detail')) {
    it(`runDetail: ${c.name}`, () => expect(runDetail(c)).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; why: string; expected: string }>('goal-end')) {
    it(`goalEnd: ${c.name}`, () => expect(goalEnd(c.why)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; rounds: Round[]; expected: [number, number, number, number][] }>('merge-quiet')) {
    it(`mergeQuiet: ${c.name}`, () => expect(mergeQuiet(c.rounds).map((g) => [g.first.n, g.last.n, g.count, g.costUsd])).toEqual(c.expected));
  }

  for (const c of cases<{ name: string; run: Omit<Partial<ChatRun>, 'tries'> & { tries?: Partial<Try>[] }; expected: string }>('run-line')) {
    it(`runLine: ${c.name}`, () => expect(runLine(run({ ...c.run, tries: c.run.tries?.map((t) => ({ n: 0, chatId: '', sessionId: '', branch: '', ...t })) }))).toBe(c.expected));
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

  for (const c of cases<{ name: string; task: Parameters<typeof taskChatPrompt>[0]; expected: string }>('task-chat-prompt')) {
    it(`taskChatPrompt: ${c.name}`, () => expect(taskChatPrompt(c.task)).toBe(c.expected));
  }

  type StateCase = { name: string; chat: Partial<LiveChat> & { agents?: number; run?: { state: ChatRun['state']; why?: string; nextAtLocal?: string } }; expected: unknown };
  for (const c of cases<StateCase>('chat-state')) {
    it(`chatState: ${c.name}`, () => {
      const { agents = 0, run, ...chat } = c.chat;
      const agentList = Array.from({ length: agents }, (_, i) => ({ id: `a${i}`, description: '', type: '', startedAt: 0 }));
      expect(headerState({ pending: 0, running: false, status: '', ...chat, agentList, run: run && { state: run.state, why: run.why, nextAt: run.nextAtLocal ? new Date(run.nextAtLocal).getTime() : null } })).toEqual(c.expected);
    });
  }

  type CountsCase = { name: string; viewing: string; seen?: Record<string, number>; attention?: number; chats: (Partial<LiveChat> & { run?: Partial<NonNullable<LiveChat['run']>> })[]; mcp?: { name: string; status: string }[]; hidden?: Record<string, string>; needsYouRows?: number; replyRows?: number; expected: unknown };
  for (const c of cases<CountsCase>('counts')) {
    it(`appCounts: ${c.name}`, () => {
      const chats = c.chats.map((chat) => countChat({ pending: 0, running: false, status: '', lastActive: 0, cwd: '', title: '', sessionId: null, ...chat } as LiveChat, c.seen ?? {}));
      expect(appCounts({ chats, viewing: c.viewing, attention: c.attention ?? 0, mcp: c.mcp ?? [], hidden: c.hidden ?? {}, needsYouRows: c.needsYouRows ?? 0, replyRows: c.replyRows ?? 0 })).toEqual(c.expected);
    });
  }

  for (const c of cases<{ name: string; label: string; events: ChatEvent[]; turnEnd: string; failedLine: string | null }>('turn-end')) {
    it(`turnEnd: ${c.name}`, () => {
      expect(turnEnd(c.events, c.label)).toBe(c.turnEnd);
      expect(failedLine(c.events, c.label)).toBe(c.failedLine);
    });
  }

  const menu = JSON.parse(readFileSync(new URL('../../shared/fixtures/chat-menu.json', import.meta.url), 'utf8'));
  for (const c of menu.review) it(`reviewLabel: ${c.name}`, () => expect(reviewLabel(c.running, c.hasChanges)).toBe(c.expected));
  for (const c of menu.usage) it(`usageMenuLabel: ${c.name}`, () => expect(usageMenuLabel(c.account, c.week, c.fiveHour)).toBe(c.expected));

  type NoticeCase = { name: string; before: Partial<LiveChat>; now: Partial<LiveChat>; muted: boolean; expected: unknown };
  const liveChat = (c: Partial<LiveChat>) => ({ id: 'a', title: 'Fix tests', cwd: '/Users/me/agentview/', running: false, pending: 0, status: '', lastActive: 0, ...c }) as LiveChat;
  for (const c of cases<NoticeCase>('chat-notices')) {
    it(`chatNotices: ${c.name}`, () => expect(chatNotices(liveChat(c.before), liveChat(c.now), c.muted)).toEqual(c.expected as ChatNotice | null));
  }

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

  type IgnoredCase = { name: string; profile: string; now: number; briefs: Pick<Brief, 'profile' | 'id' | 'kind' | 'rows' | 'deleted'>[]; expected: { url: string; from: string; gist: string }[] };
  for (const c of cases<IgnoredCase>('ignored-today')) {
    it(`ignoredToday: ${c.name}`, () => expect(ignoredToday(c.briefs as Brief[], c.profile, c.now).map(({ url, from, gist }) => ({ url, from, gist }))).toEqual(c.expected));
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
  for (const c of cases<{ name: string; mode: string | null; provider: Provider | null; expected: string | null }>('start-mode')) {
    it(`startModeFor: ${c.name}`, () => expect(startModeFor(c.mode, c.provider ?? undefined)).toBe(c.expected));
  }

  const place = JSON.parse(readFileSync(new URL('../../shared/fixtures/chat-place.json', import.meta.url), 'utf8'));
  const placeFolders = buildFolders(place.repos, place.trees, []);
  for (const c of place.cases as { name: string; cwd: string; expected: string }[]) {
    it(`chatPlace: ${c.name}`, () => expect(chatPlace(placeFolders, c.cwd)).toBe(c.expected));
  }

  for (const c of cases<{ name: string; model: string; expected: string }>('short-model')) {
    it(`shortModel: ${c.name}`, () => expect(shortModel(c.model)).toBe(c.expected));
  }

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
