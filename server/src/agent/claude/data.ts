import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { hubPush, hubRows } from '../../integrations/assistant.js';
import { profileOf } from './wiki.js';

// The hub tables an agent may change, with their columns (the hub's TABLES). Wiki pages and claims go through wiki_propose.
const WRITABLE: Record<string, string[]> = {
  items: ['title', 'text', 'source', 'source_url', 'people', 'at', 'status', 'meeting_id'],
  meetings: ['title', 'starts_at', 'ends_at', 'people', 'calendar_url', 'recorded_ms', 'notes', 'summary', 'decisions', 'transcript', 'tries', 'room', 'room_me', 'others'],
  actions: ['meeting_id', 'kind', 'target', 'title', 'body', 'fields', 'status', 'result_url'],
  jobs: ['name', 'schedule', 'prompt', 'enabled', 'next_run_at'],
};
const TABLES = Object.keys(WRITABLE) as [string, ...string[]];

export const DATA_RULES =
  "To read or change the user's tasks, notes, meetings (including the My notes field), meeting actions or scheduled jobs in AgentView, use mcp__agentview__data_find and mcp__agentview__data_write.";

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const clip = (v: unknown) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}...` : v);

export function dataTools(o: { cwd: string }) {
  const own = async (table: string) => (await hubRows(table)).filter((r) => r.profile === profileOf(o.cwd));
  return [
    tool(
      'data_find',
      `Find rows in AgentView's data. Tables: ${Object.entries(WRITABLE).map(([t, cs]) => `${t} (${cs.join(', ')})`).join('; ')}. items are tasks and notes: status open, suggested, note or done; at is a due time. Every query word must match. Pass id for one full row.`,
      { table: z.enum(TABLES), query: z.string().optional(), id: z.string().optional() },
      async ({ table, query, id }) => {
        const rows = await own(table);
        if (id) {
          const row = rows.find((r) => r.id === id);
          return text(row ? JSON.stringify(row, null, 1) : `No ${table} row ${id}.`);
        }
        const ws = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const hits = rows
          .filter((r) => ws.every((w) => WRITABLE[table].map((c) => r[c] ?? '').join(' ').toLowerCase().includes(w)))
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, 20)
          .map((r) => JSON.stringify(Object.fromEntries([['id', r.id], ...WRITABLE[table].filter((c) => r[c] != null).map((c) => [c, clip(r[c])])])));
        return text(hits.join('\n') || 'Nothing matches.');
      },
    ),
    tool(
      'data_write',
      'Create a row in AgentView, or change fields of an existing one by id. Only the fields you pass change; a field you pass replaces its old value, so read it first to append.',
      {
        table: z.enum(TABLES),
        id: z.string().optional().describe('Existing row id; omit to create a row'),
        fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      },
      async ({ table, id, fields }) => {
        const bad = Object.keys(fields).filter((f) => !WRITABLE[table].includes(f));
        if (bad.length) return text(`Unknown fields for ${table}: ${bad.join(', ')}. Columns: ${WRITABLE[table].join(', ')}.`);
        if (id && !(await own(table)).some((r) => r.id === id)) return text(`No ${table} row ${id}.`);
        const rowId = id ?? crypto.randomUUID();
        await hubPush([{ table, id: rowId, profile: profileOf(o.cwd), updated_at: Date.now(), fields }]);
        return text(`${id ? 'Updated' : 'Created'} ${table} [${rowId}].`);
      },
    ),
  ];
}
