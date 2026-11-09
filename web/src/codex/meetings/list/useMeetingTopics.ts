import { useMemo, useState } from 'react';
import { type Fact, type Meeting } from '../../data/wiki/wiki';
import { topicTimeline } from '../../data/meetings/meetings';
import { save, stored } from '../../../ui/util';

const TOPICS_KEY = 'agentview.meetingTopics';
const SEEN_KEY = 'agentview.meetingTopicsSeen';

// Tracked topics, the ones narrowing the list, and how many entries are new for each since it was last opened.
export function useMeetingTopics(meetings: Meeting[], facts: Fact[]) {
  const [topics, setTopics] = useState(() => stored<string[]>(TOPICS_KEY, []).filter((t) => typeof t === 'string'));
  const [active, setActive] = useState<string[]>([]);
  const [seen, setSeen] = useState(() => stored<Record<string, number>>(SEEN_KEY, {}));
  const fresh = useMemo(() => Object.fromEntries(topics.map((t) => [t, topicTimeline(t, meetings, facts, seen[t] ?? 0).fresh])), [topics, meetings, facts, seen]);
  const changeTopics = (next: string[]) => {
    setTopics(next);
    setActive((a) => a.filter((t) => next.includes(t)));
    save(TOPICS_KEY, next);
  };
  const markSeen = (t: string) => {
    const next = { ...seen, [t]: Date.now() };
    setSeen(next);
    save(SEEN_KEY, next);
  };
  const addTopic = (t: string) => {
    if (!t || topics.includes(t)) return;
    markSeen(t);
    changeTopics([...topics, t]);
  };
  const removeTopic = (t: string) => {
    const { [t]: _gone, ...rest } = seen;
    setSeen(rest);
    save(SEEN_KEY, rest);
    changeTopics(topics.filter((x) => x !== t));
  };
  const toggleTopic = (t: string) => {
    if (!active.includes(t)) markSeen(t);
    setActive((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]));
  };
  return { topics, active, fresh, addTopic, removeTopic, toggleTopic };
}
