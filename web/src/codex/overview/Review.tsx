import { useAssistantStore } from '../data';
import { isSaid, type ItemRow } from '../data/sync';
import { channelOf } from '../tasks/taskSource';
import { Icon } from '../../ui/Icon';
import { Button } from '../../ui/Button';
import { Section } from '../../ui/Section';
import { setView } from '../view';
import { ActionRow, confirmAll, dismissAll } from '../meetings/ActionRow';

// Suggested actions grouped by meeting, or by source for Slack and Gmail asks, each group with Confirm all.
// The hub gives my own promises from Slack and Gmail a said: id, and they group apart as "You said".
const groupOf = (r: ItemRow) => r.meeting_id ?? `source:${r.source ?? ''}${isSaid(r) ? ':said' : ''}`;

export function Review({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const groups = rows.reduce<ItemRow[][]>((acc, r) => {
    const g = acc.find((x) => x[0].profile === r.profile && groupOf(x[0]) === groupOf(r));
    if (g) g.push(r);
    else acc.push([r]);
    return acc;
  }, []);
  return groups.map((g) => (
    <section key={g[0].profile + groupOf(g[0])}>
      {g[0].meeting_id
        ? <Section label={`Is this yours? · ${g[0].people || 'Meeting'}`} action={<Button variant="quiet" size="sm" onClick={() => setView({ list: 'meetings', open: `${g[0].profile}:${g[0].meeting_id}` })}>Open meeting</Button>} />
        : <Section label={`${isSaid(g[0]) ? 'You said' : 'Is this yours?'} · ${channelOf(g[0]).label}`} />}
      <div className="as-group">
        {g.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}
        {g.length > 1 && <button className="as-confirm-all" onClick={() => confirmAll(store, g)}><Icon name="check-all" small /> Confirm all {g.length}</button>}
        {g.length > 1 && <button className="as-dismiss-all" onClick={() => dismissAll(store, g)}><Icon name="close" small /> Dismiss all {g.length}</button>}
      </div>
    </section>
  ));
}
