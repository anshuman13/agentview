import { useRef, useState } from 'react';
import { useAssistantData, useAssistantStore } from './data';
import { GOAL, goalProgress, goalsOf, goalVerdict, pruneDismissed, reviewCarry, reviewWindow } from './data/goals';
import { hoursText, weekReview } from './data/load';
import type { Profile } from './data/sync';
import { Fold } from './Fold';
import { Icon } from '../ui/Icon';
import { save, stored } from '../ui/util';
import { attempt, useView } from './view';

const DISMISSED = 'codex.weeklyReviewDismissed';
const today = (now: number) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

function Card({ profile, now, title, onHide }: { profile: Profile; now: number; title: string; onHide: () => void }) {
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
        {plan.state === 'carry' && <div className="gl-line"><button className="as-chip" onClick={() => void carry()}>Carry over</button>{limit}</div>}
        {plan.state === 'carried' && <div className="gl-line"><span className="muted small">Carried over {plan.carried}</span>{limit}</div>}
        {plan.state === 'full' && <div className="gl-line">{limit}</div>}
      </div>
    </Fold>
  );
}

// From Friday 14:00 through Sunday: this week's goals as Done or Missed, tasks done and meeting hours per profile, with a Carry over of the Missed goals into next week.
export function WeeklyReview({ now }: { now: number }) {
  const { filter } = useView();
  const day = today(now);
  const [hidden, setHidden] = useState<string[]>(() => pruneDismissed(stored<string[]>(DISMISSED, []), day));
  if (!reviewWindow(now)) return null;
  const profiles: Profile[] = filter === 'all' ? ['work', 'personal'] : [filter];
  const hide = (p: Profile) => {
    const next = [...pruneDismissed(hidden, day), `${p}:${day}`];
    setHidden(next);
    save(DISMISSED, next);
  };
  return profiles.filter((p) => !hidden.includes(`${p}:${day}`)).map((p) => (
    <Card key={p} profile={p} now={now} title={`Weekly review${filter === 'all' ? ` · ${p}` : ''}`} onHide={() => hide(p)} />
  ));
}
