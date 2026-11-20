import { IconButton } from '../../ui/Button';
import { EmptyState } from '../../ui/Panel';
import { Row } from '../../ui/Row';
import { Section, sectionCount } from '../../ui/Section';
import { copyText, openMeeting, setView, useEscapeBack } from '../view';
import { plural } from '../../ui/util';
import { questionKey } from '../data/meetings/meetings';
import { personMarkdown } from '../data/meetings/meetingMarkdown';
import { Avatars, MeetingRow } from './list/MeetingRow';
import { PinList } from './Pins';
import { OpenQuestions } from './OpenQuestions';
import { useResolvedQuestions } from './resolvedQuestions';
import { AddPoint, PointList, useMarkRaised } from './Raise';
import { Asks, Commitments, Group, OpenTasks, SlackDm, UnansweredMail, WikiClaims } from './PersonParts';
import { usePerson } from './usePerson';
import { firstName } from '../data/meetings/points';
import '../../styles/features/wiki.css';
import '../../styles/features/meetings.css';

export function Person({ name }: { name: string }) {
  const back = () => setView({ person: null });
  useEscapeBack(back);
  useMarkRaised();
  const { mine, shown, email, points, pins, commitments, claims, inbox, waiting, tasks, questions, pageTitle } = usePerson(name);
  const now = Date.now();
  const resolved = useResolvedQuestions();
  const copy = () => {
    const text = personMarkdown(name, { commitments, questions: questions.filter((q) => !resolved.includes(questionKey(q))), points, tasks, pins, meetings: mine, claims });
    copyText(text, `${firstName(shown)} copied`);
  };
  return (
    <div className="wk narrow">
      <header className="wk-head">
        <IconButton icon="arrow-left" label="Back" onClick={back} />
        <IconButton icon="copy" label="Copy as Markdown" onClick={copy} />
      </header>
      <div className="wk-scroll">
        <article className="mt-page">
          <div className="mt-title"><Section label={shown} /></div>
          <Row plain className="mt-person" leading={<Avatars people={[shown]} />} title={email || plural(mine.length, 'meeting')} meta={email ? plural(mine.length, 'meeting') : undefined} />

          {inbox.dm && <SlackDm dm={inbox.dm} />}
          <Asks name={name} rows={waiting} />
          <UnansweredMail name={name} mail={inbox.mail} />

          <OpenTasks name={name} rows={tasks} />

          <Commitments name={name} commitments={commitments} />

          <section className="mt-sec">
            <Section label={`Raise with ${firstName(shown)}`} count={sectionCount(points.length)} />
            {points.length > 0 && <PointList points={points} person={false} />}
            <AddPoint person={name} profile={mine[0]?.profile ?? 'work'} />
          </section>

          <OpenQuestions questions={questions} />

          {pins.length > 0 && (
            <section className="mt-sec">
              <Section label="Pinned" count={sectionCount(pins.length)} />
              <PinList pins={pins} onOpen={(r) => openMeeting({ profile: r.profile, id: r.meeting_id! })} />
            </section>
          )}

          <section className="mt-sec">
            <Section label="Meetings" count={sectionCount(mine.length)} />
            {mine.length > 0 ? <Group rows={mine} name={name} row={(m) => <MeetingRow key={m.profile + m.id} m={m} now={now} />} /> : <EmptyState size="sm" icon="calendar" title="No meetings" />}
          </section>

          <WikiClaims name={name} claims={claims} pageTitle={pageTitle} />
        </article>
      </div>
    </div>
  );
}
