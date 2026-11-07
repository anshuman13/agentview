import { useRef, useState } from 'react';
import { useAssistantData, useAssistantStore } from './data';
import { GOAL, goalProgress, goalsOf, goalVerdict, pruneDismissed, reviewCarry, reviewWindow } from './data/goals';
import { hoursText, weekReview } from './data/load';
import type { Profile } from './data/sync';
import { Fold } from './Fold';
import { plural, save, stored } from '../ui/util';
import { reviewStart } from './data/reports';
import { attempt, openTask, setView, useView } from './view';
import { Button, IconButton } from '../ui/Button';
import { AskRow } from '../ui/AskRow';
import { Row } from '../ui/Row';
import { Section, sectionCount } from '../ui/Section';
import { statusTime } from './data/engine';
import { Badge } from '../ui/Badge';

const DISMISSED = 'codex.weeklyReviewDismissed';
const SHOWN = 5;
const today = (now: number) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function WeeklyReviewCard({ profile, now, title, onHide }: { profile: Profile; now: number; title: string; onHide: () => void }) {
  const { items: all, meetings } = useAssistantData();
  const store = useAssistantStore();
  const busy = useRef(false);
  const [showAll, setAll] = useState(false);
  const rev = weekReview({ items: all.filter((r) => r.profile === profile), meetings: meetings.filter((m) => m.profile === profile), facts: [] }, now);
  const goals = goalsOf(all, now, profile);
  if (!goals.length && !rev.done.length) return null;
  const plan = reviewCarry(all, now, profile);
  const carry = async () => {
    if (busy.current) return;
    busy.current = true;
    await attempt(async () => { for (const t of plan.titles) await store.capture(t, GOAL, profile, plan.next); }, 'Not carried over');
    busy.current = false;
  };
  const left = plan.left > 0 ? `${plan.left} not carried (limit 3)` : '';
  const noteText = [plan.state === 'carried' && `Carried over ${plan.carried}`, plan.state !== 'carry' && left].filter(Boolean).join(' · ');
  const shown = showAll ? rev.done : rev.done.slice(0, SHOWN);
  return (
    <Fold id={`weekly-review-${profile}`} title={title}
      action={<IconButton size="sm" icon="close" label="Hide until tomorrow" onClick={onHide} />}>
      {(goals.length > 0 || noteText) && (
        <section>
          <Section label="Goals" count={sectionCount(goals.length)}
            action={plan.state === 'carry' && <Button variant="quiet" size="sm" onClick={() => void carry()}>Carry over</Button>} />
          <div className="as-group">
            {goals.map((g) => {
              const p = goalProgress(all, g);
              const verdict = goalVerdict(p);
              return <Row key={g.id} plain title={g.title} meta={`${p.done}/${p.total} tasks`} trailing={<Badge status={verdict === 'Done' ? 'done' : 'late'} reason={verdict === 'Done' ? undefined : verdict} />} />;
            })}
            {noteText && <Row plain title={noteText} />}
          </div>
        </section>
      )}
      {rev.done.length > 0 && (
        <section>
          <Section label="Tasks done this week" count={rev.done.length} />
          <div className="as-group">
            {shown.map((r) => <Row key={r.profile + r.id} title={r.title} meta={new Date(statusTime(r)).toLocaleDateString([], { weekday: 'short' })} onClick={() => openTask(r)} />)}
            {!showAll && rev.done.length > SHOWN && <AskRow title={`Show all ${rev.done.length}`} onClick={() => setAll(true)} />}
          </div>
        </section>
      )}
      {rev.meetings > 0 && (
        <section>
          <Section label="Meetings" count={rev.meetings} />
          <div className="as-group">
            <Row title="Meeting hours" meta={hoursText(rev.hours)} onClick={() => setView({ list: 'meetings', open: null })} />
          </div>
        </section>
      )}
    </Fold>
  );
}

export type WeeklyReport = { key: string; at: number; profile: Profile; summary: string };

// From Friday 14:00 through Sunday: this week's goals as Done or Missed, tasks done and meeting hours per profile, with a Carry over of the Missed goals into next week. A profile with no goals and no done tasks has no review.
export function useWeeklyReviews(now: number) {
  const { filter } = useView();
  const { items: all, meetings } = useAssistantData();
  const day = today(now);
  const [hidden, setHidden] = useState<string[]>(() => pruneDismissed(stored<string[]>(DISMISSED, []), day));
  const hide = (p: Profile) => {
    const next = [...pruneDismissed(hidden, day), `${p}:${day}`];
    setHidden(next);
    save(DISMISSED, next);
  };
  const profiles: Profile[] = filter === 'all' ? ['work', 'personal'] : [filter];
  const reports = !reviewWindow(now) ? [] : profiles.filter((p) => !hidden.includes(`${p}:${day}`)).flatMap((profile): WeeklyReport[] => {
    const rev = weekReview({ items: all.filter((r) => r.profile === profile), meetings: meetings.filter((m) => m.profile === profile), facts: [] }, now);
    const goals = goalsOf(all, now, profile);
    if (!goals.length && !rev.done.length) return [];
    const met = goals.filter((g) => goalVerdict(goalProgress(all, g)) === 'Done').length;
    return [{ key: `${profile}:${day}`, at: reviewStart(now), profile, summary: `${met}/${goals.length} goals done, ${plural(rev.done.length, 'task')} done` }];
  });
  return { reports, hide };
}
