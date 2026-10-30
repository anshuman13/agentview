import { lazy, Suspense } from 'react';
import { Guard } from '../../app/Guard';
import { useCodex } from '../data';
import { live, peopleOf } from '../data/wiki';
import { meetingKey, useView } from '../view';
import { MeetingsList } from './MeetingList';

const MeetingPage = lazy(() => import('./MeetingPage').then((m) => ({ default: m.MeetingPage })));
const Person = lazy(() => import('./Person').then((m) => ({ default: m.Person })));

export { peopleOf };
export { Avatars, MeetingRow } from './MeetingList';
export { ActionRow, confirmAll } from './ActionRow';

export function Meetings({ onMenu }: { onMenu: () => void }) {
  const { open, person } = useView();
  const { meetings } = useCodex();
  const rows = live(meetings);
  const m = open ? rows.find((x) => meetingKey(x) === open) ?? rows.find((x) => x.id === open) : undefined;
  if (person) return <Guard key={person} retry><Suspense fallback={null}><Person name={person} /></Suspense></Guard>;
  if (m) return <Guard key={meetingKey(m)} retry><Suspense fallback={null}><MeetingPage m={m} /></Suspense></Guard>;
  return <MeetingsList onMenu={onMenu} />;
}
