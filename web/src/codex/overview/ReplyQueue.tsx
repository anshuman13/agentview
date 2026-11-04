import { useState } from 'react';
import { useAssistantStore } from '../data';
import { reviewedSince } from '../data/engine';
import { isSaid, type ItemRow } from '../data/sync';
import { tagList } from '../AddSheet';
import { Draft } from '../TaskEditor';
import { SectionHead } from '../Fold';
import { Button } from '../../ui/Button';
import { haptic } from '../../ui/haptic';
import { ago } from '../../ui/util';
import { openTask, showSnack } from '../view';
import { useActions } from '../useActions';

const mine = (r: ItemRow) => tagList(r.tags).includes('needs-you');
// The scan tags an answer that rests on a live wiki claim with high confidence as faq: safe to send without reading.
export const isFaq = (r: ItemRow) => tagList(r.tags).includes('faq');

// Slack asks with a reply draft, the ones that need me first, then FAQ answers, then oldest first, so a day's asks clear from one screen.
export const replyQueue = (review: ItemRow[]) => review
  .filter((r) => r.source === 'slack' && r.status === 'suggested' && !!r.draft?.trim() && !isSaid(r))
  .sort((a, b) => Number(mine(b)) - Number(mine(a)) || Number(isFaq(b)) - Number(isFaq(a)) || reviewedSince(a) - reviewedSince(b));

export function ReplyQueue({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const act = useActions();
  const [sending, setSending] = useState(false);
  const faq = rows.filter(isFaq);
  if (!rows.length) return null;
  // Posts every FAQ answer as it reads, one after the other, and reports how many went out.
  const sendAll = async () => {
    setSending(true);
    let sent = 0;
    for (const r of faq) {
      try {
        const res = await store.sendReply(r.id, false, (r.draft ?? '').trim());
        if (res.status === 'sent' || res.status === 'dry') sent++;
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
      <SectionHead title="Reply queue" count={rows.length} action={faq.length >= 2 && <Button size="sm" icon={sending ? 'loading' : 'send'} disabled={sending} onClick={() => void sendAll()}>Send all {faq.length} FAQ answers</Button>} />
      <div className="as-group ov-queue">
        {rows.map((r) => (
          <div key={r.profile + r.id} className="ov-queue-row">
            <button className="ov-queue-head" onClick={() => openTask(r)}>
              <span className="ov-t">{r.title}{isFaq(r) && <span className="ov-faq">FAQ answer</span>}</span>
              <span className="muted small">{r.people || 'Slack'} · {ago(reviewedSince(r))}</span>
            </button>
            <Draft row={r} store={store} onEdit={(draft) => act.edit(r, { draft })} />
          </div>
        ))}
      </div>
    </section>
  );
}
