import type { ItemRow } from './sync';
import { snippet } from '../../../../shared/snippet';
import { POINT, RAISED } from './points';
import { live, rowMatcher, queryWords, searchWiki, type Fact, type Job, type Meeting, type Page } from './wiki';
import { searchMeetings } from './meetings';

export { snippet };

export const GROUP_CAP = 8;

export type Hit = { id: string; profile: string; title: string; snippet: string; page?: string | null; when?: string };
export type Group = { hits: Hit[]; total: number };
export type Results = { tasks: Group; meetings: Group; wiki: Group; jobs: Group; total: number };
export type SearchData = { items: ItemRow[]; meetings: Meeting[]; facts: Fact[]; pages: Page[]; jobs: Job[] };

// Builds hits only for the rows shown, since a short query can match thousands of rows.
const group = <T,>(rows: T[], hit: (r: T) => Hit): Group => ({ hits: rows.slice(0, GROUP_CAP).map(hit), total: rows.length });

export function searchAll(data: SearchData, query: string): Results {
  const words = queryWords(query);
  const none = { hits: [], total: 0 };
  if (!words.length) return { tasks: none, meetings: none, wiki: none, jobs: none, total: 0 };
  const hitItem = rowMatcher<SearchData['items'][number]>(words, 'item', (r) => [r.title, r.text, r.people, r.source]);
  const hitJob = rowMatcher<Job>(words, 'job', (j) => [j.name, j.prompt]);
  const tasks = data.items.filter((r) => !r.deleted && !['dismissed', POINT, RAISED].includes(r.status ?? '') && hitItem(r));
  const meetings = searchMeetings(live(data.meetings), query).sort((a, b) => (b.starts_at ?? 0) - (a.starts_at ?? 0));
  const found = searchWiki(data.pages, data.facts, query);
  const wiki = [
    ...found.pages.map((p) => (): Hit => ({ id: p.id, profile: p.profile, title: p.title || 'Untitled', snippet: snippet(words, p.summary), page: p.id })),
    ...found.claims.map((f) => (): Hit => ({ id: f.id, profile: f.profile, title: snippet(words, f.text) || f.text || '', snippet: '', page: f.page_id })),
  ];
  const jobs = live(data.jobs).filter((j) => hitJob(j));
  return {
    tasks: group(tasks, (r) => ({ id: r.id, profile: r.profile, title: r.title || r.text || 'Untitled', snippet: snippet(words, r.text, r.people, r.source), page: r.meeting_id })),
    meetings: group(meetings, (m) => ({ id: m.id, profile: m.profile, title: m.title || 'Meeting', snippet: snippet(words, m.summary, m.decisions, m.notes, m.people) })),
    wiki: group(wiki, (hit) => hit()),
    jobs: group(jobs, (j) => ({ id: j.id, profile: j.profile, title: j.name || 'Untitled job', snippet: snippet(words, j.prompt) })),
    total: tasks.length + meetings.length + wiki.length + jobs.length,
  };
}
