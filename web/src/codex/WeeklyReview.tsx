import { useRef, useState } from 'react';
import { useAssistantData, useAssistantStore } from './data';
import { GOAL, goalProgress, goalsOf, goalVerdict, pruneDismissed, reviewCarry, reviewWindow } from './data/goals';
import { hoursText, weekReview } from './data/load';
import type { Profile } from './data/sync';
import { Fold } from './Fold';
import { Icon } from '../ui/Icon';
import { plural, save, stored } from '../ui/util';
import { reviewStart } from './data/reports';
import { attempt, useView } from './view';
import { Chip } from '../ui/Button';

const DISMISSED = 'codex.weeklyReviewDismissed';
const today = (now: number) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

export function WeeklyReviewCard({ profile, now, title, onHide }: { profile: Profile; now: number; title: string; onHide: () => void }) {
  const { items: all, meetings } = useAssistantData();
  const store = useAssistantStore();
  const busy = useRef(false);
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
  const limit = plan.left > 0 && <span className="muted small">{plan.left} not carried (limit 3)</span>;
  return (
    <Fold id={`weekly-review-${profile}`} title={title}
      action={<button className="icon-btn" title="Hide until tomorrow" aria-label="Hide the weekly review until tomorrow" onClick={onHide}><Icon name="close" small /></button>}>
      <div className="gl-lines">
        {goals.map((g) => {
          const p = goalProgress(all, g);
          const verdict = goalVerdict(p);
          return <div key={g.id} className="gl-line"><span>{g.title}</span><span className="muted small">{p.done}/{p.total}</span><span className={verdict === 'Done' ? 'small' : 'gl-risk small'}>{verdict}</span></div>;
        })}
        <div className="gl-line"><span>Tasks done this week</span><span className="muted small">{rev.done.length}</span></div>
        <div className="gl-line"><span>Meeting hours</span><span className="muted small">{hoursText(rev.hours)}</span></div>
        {plan.state === 'carry' && <div className="gl-line"><Chip onClick={() => void carry()}>Carry over</Chip>{limit}</div>}
        {plan.state === 'carried' && <div className="gl-line"><span className="muted small">Carried over {plan.carried}</span>{limit}</div>}
        {plan.state === 'full' && <div className="gl-line">{limit}</div>}
      </div>
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
