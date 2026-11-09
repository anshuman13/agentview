import os from 'node:os';
import path from 'node:path';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { callTool, type McpResult, type McpServerDef } from './mcpClient.js';
import type { SnowflakeObjects, SnowflakeResult, SnowflakeTest } from '../../../shared/observe.js';
import { DIR, EMPTY_SNOWFLAKE, YAML, load, type Settings } from './observeSettings.js';

const SNOWFLAKE_YAML = `other_services:
  object_manager: True
  query_manager: True
  semantic_manager: False
sql_statement_permissions:
  - Select: True
  - Describe: True
  - Show: True
  - Unknown: False
  - Alter: False
  - Command: False
  - Comment: False
  - Commit: False
  - Copy: False
  - Create: False
  - Delete: False
  - Drop: False
  - Insert: False
  - Merge: False
  - Rollback: False
  - Transaction: False
  - TruncateTable: False
  - Update: False
  - Use: False
`;

async function uvx() {
  for (const p of ['/opt/homebrew/bin/uvx', path.join(os.homedir(), '.local/bin/uvx'), '/usr/local/bin/uvx']) if (await access(p).then(() => true, () => false)) return p;
  return 'uvx';
}

export async function snowflakeDef(s: Settings): Promise<McpServerDef> {
  const c = { ...EMPTY_SNOWFLAKE, ...s.snowflake };
  if (!c.account || !c.user || !c.secret) throw new Error('Snowflake is not connected: fill in account, user and the token or password in the Snowflake section');
  await mkdir(DIR, { recursive: true });
  await writeFile(YAML, SNOWFLAKE_YAML, { mode: 0o600 });
  const args = ['snowflake-labs-mcp', '--service-config-file', YAML, '--transport', 'stdio', '--account', c.account, '--user', c.user];
  if (c.warehouse) args.push('--warehouse', c.warehouse);
  if (c.role) args.push('--role', c.role);
  if (c.auth === 'pat') args.push('--authenticator', 'PROGRAMMATIC_ACCESS_TOKEN');
  return { type: 'stdio', command: await uvx(), args, env: { SNOWFLAKE_PASSWORD: c.secret } };
}

function readOnlySql(sql: string) {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '').trim();
  if (!s) throw new Error('Empty query');
  if (s.includes(';')) throw new Error('One statement at a time');
  if (!/^(select|show|desc|describe|with)\b/i.test(s)) throw new Error('Only SELECT, SHOW, DESCRIBE and WITH queries run here');
  return s;
}

function rowsOf(r: McpResult): Record<string, unknown>[] {
  const sc = r.structuredContent as { result?: unknown } | undefined;
  const raw = sc && 'result' in sc ? sc.result : r.structuredContent;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const items: Record<string, unknown>[] = [];
  for (const c of r.content ?? []) {
    if (c.type !== 'text' || typeof c.text !== 'string') continue;
    try {
      const v = JSON.parse(c.text);
      if (Array.isArray(v)) items.push(...v);
      else if (v && typeof v === 'object') items.push(v);
    } catch {
      if (!/^no matching/i.test(c.text)) throw new Error(c.text.slice(0, 500));
    }
  }
  return items;
}

async function snowflake(tool: string, args: Record<string, string>) {
  const def = await snowflakeDef(await load());
  const t0 = Date.now();
  const items = rowsOf(await callTool('snowflake', def, tool, args, 120_000));
  return { items, ms: Date.now() - t0 };
}

export async function snowflakeQuery(sql: string): Promise<SnowflakeResult> {
  const { items, ms } = await snowflake('run_snowflake_query', { statement: readOnlySql(sql) });
  const columns = [...new Set(items.flatMap((o) => Object.keys(o)))];
  return { columns, rows: items.slice(0, 200).map((o) => columns.map((c) => o[c] ?? null)), truncated: items.length > 200, ms };
}

export async function snowflakeTest(): Promise<SnowflakeTest> {
  const { items, ms } = await snowflake('run_snowflake_query', { statement: 'select current_user() as "user", current_role() as "role", current_warehouse() as "warehouse"' });
  return { row: items[0] ?? {}, ms };
}

export async function snowflakeObjects(kind: string, database: string, schema: string): Promise<SnowflakeObjects> {
  if (!['database', 'schema', 'table', 'view'].includes(kind)) throw new Error('kind must be database, schema, table or view');
  const args: Record<string, string> = { object_type: kind };
  if (database) args.database_name = database;
  if (schema) args.schema_name = schema;
  const { items } = await snowflake('list_objects', args);
  return { names: items.map((o) => String(o.name ?? o.NAME ?? '')).filter(Boolean) };
}
