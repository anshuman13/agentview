import { useEffect, useRef, useState } from 'react';
import type { ReplyHistory } from '../data/store';
import { clearHistory, loadHistory } from '../replyHistory';
import { useAssistantStore } from '../data';
import { reviewedSince } from '../data/engine';
import { isSaid, type ItemRow } from '../data/sync';
import { tagList } from '../AddSheet';
import { SectionHead } from '../Fold';
import { Button, IconButton } from '../../ui/Button';
import { Menu, MenuItem } from '../../ui/Menu';
import { haptic } from '../../ui/haptic';
import { ago } from '../../ui/util';
import { ymd } from '../data/dates';
import { copyText, openTask, showSnack } from '../view';
import { useActions } from '../useActions';

const mine = (r: ItemRow) => tagList(r.tags).includes('needs-you');
// The scan tags an answer that rests on a live wiki claim with high confidence as faq: safe to send without reading.
export const isFaq = (r: ItemRow) => tagList(r.tags).includes('faq');

const drafted = (r: ItemRow) => !!r.draft?.trim();
// Invites, seats and limit bumps: I grant these in an admin console, so the queue offers them as one list.
const admin = (r: ItemRow) => tagList(r.tags).some((t) => t === 'access' || t === 'limit');
export const adminList = (rows: ItemRow[]) => rows.filter(admin).map((r) => `- ${r.people || 'Slack'}: ${r.title}${r.source_url ? ` ${r.source_url}` : ''}`).join('\n');

// Slack asks with a reply draft, the ones that need me first, then FAQ answers, then oldest first, so a day's asks clear from one screen.
// Needs-you asks the drafter left without a draft come last: I decide those in the thread.
export const replyQueue = (review: ItemRow[]) => review
  .filter((r) => r.source === 'slack' && (r.status === 'suggested' || r.status === 'open') && !r.deleted && (drafted(r) || mine(r)) && !isSaid(r))
  .sort((a, b) => Number(drafted(b)) - Number(drafted(a)) || Number(mine(b)) - Number(mine(a)) || Number(isFaq(b)) - Number(isFaq(a)) || reviewedSince(a) - reviewedSince(b));

// The last replies sent to a person, so a draft stays consistent with what I already said.
function HistoryLines({ data, error, who, retry }: { data: ReplyHistory | null; error: string; who: string; retry: () => void }) {
  const items = data?.replies;
  return (
    <div className="ov-ask-history">
      {error ? (
        <span className="muted small">{error} <Button size="sm" onClick={retry}>Retry</Button></span>
      ) : !items ? (
        <span className="muted small">Loading</span>
      ) : !items.length ? (
        <span className="muted small">No replies sent to {who} yet</span>
      ) : items.map((r, i) => <span key={i} className="muted small">{ymd(r.at)} · {r.line}</span>)}
    </div>
  );
}

