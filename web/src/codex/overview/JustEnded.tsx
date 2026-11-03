import { useAssistantData } from '../data';
import type { Meeting } from '../data/wiki';
import { actionsOf, meetingState } from '../data/meetings';
import { followUpText } from '../data/meetingMarkdown';
import { Icon } from '../../ui/Icon';
import { copyText, openMeeting } from '../view';
import { ActionRow } from '../meetings/ActionRow';

const JUST_ENDED_MS = 2 * 3600_000;
const ACTIONS_SHOWN = 3;

// Meetings that ended in the last two hours, with their actions, a follow-up draft to copy and the notes.
export function JustEnded({ meetings, now }: { meetings: Meeting[]; now: number }) {
  const snap = useAssistantData();
  const ended = meetings.filter((m) => m.ends_at != null && m.ends_at <= now && now - m.ends_at < JUST_ENDED_MS);
  if (!ended.length) return null;
  return ended.map((m) => {
    const actions = actionsOf(snap.items, m).filter((r) => r.status === 'open');
    const copy = () => copyText(followUpText(m, actions), 'Follow-up copied');
    return (
      <section key={m.profile + m.id}>
        <div className="as-section">Just ended · {m.title}</div>
        {actions.length > 0 && (
          <div className="as-group">
            {actions.slice(0, ACTIONS_SHOWN).map((r) => <ActionRow key={r.profile + r.id} row={r} />)}
            {actions.length > ACTIONS_SHOWN && <button className="as-confirm-all" onClick={() => openMeeting(m)}>Open notes for {actions.length - ACTIONS_SHOWN} more</button>}
          </div>
        )}
        <div className="as-next-actions">
          {!actions.length && meetingState(m, now) === 'waiting' && <span className="muted small ov-follow-text">Waiting for the transcript</span>}
          <button className="btn btn-sm btn-gray" onClick={copy}><Icon name="mail" small /> Copy follow-up</button>
          <button className="btn btn-sm btn-gray" onClick={() => openMeeting(m)}><Icon name="edit" small /> Notes</button>
        </div>
      </section>
    );
  });
}
