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
