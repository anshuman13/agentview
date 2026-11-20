import { useAssistantData, useAssistantStore } from '../data';
import { isSaid } from '../data/sync';
import type { ItemRow } from '../data/sync';
import { channelOf } from '../tasks/taskSource';
import { Button } from '../../ui/Button';
import { Section } from '../../ui/Section';
import { setView } from '../view';
import { ActionRow, confirmAll, dismissAll } from '../meetings/ActionRow';
import { actionGroups, meetingGroupTitle } from '../../../../shared/actionMenu';

// Suggested actions grouped by meeting, or by source for Slack and Gmail asks, each group with Confirm all.
// The hub gives my own promises from Slack and Gmail a said: id, and they group apart as "You said".
export function Review({ rows }: { rows: ItemRow[] }) {
  const store = useAssistantStore();
  const { meetings } = useAssistantData();
  return actionGroups(rows).map(({ key, rows: g }) => (
    <section key={key}>
      {g[0].meeting_id
        ? <Section label={`Is this yours? · ${meetingGroupTitle(meetings.find((m) => m.profile === g[0].profile && m.id === g[0].meeting_id)?.title, g[0].people)}`} action={<Button variant="quiet" size="sm" onClick={() => setView({ list: 'meetings', open: `${g[0].profile}:${g[0].meeting_id}` })}>Open meeting</Button>} />
        : <Section label={`${isSaid(g[0]) ? 'You said' : 'Is this yours?'} · ${channelOf(g[0]).label}`} />}
      <div className="as-group">
        {g.map((r) => <ActionRow key={r.profile + r.id} row={r} />)}
        {g.length > 1 && (
          <div className="as-group-all">
            <Button variant="filled" size="sm" icon="check-all" onClick={() => confirmAll(store, g)}>Confirm all {g.length}</Button>
            <Button variant="quiet" size="sm" icon="close" onClick={() => dismissAll(store, g)}>Dismiss all {g.length}</Button>
          </div>
        )}
      </div>
    </section>
  ));
}
