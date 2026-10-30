import type { ItemRow } from './sync';
import { snippet } from '../../../../shared/snippet';
import { POINT, RAISED } from './points';
import { keyWords } from '../../../../shared/claimMatch';
import { currentClaim, isOld, live, rowMatcher, queryWords, searchWiki, type Fact, type Job, type Meeting, type Page } from './wiki';
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

// Related while writing: current wiki claims, meetings and Slack chats sharing key words with the text.
export type Related = { kind: 'wiki' | 'meeting' | 'slack'; profile: string; id: string; title: string; at: number; page?: string | null; url?: string | null };
export type RelatedData = { items: ItemRow[]; meetings: Meeting[]; facts: Fact[]; pages: Page[] };
type Index = Map<string, Related[]>;

const indexes = new WeakMap<object, Index>();
// One inverted index per source array, built once and reused while the array is unchanged.
function indexOf<T extends object>(rows: T[], entries: (rows: T[]) => [Related, string][]) {
  let idx = indexes.get(rows);
  if (idx) return idx;
  idx = new Map();
  for (const [r, text] of entries(rows)) for (const w of keyWords(text)) {
    const list = idx.get(w);
    if (list) list.push(r);
    else idx.set(w, [r]);
  }
  indexes.set(rows, idx);
  return idx;
}

const claimEntries = (pages: Page[]) => (facts: Fact[]): [Related, string][] => {
  const title = new Map(pages.map((p) => [`${p.profile}:${p.id}`, p.title ?? '']));
  const current = currentClaim(facts);
  return live(facts).filter((f) => current(f) && !isOld(f) && f.text).map((f) => {
    const t = title.get(`${f.profile}:${f.page_id}`) ?? '';
    return [{ kind: 'wiki', profile: f.profile, id: f.id, title: f.text!, at: f.at ?? 0, page: f.page_id }, `${f.text} ${t}`];
  });
};
const meetingEntries = (meetings: Meeting[]): [Related, string][] =>
  live(meetings).map((m) => [{ kind: 'meeting', profile: m.profile, id: m.id, title: m.title || 'Meeting', at: m.starts_at ?? 0 }, [m.title, m.notes, m.summary, m.decisions].join(' ')]);
const slackEntries = (items: ItemRow[]): [Related, string][] =>
  items.filter((r) => !r.deleted && r.source === 'slack' && r.source_url).map((r) => [{ kind: 'slack', profile: r.profile, id: r.id, title: r.title || r.text || 'Slack', at: r.updated_at, url: r.source_url }, [r.title, r.text, r.people].join(' ')]);

// The top hits sharing at least two key words with the text, most shared first, then newest; meetings yet to start are left out.
export function related(data: RelatedData, text: string, profile: string, skip: string[] = [], now = Date.now(), max = 3): Related[] {
  const words = keyWords(text);
  if (words.size < 2) return [];
  const all = [indexOf(data.facts, claimEntries(data.pages)), indexOf(data.meetings, meetingEntries), indexOf(data.items, slackEntries)];
  const n = new Map<Related, number>();
  for (const idx of all) for (const w of words) for (const r of idx.get(w) ?? []) if (r.profile === profile) n.set(r, (n.get(r) ?? 0) + 1);
  const out: Related[] = [];
  for (const [r, c] of n) if (c >= 2 && !skip.includes(r.id) && !(r.kind === 'meeting' && r.at > now)) out.push(r);
  return out.sort((a, b) => n.get(b)! - n.get(a)! || b.at - a.at).slice(0, max);
}
