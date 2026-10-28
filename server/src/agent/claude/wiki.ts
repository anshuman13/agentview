import os from 'node:os';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { hubPush, hubRows, type HubChange, type HubRow } from '../../integrations/assistant.js';

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

const PERSONAL = path.join(os.homedir(), 'workspace_personal');
export const profileOf = (cwd: string) => (cwd === PERSONAL || cwd.startsWith(PERSONAL + path.sep) ? 'personal' : 'work') as HubRow['profile'];

const PROFILE = z.enum(['work', 'personal']).optional().describe('Which wiki: work or personal. Defaults to the profile of the chat\'s folder');
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const state = (r: HubRow) => (r.state as string | null) ?? 'live';
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (ws: string[], ...texts: unknown[]) => ws.length > 0 && ws.every((w) => texts.join(' ').toLowerCase().includes(w));
// Claims retired by hand or older than 90 days are kept apart so they do not crowd out current ones (isOld in web/src/codex/data/wiki.ts).
const RETIRE_AFTER = 90 * 86_400_000;
const isOld = (f: HubRow) => state(f) === 'retired' || (state(f) !== 'proposed' && typeof f.at === 'number' && f.at > 0 && Date.now() - f.at > RETIRE_AFTER);
const day = (f: HubRow) => (typeof f.at === 'number' && f.at > 0 ? new Date(f.at).toISOString().slice(0, 10) : 'undated');
const claim = (f: HubRow) => `- [${f.id}] (${day(f)}, ${state(f)}${f.superseded_by ? ', superseded' : ''}${state(f) !== 'retired' && isOld(f) ? ', old' : ''}) ${f.text}`;
const newest = (a: HubRow, b: HubRow) => ((b.at as number) ?? 0) - ((a.at as number) ?? 0);

export function wikiTools(o: { cwd: string; chat: () => string | null }) {
  // A chat reads only its own profile's wiki, so work chats never see personal claims and the other way round.
  const own = async (profile = profileOf(o.cwd)) => {
    const [pages, facts] = await Promise.all([hubRows('pages'), hubRows('facts')]);
    return { pages: pages.filter((r) => r.profile === profile), facts: facts.filter((r) => r.profile === profile) };
  };
  return [
    tool('wiki_search', 'Search the user\'s wiki pages and claims, newest first, including proposed and rejected claims. Current claims come before superseded, retired and old ones, which may be out of date. Every word must match.', { query: z.string(), profile: PROFILE }, async ({ query, profile }) => {
      const ws = words(query);
      const { pages, facts } = await own(profile);
      const p = pages.filter((r) => state(r) !== 'rejected' && matches(ws, r.title, r.summary)).map((r) => `- page [${r.id}] ${r.title} (${r.section ?? 'no section'}, ${state(r)})`);
      const hits = facts.filter((r) => matches(ws, r.text)).sort(newest);
      const stale = (r: HubRow) => !!r.superseded_by || isOld(r);
      const f = hits.filter((r) => !stale(r)).slice(0, 30).map(claim);
      const old = hits.filter(stale).slice(0, 10).map(claim);
      return text([...p, ...f, ...(old.length ? ['Superseded, retired or old, may be out of date:', ...old] : [])].join('\n') || 'Nothing matches.');
    }),
    tool('wiki_page', 'One wiki page\'s current claims by heading, newest first, with claim ids to pass as replaces. Retired and old claims are listed last and may be out of date.', { id: z.string(), profile: PROFILE }, async ({ id, profile }) => {
      const { pages, facts } = await own(profile);
      const page = pages.find((r) => r.id === id);
      if (!page) return text(`No page ${id}.`);
      const byHeading = new Map<string, string[]>();
      const mine = facts.filter((r) => r.page_id === id && (state(r) === 'live' || state(r) === 'retired') && !r.superseded_by).sort(newest);
      for (const f of mine.filter((r) => !isOld(r))) {
        const h = (f.heading as string) || 'Notes';
        byHeading.set(h, [...(byHeading.get(h) ?? []), claim(f)]);
      }
      const old = mine.filter(isOld).map(claim);
      return text([`# ${page.title}`, ...[...byHeading].map(([h, cs]) => `## ${h}\n${cs.join('\n')}`), ...(old.length ? [`## Older (retired or over 90 days, may be out of date)\n${old.join('\n')}`] : [])].join('\n'));
    }),
    tool(
      'wiki_propose',
      'Propose a claim of one or two specific sentences for the user to approve. Without page it goes to memory. page is an existing page id, or a new page title together with section.',
      {
        text: z.string().max(400),
        sources: z.array(z.object({ kind: z.enum(['slack', 'linear', 'pr', 'doc', 'meeting']), label: z.string(), url: z.string().optional() })).default([]),
        page: z.string().optional(),
        section: z.string().optional().describe('Section for a new page'),
        heading: z.string().optional(),
        replaces: z.string().optional().describe('Id of the live claim this one supersedes'),
        profile: PROFILE,
      },
      async (a) => {
        const profile = a.profile ?? profileOf(o.cwd);
        const now = Date.now();
        const pages = await hubRows('pages');
        const changes: HubChange[] = [];
        let pageId = a.page ? pages.find((r) => r.profile === profile && (r.id === a.page || String(r.title).toLowerCase() === a.page!.toLowerCase()))?.id : undefined;
        if (a.page && !pageId) {
          if (!a.section) return text('A new page needs a section. Pass section, or an existing page id from wiki_search.');
          pageId = crypto.randomUUID();
          changes.push({ table: 'pages', id: pageId, profile, updated_at: now, fields: { title: a.page, section: a.section, summary: null, sort: now, state: 'proposed' } });
        }
        const id = crypto.randomUUID();
        const chat = o.chat();
        changes.push({
          table: 'facts', id, profile, updated_at: now,
          fields: { text: a.text, page_id: pageId ?? null, heading: a.heading ?? null, sources: JSON.stringify(a.sources), at: now, state: 'proposed', replaces: a.replaces ?? null, added_by: chat ? `claude:${chat}` : 'claude' },
        });
        await hubPush(changes);
        return text(`Proposed [${id}] for the user to approve${pageId ? '' : ' in memory'}.`);
      },
    ),
  ];
}
