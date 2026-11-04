import { useAssistantStore } from '../data';
import { reviewedSince } from '../data/engine';
import { isSaid, type ItemRow } from '../data/sync';
import { tagList } from '../AddSheet';
import { Draft } from '../TaskEditor';
import { ago } from '../../ui/util';
import { openTask } from '../view';
import { useActions } from '../useActions';

const mine = (r: ItemRow) => tagList(r.tags).includes('needs-you');

// Slack asks with a reply draft, the ones that need me first, then oldest first, so a day's asks clear from one screen.
export const replyQueue = (review: ItemRow[]) => review
  .filter((r) => r.source === 'slack' && r.status === 'suggested' && !!r.draft?.trim() && !isSaid(r))
  .sort((a, b) => Number(mine(b)) - Number(mine(a)) || reviewedSince(a) - reviewedSince(b));

export function ReplyQueue({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const act = useActions();
  if (!rows.length) return null;
  return (
    <section>
      <div className="as-section">Reply queue · {rows.length}</div>
      <div className="as-group ov-queue">
        {rows.map((r) => (
          <div key={r.profile + r.id} className="ov-queue-row">
            <button className="ov-queue-head" onClick={() => openTask(r)}>
              <span className="ov-t">{r.title}</span>
              <span className="muted small">{r.people || 'Slack'} · {ago(reviewedSince(r))}</span>
            </button>
            <Draft row={r} store={store} onEdit={(draft) => act.edit(r, { draft })} />
          </div>
        ))}
      </div>
    </section>
  );
}
