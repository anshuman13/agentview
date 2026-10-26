import os from 'node:os';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { hubPush, hubRows, type HubChange, type HubRow } from '../../integrations/assistant.js';

export const WIKI_RULES = [
  'You can add to the user\'s wiki and memory with mcp__agentview__wiki_propose. Nothing goes live until the user approves it.',
  'Propose facts that stay true: decisions, ownership, how a system works, people and the user\'s preferences. One sentence, with sources (Slack, Linear or PR links when known).',
  'Call wiki_search first. Do not repeat a live, proposed or rejected claim; pass replaces when a claim contradicts a live one.',
  'Never propose secrets, credentials, tokens or file contents.',
].join(' ');

const PERSONAL = path.join(os.homedir(), 'workspace_personal');
export const profileOf = (cwd: string) => (cwd === PERSONAL || cwd.startsWith(PERSONAL + path.sep) ? 'personal' : 'work') as HubRow['profile'];

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const state = (r: HubRow) => (r.state as string | null) ?? 'live';
const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (ws: string[], ...texts: unknown[]) => ws.length > 0 && ws.every((w) => texts.join(' ').toLowerCase().includes(w));
const claim = (f: HubRow) => `- [${f.id}] (${state(f)}${f.superseded_by ? ', superseded' : ''}) ${f.text}`;

export function wikiTools(o: { cwd: string; chat: () => string | null }) {
  return [
    tool('wiki_search', 'Search the user\'s wiki pages and claims, including proposed and rejected claims. Every word must match.', { query: z.string() }, async ({ query }) => {
      const ws = words(query);
      const [pages, facts] = await Promise.all([hubRows('pages'), hubRows('facts')]);
      const p = pages.filter((r) => state(r) !== 'rejected' && matches(ws, r.title, r.summary)).map((r) => `- page [${r.id}] ${r.title} (${r.section ?? 'no section'}, ${state(r)})`);
      const f = facts.filter((r) => matches(ws, r.text)).slice(0, 30).map(claim);
      return text([...p, ...f].join('\n') || 'Nothing matches.');
    }),
    tool('wiki_page', 'One wiki page\'s live claims by heading, with claim ids to pass as replaces.', { id: z.string() }, async ({ id }) => {
      const [pages, facts] = await Promise.all([hubRows('pages'), hubRows('facts')]);
      const page = pages.find((r) => r.id === id);
      if (!page) return text(`No page ${id}.`);
      const byHeading = new Map<string, string[]>();
      for (const f of facts.filter((r) => r.page_id === id && state(r) === 'live' && !r.superseded_by)) {
        const h = (f.heading as string) || 'Notes';
        byHeading.set(h, [...(byHeading.get(h) ?? []), claim(f)]);
      }
      return text([`# ${page.title}`, ...[...byHeading].map(([h, cs]) => `## ${h}\n${cs.join('\n')}`)].join('\n'));
    }),
    tool(
      'wiki_propose',
      'Propose a one-sentence claim for the user to approve. Without page it goes to memory. page is an existing page id, or a new page title together with section.',
      {
        text: z.string().max(400),
        sources: z.array(z.object({ kind: z.enum(['slack', 'linear', 'pr', 'doc', 'meeting']), label: z.string(), url: z.string().optional() })).default([]),
        page: z.string().optional(),
        section: z.string().optional().describe('Section for a new page'),
        heading: z.string().optional(),
        replaces: z.string().optional().describe('Id of the live claim this one supersedes'),
        personal: z.boolean().optional().describe("True when the claim is about the user's personal life"),
      },
      async (a) => {
        const profile = a.personal ? 'personal' : profileOf(o.cwd);
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
