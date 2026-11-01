import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { hubPush, hubRows } from '../../integrations/assistant.js';
import { profileOf } from './wiki.js';
import { HUB_ONLY, TABLES } from '../../../../shared/tables.js';
import { nextRun, SCHEDULE_HELP } from '../../../../shared/schedule.js';

// The hub tables an agent may change, with their columns (the hub's TABLES). Wiki pages and claims go through wiki_propose.
const WRITABLE: Record<string, string[]> = Object.fromEntries(['items', 'meetings', 'actions', 'jobs'].map((t) => [t, TABLES[t].filter((c) => !HUB_ONLY.includes(c))]));
const TABLE_NAMES = Object.keys(WRITABLE) as [string, ...string[]];

export const DATA_RULES =
  "To read or change the user's tasks, notes, meetings (including the My notes field), meeting actions or scheduled jobs in AgentView, use mcp__agentview__data_find and mcp__agentview__data_write.";

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const TIMES = ['at', 'starts_at', 'ends_at', 'next_run_at'];

// Times are stored as epoch ms, so a date string becomes one. A job's new schedule or switch also clears its next run, so
// the hub plans it from the schedule. Returns an error for a value the hub could not use.
export function checkFields(table: string, fields: Record<string, string | number | null>, now = Date.now()): string | null {
  for (const f of TIMES) {
    const v = fields[f];
    if (typeof v !== 'string') continue;
    const t = /^\d+$/.test(v) ? +v : Date.parse(v);
    if (Number.isNaN(t)) return `${f} must be a time, like 2026-11-02T09:00:00+01:00 or epoch ms.`;
    fields[f] = t;
  }
  if (table !== 'jobs') return null;
  if ('schedule' in fields && nextRun(fields.schedule as string | null, now) == null) return `schedule ${JSON.stringify(fields.schedule)} never runs. Use ${SCHEDULE_HELP}.`;
  if (('schedule' in fields || 'enabled' in fields) && !('next_run_at' in fields)) fields.next_run_at = null;
  return null;
}

const clip = (v: unknown) => (typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}...` : v);

export function dataTools(o: { cwd: string }) {
  const own = async (table: string) => (await hubRows(table)).filter((r) => r.profile === profileOf(o.cwd));
  return [
    tool(
      'data_find',
      `Find rows in AgentView's data. Tables: ${Object.entries(WRITABLE).map(([t, cs]) => `${t} (${cs.join(', ')})`).join('; ')}. items are tasks and notes: status open, suggested, note or done; at is a due time. Status goal rows are weekly goals (at is their Monday), not tasks; a task links to one by goal. A job runs its prompt on schedule, which is ${SCHEDULE_HELP}; it only reads, adds Codex tasks, can push a notification and turn itself off with stop_job, plus the tools it lists in tools ("browser" for AgentView's own Chrome, or MCP tool names, * matching a prefix). Every query word must match. Pass id for one full row.`,
      { table: z.enum(TABLE_NAMES), query: z.string().optional(), id: z.string().optional() },
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
        table: z.enum(TABLE_NAMES),
        id: z.string().optional().describe('Existing row id; omit to create a row'),
        fields: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
      },
      async ({ table, id, fields }) => {
        const bad = Object.keys(fields).filter((f) => !WRITABLE[table].includes(f));
        if (bad.length) return text(`Unknown fields for ${table}: ${bad.join(', ')}. Columns: ${WRITABLE[table].join(', ')}.`);
        if (id && !(await own(table)).some((r) => r.id === id)) return text(`No ${table} row ${id}.`);
        const err = checkFields(table, fields);
        if (err) return text(err);
        const rowId = id ?? crypto.randomUUID();
        await hubPush([{ table, id: rowId, profile: profileOf(o.cwd), updated_at: Date.now(), fields }]);
        return text(`${id ? 'Updated' : 'Created'} ${table} [${rowId}].`);
      },
    ),
  ];
}
