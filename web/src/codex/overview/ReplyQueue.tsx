import { useState } from 'react';
import type { ReplyHistory } from '../data/store';
import { clearHistory, loadHistory } from '../replyHistory';
import { useAssistantStore } from '../data';
import { reviewedSince } from '../data/engine';
import { isSaid, type ItemRow } from '../data/sync';
import { tagList } from '../AddSheet';
import { Draft } from '../TaskEditor';
import { Fold, SectionHead } from '../Fold';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
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

// The last replies sent to a person, loaded when the fold first opens, so a draft stays consistent with what I already said.
function History({ who }: { who: string }) {
  const store = useAssistantStore();
  const [data, setData] = useState<ReplyHistory | null>(null);
  const [error, setError] = useState('');
  const load = () => {
    setError('');
    loadHistory(store, who).then(setData, (err: Error) => setError(err.message));
  };
  const items = data?.replies;
  return (
    <Fold id={`history.${who}`} title="History" count={items?.length || undefined} remember={false} onOpen={() => { if (!data) load(); }}>
      {error ? (
        <div className="ov-history-row"><span className="muted small">{error}</span><Button size="sm" onClick={load}>Retry</Button></div>
      ) : !items ? (
        <span className="muted small">Loading</span>
      ) : !items.length ? (
        <span className="muted small">No replies sent to {who} yet</span>
      ) : items.map((r, i) => (
        <div key={i} className="ov-history-row"><span className="muted small">{ymd(r.at)}</span><span className="small">{r.line}</span></div>
      ))}
    </Fold>
  );
}

function Undrafted({ row }: { row: ItemRow }) {
  const store = useAssistantStore();
  const [busy, setBusy] = useState(false);
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
    <div className="as-draft">
      <div className="as-draft-head"><Icon name="person" small /> Needs you: no draft, open the thread</div>
      <div className="as-draft-bar">
        {row.source_url && <Button size="sm" icon="link" onClick={() => window.open(row.source_url!, '_blank', 'noreferrer')}>Open</Button>}
        <Button variant="quiet" size="sm" icon="close" disabled={busy} onClick={() => void skip()}>Skip</Button>
      </div>
    </div>
  );
}

export function ReplyQueue({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const act = useActions();
  const [sending, setSending] = useState(false);
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
  return (
    <section>
      <SectionHead id="reply-queue" title="Reply queue" count={rows.length} action={faq.length >= 2 && <Button size="sm" icon={sending ? 'loading' : 'send'} disabled={sending} onClick={() => void sendAll()}>Send all {faq.length} FAQ answers</Button>} />
      {admins >= 2 && (
        <div className="ov-admin">
          <span className="muted small">{admins} access and limit requests, to grant in one go</span>
          <Button size="sm" icon="copy" onClick={() => copyText(adminList(rows), `Copied ${admins} requests`)}>Copy list</Button>
        </div>
      )}
      <div className="as-group ov-queue">
        {rows.map((r) => (
          <div key={r.profile + r.id} className="ov-queue-row">
            <button className="ov-queue-head" onClick={() => openTask(r)}>
              <span className="ov-t">{r.title}{isFaq(r) && <span className="ov-faq">FAQ answer</span>}</span>
              <span className="muted small">{r.people || 'Slack'} · {ago(reviewedSince(r))}</span>
            </button>
            {r.people && <History who={r.people} />}
            {drafted(r) ? <Draft row={r} store={store} onEdit={(draft) => act.edit(r, { draft })} /> : <Undrafted row={r} />}
          </div>
        ))}
      </div>
    </section>
  );
}
