import { useCodex } from '../data';
import { live, peopleOf } from '../data/wiki';
import { useView } from '../view';
import { MeetingPage } from './MeetingPage';
import { MeetingsList, meetingKey } from './MeetingList';
import { Person } from './Person';

export { peopleOf };
export { Avatars, MeetingRow } from './MeetingList';
export { ActionRow, confirmAll } from './ActionRow';

export function Meetings({ onMenu }: { onMenu: () => void }) {
  const { open, person } = useView();
  const { meetings } = useCodex();
  const rows = live(meetings);
  const m = open ? rows.find((x) => meetingKey(x) === open) ?? rows.find((x) => x.id === open) : undefined;
  if (person) return <Person name={person} />;
  if (m) return <MeetingPage key={meetingKey(m)} m={m} />;
  return <MeetingsList onMenu={onMenu} />;
}
