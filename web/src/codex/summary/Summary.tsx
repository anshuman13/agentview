import { useState } from 'react';
import { useAssistantStore, useAssistantData } from '../data';
import { errorText } from '../data/engine';
import { Markdown } from '../../chat/Chat';
import { Icon } from '../../ui/Icon';
import { Button, Chip } from '../../ui/Button';
import { EmptyState, Panel } from '../../ui/Panel';
import { AskRow } from '../../ui/AskRow';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { ago, safeHref } from '../../ui/util';
import { clock } from '../time';
import { dayLabel } from '../data/dates';
import { copyText, openTask, setView, showSnack, useView } from '../view';
import { buildReport, type DateRange, type StatusFilter } from './report';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';

const FIRST = 5;
const BRIEF_LINES = 8;
const KINDS = [['dm', 'DMs'], ['mention', 'Mentions'], ['channel', 'Channels']] as const;
type Kind = (typeof KINDS)[number][0];
const kindOf = (kind: string | null): Kind => (kind === 'dm' || kind === 'mention' ? kind : 'channel');

// The first lines of a markdown text, cut at a blank line when there is one and with an open code fence closed.
const head = (lines: string[]) => {
  const blank = lines.slice(0, BRIEF_LINES + 1).map((l) => !l.trim()).lastIndexOf(true);
  const cut = lines.slice(0, blank > 0 ? blank : BRIEF_LINES);
  return [...cut, ...(cut.filter((l) => l.trimStart().startsWith('```')).length % 2 ? ['```'] : [])].join('\n');
};

// Slack in one place: the running summary of each chat from the quarter-hourly Haiku read, and a Sonnet summary on demand.
// The latest Slack brief, the Slack asks waiting for review, and a Sonnet summary on demand.
function useSlack() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const { filter } = useView();
  const [busy, setBusy] = useState(false);
  const brief = snap.briefs.filter((b) => !b.deleted && b.kind === 'slack').sort((a, b) => (b.to_at ?? 0) - (a.to_at ?? 0))[0];
  const asks = snap.items.filter((r) => !r.deleted && (filter === 'all' || r.profile === filter) && r.source === 'slack' && r.status === 'suggested').length;
  const summarize = () => {
    setBusy(true);
    store.summarizeSlack().then(
      (n) => showSnack(n ? `Summary ready, ${n} suggested ${n === 1 ? 'task' : 'tasks'}` : 'Summary ready'),
      (err) => showSnack(`Summary failed: ${errorText(err)}`),
    ).finally(() => setBusy(false));
  };
  return { brief, asks, busy, summarize };
}

export function Summary({ onMenu }: { onMenu: () => void }) {
  const snap = useAssistantData();
  const { brief, asks, busy, summarize } = useSlack();
  const { filter } = useView();
  const [openKinds, setOpenKinds] = useState<Kind[]>([]);
  const [allBrief, setAllBrief] = useState(false);
  const [range, setRange] = useState<DateRange>('week');
  const [status, setStatus] = useState<StatusFilter>('all');
  const since = range === 'today' ? new Date().setHours(0, 0, 0, 0) : Date.now() - 7 * 86400000;
  const report = buildReport(snap.items.filter((r) => filter === 'all' || r.profile === filter), range, status);
  const chats = snap.chats.filter((c) => !c.deleted && (filter === 'all' || c.profile === filter) && c.summary?.trim() && (c.last_at ?? 0) >= since).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
  const groups = KINDS.map(([kind, label]) => ({ kind, label, chats: chats.filter((c) => kindOf(c.kind) === kind) })).filter((g) => g.chats.length);
  const briefLines = brief?.text?.split('\n') ?? [];
  const longBrief = briefLines.length > BRIEF_LINES;
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <button className="icon-btn as-menu" title="Lists" aria-label="Lists" onClick={onMenu}><Icon name="menu" /></button>
        <h1>Summary</h1>
        <span className="spacer" />
        <button className="btn primary mt-take" disabled={busy} onClick={summarize}><Icon name={busy ? 'loading' : 'sparkle'} small /> <span>{busy ? 'Summarizing' : 'Summarize'}</span></button>
      </header>
      <div className="wk-scroll">
        <div className="mt-list">
          <div className="sm-report">
            <div className="sm-body">
              <Section label={report.title} />
              {report.groups.map((g) => (
                <div key={g.name} className="sm-group">
                  <Section label={g.name} count={g.lines.length} />
                  <div className="as-group">
                    {g.lines.map((l) => <Row key={l.row.profile + l.row.id} title={l.text} meta={dayLabel(l.at)} onClick={() => openTask(l.row)} />)}
                  </div>
                </div>
              ))}
              {!report.groups.length && <EmptyState size="sm" icon="checklist" title="No tasks in this range" hint="Pick another date or status." />}
              <Button size="sm" icon="copy" onClick={() => copyText(report.markdown)}>Copy</Button>
            </div>
            <Panel padding="sm" className="sm-filter">
              <label><span>Date</span>
                <select value={range} onChange={(e) => setRange(e.target.value as DateRange)}>
                  <option value="today">Today</option><option value="week">This week</option><option value="last">Last week</option><option value="month">This month</option>
                </select>
              </label>
              <label><span>Status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="all">All</option><option value="done">Completed</option><option value="open">Not completed</option>
                </select>
              </label>
            </Panel>
          </div>
          {asks > 0 && <button className="as-section review as-toggle" onClick={() => setView({ list: 'tasks' })}>{asks} from Slack to review <Icon name="arrow-right" small /></button>}
          {brief?.text && (
            <section className="sm-brief">
              <div className="wk-meta"><span>Sonnet summary</span><span>{dayLabel(brief.from_at ?? 0, true)} {clock(brief.from_at ?? 0)} to {clock(brief.to_at ?? 0)}</span></div>
              <Markdown text={allBrief || !longBrief ? brief.text : head(briefLines)} />
              {longBrief && <Chip quiet className="ov-more" onClick={() => setAllBrief(!allBrief)}>{allBrief ? 'Show less' : 'Show all'}</Chip>}
            </section>
          )}
          {groups.map((g) => (
            <div key={g.kind}>
              <Section label={g.label} count={g.chats.length} />
              <div className="as-group">
                {(openKinds.includes(g.kind) ? g.chats : g.chats.slice(0, FIRST)).map((c) => {
                  const summary = c.summary ?? '';
                  const row = { title: <span title={summary}>{c.name || 'Untitled'}</span>, meta: `${c.last_at ? `${ago(c.last_at)} ago · ` : ''}${summary.split('\n')[0]}` };
                  const url = safeHref(c.url);
                  return url ? <Row key={c.profile + c.id} {...row} href={url} /> : <Row key={c.profile + c.id} {...row} plain />;
                })}
                {g.chats.length > FIRST && !openKinds.includes(g.kind) && <AskRow title={`Show all ${g.chats.length}`} onClick={() => setOpenKinds([...openKinds, g.kind])} />}
              </div>
            </div>
          ))}
          {!chats.length && !brief?.text && <EmptyState size="md" icon="comment-discussion" title="Nothing read yet." hint="Slack is read every 15 minutes on weekdays from 07 to 19." />}
        </div>
      </div>
    </div>
  );
}
