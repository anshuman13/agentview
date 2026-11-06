import { useMemo, useState } from 'react';
import { useAssistantData } from '../data';
import { sinceLastVisit } from '../data/load';
import { resolvedQuestions } from '../meetings/OpenQuestions';
import { plural, save, stored } from '../../ui/util';
import { setView, useView } from '../view';

const LAST_VISIT = 'codex.lastVisit';

// Meetings, decisions, new claims and open questions since the last visit as one line, or null when there are none; the first visit only records the time. Opening it saves the time.
export function useSinceLastVisit() {
  const snap = useAssistantData();
  const { filter } = useView();
  const [since, setSince] = useState<number | null>(() => {
    const t = stored<number | null>(LAST_VISIT, null);
    if (t == null) save(LAST_VISIT, Date.now());
    return t;
  });
  const minute = Math.floor(Date.now() / 60000);
  const counts = useMemo(() => {
    const pick = <T extends { profile: string }>(rows: T[]) => rows.filter((r) => filter === 'all' || r.profile === filter);
    return since == null ? null : sinceLastVisit({ meetings: pick(snap.meetings), facts: pick(snap.facts) }, since, minute * 60000, resolvedQuestions());
  }, [snap.meetings, snap.facts, filter, since, minute]);
  const parts = counts ? [
    counts.meetings && plural(counts.meetings, 'meeting'),
    counts.decisions && plural(counts.decisions, 'decision'),
    counts.claims && plural(counts.claims, 'new claim'),
    counts.questions && plural(counts.questions, 'open question'),
  ].filter(Boolean) : [];
  const open = () => {
    const now = Date.now();
    save(LAST_VISIT, now);
    setSince(now);
    setView({ list: 'meetings', open: null });
  };
  return { meta: parts.length ? parts.join(', ') : null, open };
}
