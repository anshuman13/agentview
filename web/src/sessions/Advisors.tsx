import { send } from '../app/store';
import { MenuItem } from '../ui/Menu';
import { Row } from '../ui/Row';
import { ADVISORS, advisorOf, type Advisor } from '../../../shared/advisors';
import { type LiveChat, type SavedSession } from '../../../shared/protocol';
import { StateDot } from './ChatRows';
import { chatState, since } from './folders';

const open = (a: Advisor, fresh = false) => send({ type: 'open_advisor', id: a.id, ...(fresh && { fresh }) });

// The PM and Architect chats: tapping one goes to its open chat or resumes its latest; New conversation starts over with its memory.
export function Advisors({ live, saved, seen, viewing }: { live: LiveChat[]; saved: Map<string, SavedSession>; seen: Record<string, number>; viewing: string | null }) {
  return (
    <div className="tree needs advisors">
      <div className="group">Advisors</div>
      {ADVISORS.map((a) => {
        const c = live.find((x) => advisorOf(x.cwd)?.id === a.id);
        const state = c && chatState({ live: c, saved: saved.get(c.sessionId ?? '') }, seen);
        return (
          <div key={a.id} className={`chat-row ${state === 'done' || state === 'needs' ? 'unread' : ''}`}>
            <Row
              title={a.name}
              meta={!c ? a.hint : c.pending ? 'Needs you' : c.running ? 'Working' : `${c.title || a.hint} · ${since(c.lastActive)}`}
              leading={<StateDot state={state} />}
              aria-current={c?.id === viewing || undefined}
              onClick={() => (c ? c.id !== viewing && send({ type: 'view', id: c.id }) : open(a))}
              menu={<MenuItem icon="add" onClick={() => open(a, true)}>New conversation</MenuItem>}
            />
          </div>
        );
      })}
    </div>
  );
}
