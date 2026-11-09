import { z } from 'zod';
import { profileOf } from '../claude/accounts.js';
import { errText } from '../../../../shared/util.js';
import { hubGet, hubPush, hubRows, type HubChange, type HubRow } from '../../integrations/assistant.js';
import { defineTool } from './tool.js';

export const WIKI_RULES = [
  'You can add to the user\'s wiki and memory with mcp__agentview__wiki_propose. Nothing goes live until the user approves it.',
  'Propose decisions, ownership, how a system works, who works on what, status and the user\'s preferences.',
  'Put each claim on a topic page under a heading: find the page with wiki_search, read it with wiki_page, or name a new page with its section. Memory without a page is only for the user\'s own preferences.',
  'Write claims the way a good internal wiki does: one or two specific sentences that lead with the subject and carry the detail a colleague needs, such as names, numbers, limits, ticket and PR ids and absolute dates.',
  'Bad: "The team uses a gateway for APIs." Good: "As of 3 Mar 2026 the API gateway runs in prod, deploys on merge to main and limits each user to 60 requests a minute (PLAT-412)."',
  'Date anything that can change ("As of 28 Oct 2026, ..."). Prefer several specific claims over one summary. Give each claim its sources (Slack, Linear or PR links).',
  'Call wiki_search first. Do not repeat a live, proposed or rejected claim; pass replaces when a claim updates or contradicts a live one. Prefer the newest claims; treat old, retired and superseded ones as history.',
  'Never propose secrets, credentials, tokens or file contents.',
].join(' ');

const PROFILE = z.enum(['work', 'personal']).optional().describe('Which wiki: work or personal. Defaults to the profile of the chat\'s folder');
const state = (r: HubRow) => (r.state as string | null) ?? 'live';
// Claims retired by hand or older than 90 days are kept apart so they do not crowd out current ones (isOld in web/src/codex/data/wiki.ts).
const RETIRE_AFTER = 90 * 86_400_000;
const isOld = (f: HubRow) => state(f) === 'retired' || (state(f) !== 'proposed' && typeof f.at === 'number' && f.at > 0 && Date.now() - f.at > RETIRE_AFTER);
const day = (f: HubRow) => (typeof f.at === 'number' && f.at > 0 ? new Date(f.at).toISOString().slice(0, 10) : 'undated');
const claim = (f: HubRow) => `- [${f.id}] (${day(f)}, ${state(f)}${f.superseded_by ? ', superseded' : ''}${state(f) !== 'retired' && isOld(f) ? ', old' : ''}) ${f.text}`;
const newest = (a: HubRow, b: HubRow) => ((b.at as number) ?? 0) - ((a.at as number) ?? 0);

// A chat reads only its own profile's wiki, so work chats never see personal claims and the other way round.
const own = async (cwd: string, profile = profileOf(cwd)) => {
  const [pages, facts] = await Promise.all([hubRows('pages'), hubRows('facts')]);
  return { pages: pages.filter((r) => r.profile === profile), facts: facts.filter((r) => r.profile === profile) };
};

export const wikiSearchTool = defineTool({
  name: 'wiki_search',
  description: 'Search the user\'s wiki pages and claims, most relevant first, including proposed and rejected claims. Current claims come before superseded, retired and old ones, which may be out of date. Not every word has to match.',
  schema: { query: z.string(), profile: PROFILE },
  async handler({ query, profile }, { cwd }) {
    try {
      const { pages, claims } = await hubGet<{ pages: HubRow[]; claims: HubRow[] }>(`/wiki/search?q=${encodeURIComponent(query)}&profile=${profile ?? profileOf(cwd)}`);
      const stale = (r: HubRow) => !!r.superseded_by || isOld(r);
      const p = pages.map((r) => `- page [${r.id}] ${r.title} (${r.section ?? 'no section'}, ${state(r)})`);
      const f = claims.filter((r) => !stale(r)).slice(0, 30).map(claim);
      const old = claims.filter(stale).slice(0, 10).map(claim);
      return [...p, ...f, ...(old.length ? ['Superseded, retired or old, may be out of date:', ...old] : [])].join('\n') || 'Nothing matches.';
    } catch (err) {
      return `Wiki search failed: ${errText(err)}`;
    }
  },
});

export const wikiPageTool = defineTool({
  name: 'wiki_page',
  description: 'One wiki page\'s current claims by heading, newest first, with claim ids to pass as replaces. Retired and old claims are listed last and may be out of date.',
  schema: { id: z.string(), profile: PROFILE },
  async handler({ id, profile }, { cwd }) {
    const { pages, facts } = await own(cwd, profile);
    const page = pages.find((r) => r.id === id);
    if (!page) return `No page ${id}.`;
    const byHeading = new Map<string, string[]>();
    const mine = facts.filter((r) => r.page_id === id && (state(r) === 'live' || state(r) === 'retired') && !r.superseded_by).sort(newest);
    for (const f of mine.filter((r) => !isOld(r))) {
      const h = (f.heading as string) || 'Notes';
      byHeading.set(h, [...(byHeading.get(h) ?? []), claim(f)]);
    }
    const old = mine.filter(isOld).map(claim);
    return [`# ${page.title}`, ...[...byHeading].map(([h, cs]) => `## ${h}\n${cs.join('\n')}`), ...(old.length ? [`## Older (retired or over 90 days, may be out of date)\n${old.join('\n')}`] : [])].join('\n');
  },
});

export const wikiProposeTool = defineTool({
  name: 'wiki_propose',
  description: 'Propose a claim of one or two specific sentences for the user to approve. Without page it goes to memory. page is an existing page id, or a new page title together with section.',
  schema: {
    text: z.string().max(400),
    sources: z.array(z.object({ kind: z.enum(['slack', 'linear', 'pr', 'doc', 'meeting']), label: z.string(), url: z.string().optional() })).default([]),
    page: z.string().optional(),
    section: z.string().optional().describe('Section for a new page'),
    heading: z.string().optional(),
    replaces: z.string().optional().describe('Id of the live claim this one supersedes'),
    profile: PROFILE,
  },
  async handler(a, { cwd, chatId, provider }) {
    const profile = a.profile ?? profileOf(cwd);
    const now = Date.now();
    const pages = await hubRows('pages');
    const changes: HubChange[] = [];
    let pageId = a.page ? pages.find((r) => r.profile === profile && (r.id === a.page || String(r.title).toLowerCase() === a.page!.toLowerCase()))?.id : undefined;
    if (a.page && !pageId) {
      if (!a.section) return 'A new page needs a section. Pass section, or an existing page id from wiki_search.';
      pageId = crypto.randomUUID();
      changes.push({ table: 'pages', id: pageId, profile, updated_at: now, fields: { title: a.page, section: a.section, summary: null, sort: now, state: 'proposed' } });
    }
    const id = crypto.randomUUID();
    changes.push({
      table: 'facts', id, profile, updated_at: now,
      fields: { text: a.text, page_id: pageId ?? null, heading: a.heading ?? null, sources: JSON.stringify(a.sources), at: now, state: 'proposed', replaces: a.replaces ?? null, added_by: chatId ? `${provider}:${chatId}` : provider },
    });
    await hubPush(changes);
    return `Proposed [${id}] for the user to approve${pageId ? '' : ' in memory'}.`;
  },
});
