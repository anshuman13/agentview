import { useState } from 'react';
import { useAssistantStore, useAssistantData } from '../data';
import { errorText } from '../data/engine';
import { Markdown } from '../../chat/Chat';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { EmptyState, Panel } from '../../ui/Panel';
import { ago, safeHref } from '../../ui/util';
import { clock } from '../time';
import { dayLabel } from '../data/dates';
import { copyText, openTask, setView, showSnack, useView } from '../view';
import { buildReport, type DateRange, type StatusFilter } from './report';
import '../../styles/features/wiki.css';

const CHATS = 8;
const BRIEF_LINES = 8;

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
  const [allChats, setAllChats] = useState(false);
  const [allBrief, setAllBrief] = useState(false);
  const [range, setRange] = useState<DateRange>('week');
  const [status, setStatus] = useState<StatusFilter>('all');
  const since = range === 'today' ? new Date().setHours(0, 0, 0, 0) : Date.now() - 7 * 86400000;
  const report = buildReport(snap.items.filter((r) => filter === 'all' || r.profile === filter), range, status);
  const chats = snap.chats.filter((c) => !c.deleted && (filter === 'all' || c.profile === filter) && c.summary?.trim() && (c.last_at ?? 0) >= since).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
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
              <h2>{report.title}</h2>
              {report.groups.map((g) => (
                <section key={g.name}>
                  <h3>{g.name}</h3>
                  <ul>{g.lines.map((l) => <li key={l.row.profile + l.row.id}><button className="sm-line" onClick={() => openTask(l.row)}>[{dayLabel(l.at)}] {l.text}</button></li>)}</ul>
                </section>
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
              {longBrief && <button className="as-chip quiet ov-more" onClick={() => setAllBrief(!allBrief)}>{allBrief ? 'Show less' : 'Show all'}</button>}
            </section>
          )}
          {chats.length > 0 && (
            <div className="mt-rows">
              <div className="as-section"><span className="as-section-name">Chats</span><span>{chats.length}</span></div>
              {(allChats ? chats : chats.slice(0, CHATS)).map((c) => (
                <a key={c.profile + c.id} className="mt-row sm-chat" href={safeHref(c.url)} target="_blank" rel="noreferrer">
                  <span className="mt-body">
                    <span className="mt-title">{c.name}</span>
                    <span className="sm-text">{c.summary}</span>
                    <span className="wk-meta"><span>{c.kind === 'dm' ? 'DM' : c.kind === 'mention' ? 'Mention' : 'Channel'}</span>{c.last_at ? <span>{ago(c.last_at, ' ago')}</span> : null}</span>
                  </span>
                </a>
              ))}
              {chats.length > CHATS && <button className="as-chip quiet ov-more" onClick={() => setAllChats(!allChats)}>{allChats ? 'Show less' : `Show ${chats.length - CHATS} more`}</button>}
            </div>
          )}
          {!chats.length && !brief?.text && <div className="as-empty"><Icon name="comment-discussion" /><div>Nothing read yet.</div><div className="muted small">Slack is read every 15 minutes on weekdays from 07 to 19.</div></div>}
        </div>
      </div>
    </div>
  );
}

// Top-level bullets under the brief's "Needs you" heading: the linked or bold title and the first sentence after it.
export function needsYou(text: string) {
  const out: { title: string; url: string | null; why: string }[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (!bullet) {
      if (/^\s/.test(line)) continue;
      if (/needs you/i.test(line)) inside = true;
      else if (/^#{1,6}\s|^\*\*[^*]+\*\*:?\s*$/.test(line)) inside = false;
      continue;
    }
    if (!inside) continue;
    const m = bullet[1].match(/^(?:\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*)\s*:?\s*(.*)$/);
    const title = m ? (m[1] ?? m[3]) : bullet[1].split(':')[0];
    const rest = m ? m[4] : bullet[1].slice(title.length + 1);
    const url = safeHref(m?.[2]) ?? null;
    out.push({ title: title.trim(), url, why: rest.trim().split(/(?<=[.!?])\s/)[0] });
  }
  return out;
}
