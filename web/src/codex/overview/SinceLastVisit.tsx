import { useMemo, useRef, useState } from 'react';
import { useAssistantData } from '../data';
import { sinceLastVisit } from '../data/load';
import { resolvedQuestions } from '../meetings/OpenQuestions';
import { plural, save, stored } from '../../ui/util';
import { focusPast, useView } from '../view';

const LAST_VISIT = 'codex.lastVisit';


// Meetings, decisions, new claims and open questions since the last dismissal; the first visit only records the time.
export function SinceLastVisit() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [since, setSince] = useState<number | null>(() => {
    const t = stored<number | null>(LAST_VISIT, null);
    if (t == null) save(LAST_VISIT, Date.now());
    return t;
  });
  const section = useRef<HTMLElement>(null);
  const minute = Math.floor(Date.now() / 60000);
  const counts = useMemo(() => {
    const pick = <T extends { profile: string }>(rows: T[]) => rows.filter((r) => filter === 'all' || r.profile === filter);
    return since == null ? null : sinceLastVisit({ meetings: pick(snap.meetings), facts: pick(snap.facts) }, since, minute * 60000, resolvedQuestions());
  }, [snap.meetings, snap.facts, filter, since, minute]);
  if (!counts) return null;
  const parts = [
    counts.meetings && plural(counts.meetings, 'meeting'),
    counts.decisions && plural(counts.decisions, 'decision'),
    counts.claims && plural(counts.claims, 'new claim'),
    counts.questions && plural(counts.questions, 'open question'),
  ].filter(Boolean);
  if (!parts.length) return null;
  const dismiss = () => {
    const now = Date.now();
    save(LAST_VISIT, now);
    setSince(now);
    focusPast(section.current);
  };
  return (
    <section ref={section}>
      <div className="ov-follow">
        <div className="ov-follow-row">
          <span className="ov-follow-text">Since you were last here: {parts.join(', ')}</span>
          <button className="btn btn-sm btn-gray" onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </section>
  );
}
