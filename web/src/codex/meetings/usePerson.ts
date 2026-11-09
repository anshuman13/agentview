import { useMemo } from 'react';
import { useAssistantData, useCodex } from '../data';
import { claimsMentioning } from '../data/wiki/wiki';
import { commitmentsOf, meetingsOf, nameOf, openQuestions, peopleOf, pinsOf, sameName } from '../data/meetings/meetings';
import { openTasksOf, personInbox, unanswered } from '../data/tasks/review';
import { pointsOf } from '../data/meetings/points';

export function usePerson(name: string) {
  const { meetings, facts, pages } = useCodex();
  const snap = useAssistantData();
  const mine = useMemo(() => meetingsOf(meetings, name), [meetings, name]);
  const shown = useMemo(() => nameOf(meetings, name), [meetings, name]);
  const email = name.includes('@') ? name.trim() : mine.flatMap(peopleOf).find((p) => p.includes('@') && sameName(p, name));
  const points = useMemo(() => pointsOf(snap.items, name), [snap.items, name]);
  const pins = useMemo(() => pinsOf(snap.items, mine), [snap.items, mine]);
  const commitments = useMemo(() => commitmentsOf(meetings, name), [meetings, name]);
  const claims = useMemo(() => claimsMentioning(facts, name), [facts, name]);
  const inbox = useMemo(() => personInbox(name, snap.items, snap.chats, unanswered(snap.briefs)), [name, snap.items, snap.chats, snap.briefs]);
  const waiting = useMemo(() => {
    const seen = new Set<string>();
    return [...inbox.asks, ...inbox.promises].filter((r) => {
      const k = r.profile + r.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [inbox]);
  const tasks = useMemo(() => openTasksOf(name, snap.items), [name, snap.items]);
  const questions = openQuestions(mine);
  const pageTitle = useMemo(() => new Map(pages.map((p) => [p.id, p.title])), [pages]);
  return { mine, shown, email, points, pins, commitments, claims, inbox, waiting, tasks, questions, pageTitle };
}
