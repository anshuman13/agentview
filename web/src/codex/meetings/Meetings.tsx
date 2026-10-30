import { lazy, Suspense } from 'react';
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
  if (person) return <Suspense fallback={null}><Person name={person} /></Suspense>;
  if (m) return <Suspense fallback={null}><MeetingPage key={meetingKey(m)} m={m} /></Suspense>;
  return <MeetingsList onMenu={onMenu} />;
}
