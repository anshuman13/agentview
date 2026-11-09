import { useEffect, useMemo, useState } from 'react';
import type { AssistantStore } from './data/store';
import type { ItemRow } from './data/sync';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { reveal } from '../ui/util';
import { clearHistory } from './replyHistory';
import { showSnack } from './view';
import { haptic } from '../ui/haptic';
import { LINK_LIMIT, linkDomain, linkPath, linksIn, linkTitle } from './data/links';
import { tagList } from './AddSheet';

// The reply draft of a Slack ask: Send posts it in the thread as me, Edit changes it first, Skip drops it.
// An ask tagged needs-you by the scan is a decision or something urgent: the draft is a holding line and Send is quiet.
export function Draft({ row, store, onEdit }: { row: ItemRow; store: AssistantStore; onEdit: (draft: string | null) => void }) {
  const mine = tagList(row.tags).includes('needs-you');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(row.draft ?? '');
  const [edited, setEdited] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!editing) setText(row.draft ?? ''); }, [row.draft, editing]);
  const keep = () => { setEditing(false); if (text.trim() !== (row.draft ?? '')) { onEdit(text.trim() || null); setEdited(true); } };
  // The text goes with the request, so an edit made a moment ago is what gets posted even before it has synced.
  const send = async () => {
    const changed = editing ? text.trim() !== (row.draft ?? '') : edited;
    if (editing) keep();
    setSending(true);
    setError('');
    try {
      const r = await store.sendReply(row.id, changed, text.trim());
      if (r.status === 'sent' || r.status === 'dry') clearHistory(row.people);
      haptic('success');
      showSnack(r.status === 'answered' ? 'Not sent: someone already answered in the thread' : r.status === 'changed' ? 'Not sent: the thread changed since the draft' : 'Reply sent');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };
  // Skip closes the ask on the hub with no reply, so it leaves the queue and the corrections run sees the dropped draft.
  const skip = async () => {
    setSending(true);
    setError('');
    try {
      await store.skipAsk(row.id);
      haptic('tap');
      showSnack('Skipped, no reply sent');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="as-draft">
      <Section label={mine ? <><Icon name="person" small /> Needs your decision · holding note</> : 'Reply draft'} />
      {editing
        ? <textarea className="as-draft-text" autoFocus rows={3} value={text} aria-label="Reply draft" onChange={(e) => setText(e.target.value)} onFocus={reveal} onBlur={keep} />
        : <div className="as-draft-text">{row.draft}</div>}
      {error && <div className="as-draft-err">Not sent: {error}</div>}
      <div className="as-draft-bar">
        <Button size="sm" variant={mine ? 'quiet' : undefined} icon={sending ? 'loading' : error ? 'refresh' : 'send'} disabled={sending} onMouseDown={(e) => e.preventDefault()} onClick={() => void send()}>{error ? 'Retry' : mine ? 'Send note' : 'Send'}</Button>
        {!editing && <Button variant="quiet" size="sm" icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
        <Button variant="quiet" size="sm" icon="close" disabled={sending} onClick={() => void skip()}>Skip</Button>
      </div>
    </div>
  );
}

function LinkRow({ url }: { url: string }) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void linkTitle(url).then((t) => { if (current) setTitle(t); });
    return () => { current = false; };
  }, [url]);
  return <Row href={url} title={title ?? linkDomain(url)} meta={title ? linkDomain(url) : linkPath(url) || undefined} trailing={<Icon name="link-external" small />} />;
}

// The URLs in the notes as readable rows, from the text as typed.
export function Links({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const urls = useMemo(() => linksIn(text, Infinity), [text]);
  if (!urls.length) return null;
  const shown = all ? urls : urls.slice(0, LINK_LIMIT);
  return (
    <div className="as-links">
      <Section label="Links" count={urls.length} />
      <div className="ui-group">{shown.map((u) => <LinkRow key={u} url={u} />)}</div>
      {urls.length > LINK_LIMIT && <Button variant="quiet" size="sm" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+${urls.length - LINK_LIMIT} more`}</Button>}
    </div>
  );
}