function Ask({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const act = useActions();
  const has = drafted(row);
  const needs = mine(row);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.draft ?? '');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [data, setData] = useState<ReplyHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!editing) setText(row.draft ?? ''); }, [row.draft, editing]);
  const keep = () => { setEditing(false); if (text.trim() !== (row.draft ?? '')) { act.edit(row, { draft: text.trim() || null }); setEdited(true); } };
  const loadLines = () => {
    setHistoryError('');
    loadHistory(store, row.people!).then(setData, (err: Error) => setHistoryError(err.message));
  };
  const toggleHistory = () => {
    if (!history && !data) loadLines();
    setHistory(!history);
  };
  const choose = (fn: () => void) => () => { setMenu(false); fn(); };
  // The text goes with the request, so an edit made a moment ago is what gets posted even before it has synced.
  const send = async () => {
    const changed = editing ? text.trim() !== (row.draft ?? '') : edited;
    if (editing) keep();
    setBusy(true);
    setError('');
    try {
      const r = await store.sendReply(row.id, changed, text.trim());
      if (r.status === 'sent' || r.status === 'dry') {
        clearHistory(row.people);
        if (history) loadLines();
      }
      haptic('success');
      showSnack(r.status === 'answered' ? 'Not sent: someone already answered in the thread' : r.status === 'changed' ? 'Not sent: the thread changed since the draft' : 'Reply sent');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Skip closes the ask on the hub with no reply, so it leaves the queue and the corrections run sees the dropped draft.
  const skip = async () => {
    setBusy(true);
    try {
      await store.skipAsk(row.id);
      haptic('tap');
      showSnack('Skipped, no reply sent');
    } catch (err) {
      showSnack((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ov-ask">
      <div className="ov-ask-line">
        <button type="button" className="ui-row" onClick={() => openTask(row)}>
          <span className="ui-row-body">
            <span className="ui-row-title">{row.title}</span>
            <span className="ui-row-meta">{row.people || 'Slack'} · {ago(reviewedSince(row))}</span>
          </span>
          {(needs || isFaq(row)) && <span className="ui-row-trail"><span className={`badge ${needs ? 'waiting' : 'quiet'}`}>{needs ? 'Needs you' : 'FAQ'}</span></span>}
        </button>
        <span className="ov-ask-actions">
          {has
            ? <Button size="sm" icon={busy ? 'loading' : error ? 'refresh' : 'send'} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => void send()}>{error ? 'Retry' : needs ? 'Send note' : 'Send'}</Button>
            : row.source_url && <Button size="sm" icon="link" onClick={() => window.open(row.source_url!, '_blank', 'noreferrer')}>Open</Button>}
          <span className="ov-more">
            <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            {menu && (
              <Menu trigger={more} onClose={() => setMenu(false)}>
                {has && <MenuItem icon="edit" onClick={choose(() => setEditing(true))}>Edit</MenuItem>}
                {has && row.people && <MenuItem icon="history" onClick={choose(toggleHistory)}>History</MenuItem>}
                {has && row.source_url && <MenuItem icon="link" href={row.source_url} onClick={() => setMenu(false)}>Open thread</MenuItem>}
                <MenuItem icon="close" disabled={busy} onClick={choose(() => void skip())}>Skip</MenuItem>
              </Menu>
            )}
          </span>
        </span>
      </div>
      <div className="ov-ask-under">
        {!has ? <span className="ov-ask-draft">no draft, open the thread</span>
          : editing
            ? <textarea className="ov-ask-edit" autoFocus rows={3} value={text} aria-label="Reply draft" onChange={(e) => setText(e.target.value)} onBlur={keep} />
            : <span className="ov-ask-draft clamp">{row.draft}</span>}
        {history && row.people && <HistoryLines data={data} error={historyError} who={row.people} retry={loadLines} />}
        {error && <span className="ov-ask-err">Not sent: {error}</span>}
      </div>
    </div>
  );
}

export function ReplyQueue({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const faq = rows.filter(isFaq);
  const admins = rows.filter(admin).length;
  if (!rows.length) return null;
  // Posts every FAQ answer as it reads, one after the other, and reports how many went out.
  const sendAll = async () => {
    setSending(true);
    let sent = 0;
    for (const r of faq) {
      try {
        const res = await store.sendReply(r.id, false, (r.draft ?? '').trim());
        if (res.status === 'sent' || res.status === 'dry') {
          sent++;
          clearHistory(r.people);
        }
      } catch {
        break;
      }
    }
    setSending(false);
    if (sent) haptic('success');
    showSnack(sent === faq.length ? `Sent ${sent} FAQ answers` : `Sent ${sent} of ${faq.length} FAQ answers`);
  };
  const sendText = `Send all ${faq.length} FAQ answers`;
  const copyLabel = `Copy ${admins} access and limit requests`;
  const copyList = () => copyText(adminList(rows), `Copied ${admins} requests`);
  const both = faq.length >= 2 && admins >= 2;
  const batch = both ? (
    <span className="ov-more">
      <IconButton ref={more} size="sm" icon="kebab-horizontal" label="More" aria-haspopup="menu" aria-expanded={menu} disabled={sending} onClick={() => setMenu(!menu)} />
      {menu && (
        <Menu trigger={more} onClose={() => setMenu(false)}>
          <MenuItem icon={sending ? 'loading' : 'send'} spin={sending} disabled={sending} onClick={() => { setMenu(false); void sendAll(); }}>{sendText}</MenuItem>
          <MenuItem icon="copy" onClick={() => { setMenu(false); copyList(); }}>{copyLabel}</MenuItem>
        </Menu>
      )}
    </span>
  ) : faq.length >= 2 ? (
    <Button size="sm" icon={sending ? 'loading' : 'send'} disabled={sending} onClick={() => void sendAll()}>{sendText}</Button>
  ) : admins >= 2 ? (
    <Button size="sm" icon="copy" onClick={copyList}>{copyLabel}</Button>
  ) : null;
  return (
    <section>
      <SectionHead id="reply-queue" title="Reply queue" count={rows.length} action={batch} />
      <div className="as-group ov-queue-group">
        {rows.map((r) => <Ask key={r.profile + r.id} row={r} />)}
      </div>
    </section>
  );
}
