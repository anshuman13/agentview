import { useState } from 'react';
import { useAssistantStore, useAssistantData } from '../data';
import { errorText } from '../data/engine';
import { Markdown } from '../../chat/Chat';
import { Icon } from '../../ui/Icon';
import { ago } from '../../ui/util';
import { clock } from '../time';
import { setView, showSnack } from '../view';
import '../../styles/features/wiki.css';

const day = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

// Slack in one place: the running summary of each chat from the quarter-hourly Haiku read, and a Sonnet summary on demand.
export function Summary({ onMenu }: { onMenu: () => void }) {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const [busy, setBusy] = useState(false);
  const chats = snap.chats.filter((c) => !c.deleted).sort((a, b) => (b.last_at ?? 0) - (a.last_at ?? 0));
  const brief = snap.briefs.filter((b) => !b.deleted && b.kind === 'slack').sort((a, b) => (b.to_at ?? 0) - (a.to_at ?? 0))[0];
  const asks = snap.items.filter((r) => !r.deleted && r.source === 'slack' && r.status === 'suggested').length;
  const summarize = () => {
    setBusy(true);
    store.summarizeSlack().then(
      (n) => showSnack(n ? `Summary ready, ${n} suggested ${n === 1 ? 'task' : 'tasks'}` : 'Summary ready'),
      (err) => showSnack(`Summary failed: ${errorText(err)}`),
    ).finally(() => setBusy(false));
  };
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
          {asks > 0 && <button className="as-section review as-toggle" onClick={() => setView({ list: 'tasks' })}>{asks} from Slack to review <Icon name="arrow-right" small /></button>}
          {brief?.text && (
            <section className="sm-brief">
              <div className="wk-meta"><span>Sonnet summary</span><span>{day(brief.from_at ?? 0)} {clock(brief.from_at ?? 0)} to {clock(brief.to_at ?? 0)}</span></div>
              <Markdown text={brief.text} />
            </section>
          )}
          {chats.length > 0 && (
            <div className="mt-rows">
              {chats.map((c) => (
                <a key={c.profile + c.id} className="mt-row sm-chat" href={c.url ?? undefined} target="_blank" rel="noreferrer">
                  <span className="mt-body">
                    <span className="mt-title">{c.name}</span>
                    <span className="sm-text">{c.summary}</span>
                    <span className="wk-meta"><span>{c.kind === 'dm' ? 'DM' : c.kind === 'mention' ? 'Mention' : 'Channel'}</span>{c.last_at ? <span>{ago(c.last_at, ' ago')}</span> : null}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
          {!chats.length && <div className="as-empty"><Icon name="comment-discussion" /><div>Nothing read yet.</div><div className="muted small">Slack is read every 15 minutes on weekdays from 07 to 19.</div></div>}
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
      inside = /needs you/i.test(line);
      continue;
    }
    if (!inside) continue;
    const m = bullet[1].match(/^(?:\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*)\s*:?\s*(.*)$/);
    const title = m ? (m[1] ?? m[3]) : bullet[1].split(':')[0];
    const rest = m ? m[4] : bullet[1].slice(title.length + 1);
    out.push({ title: title.trim(), url: m?.[2] ?? null, why: rest.trim().split(/(?<=[.!?])\s/)[0] });
  }
  return out;
}

// The latest Slack brief on Overview: only what needs me, one line each, and the asks waiting in Tasks.
export function SlackCard() {
  const store = useAssistantStore();
  const snap = useAssistantData();
  const [busy, setBusy] = useState(false);
  const brief = snap.briefs.filter((b) => !b.deleted && b.kind === 'slack').sort((a, b) => (b.to_at ?? 0) - (a.to_at ?? 0))[0];
  const asks = snap.items.filter((r) => !r.deleted && r.source === 'slack' && r.status === 'suggested').length;
  const items = brief?.text ? needsYou(brief.text) : [];
  if (!brief && !asks) return null;
  const summarize = () => {
    setBusy(true);
    store.summarizeSlack().then(
      (n) => showSnack(n ? `Summary ready, ${n} suggested ${n === 1 ? 'task' : 'tasks'}` : 'Summary ready'),
      (err) => showSnack(`Summary failed: ${errorText(err)}`),
    ).finally(() => setBusy(false));
  };
  return (
    <section>
      <div className="as-section">Slack{brief?.to_at ? ` · ${ago(brief.to_at, ' ago')}` : ''}</div>
      <div className="ov-follow">
        {items.slice(0, 5).map((x, i) => (
          <div key={i} className="ov-follow-row">
            <a className="ov-follow-text" href={x.url ?? undefined} target="_blank" rel="noreferrer">
              <span className="ov-t">{x.title}</span>
              {x.why && <span className="muted small">{x.why}</span>}
            </a>
          </div>
        ))}
        {brief && !items.length && <div className="ov-follow-row muted small">Nothing needs you.</div>}
        <div className="ov-follow-row">
          {asks > 0 ? <button className="ov-follow-text" onClick={() => setView({ list: 'tasks' })}><span className="ov-t">{asks} from Slack to review</span></button> : <span className="ov-follow-text" />}
          <button className="btn sm" disabled={busy} onClick={summarize}><Icon name={busy ? 'loading' : 'sparkle'} small /> {busy ? 'Summarizing' : 'Summarize'}</button>
        </div>
      </div>
    </section>
  );
}
