import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { MCP_BAD, type ChatEvent, type McpSchema, type McpServer, type McpTool } from '../../../shared/protocol';
import { api, getState, notice, send, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { ago, command, pressable, showChat, useTick } from '../ui/util';

const STATUS: Record<string, [tone: string, label: string]> = {
  connected: ['ok', 'Connected'],
  failed: ['bad', 'Failed'],
  'needs-auth': ['warn', 'Needs login'],
  pending: ['wait', 'Connecting'],
  disabled: ['off', 'Disabled'],
  probing: ['wait', 'Checking'],
};
const statusOf = (s: string) => STATUS[s] ?? ['off', s];
const needsYou = (r: { status: string; live?: boolean }) => r.status === 'failed' || (r.status === 'needs-auth' && !!r.live);
const stateOf = (r: { status: string; live?: boolean; account?: string }): [tone: string, label: string] => (r.account && !r.live ? ['off', 'Other account'] : r.status === 'needs-auth' && !r.live ? ['off', 'OAuth via Claude'] : statusOf(r.status));

const SCOPES: [id: string, title: string, where: string][] = [
  ['user', 'Your servers', '~/.claude.json'],
  ['project', 'This repo', '.mcp.json'],
  ['local', 'This folder', '~/.claude.json · project entry'],
  ['claudeai', 'Claude.ai connectors', 'claude.ai settings'],
  ['plugin', 'Plugins', 'Claude Code plugins'],
];
const scopeInfo = (id: string) => SCOPES.find((s) => s[0] === id) ?? [id, id[0].toUpperCase() + id.slice(1), ''];


const slug = (server: string) => server.replace(/[^A-Za-z0-9_-]/g, '_');
export const toolId = (server: string, tool: string) => `mcp__${slug(server)}__${tool}`;
const insert = (text: string) => {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text } }));
};
const use = (server: string, tool?: string) => {
  showChat();
  window.dispatchEvent(new CustomEvent('agentview:use', { detail: { server, tool } }));
};

export type Row = McpServer & { live?: boolean; account?: string };
export const rowKey = (r: Row) => (r.account ? `${r.account}:${r.name}` : r.name);

export function merge(probed: McpServer[], live: McpServer[]): Row[] {
  const rows: Row[] = probed.map((p) => ({ ...p }));
  for (const m of live) {
    const i = rows.findIndex((r) => r.name === m.name);
    const probedTools = rows[i]?.tools;
    const tools = m.tools?.some((t) => t.description) ? m.tools.map((t) => ({ inputSchema: probedTools?.find((p) => p.name === t.name)?.inputSchema, ...t })) : probedTools ?? m.tools;
    if (i >= 0) rows[i] = { ...rows[i], ...m, error: m.error, tools, scope: rows[i].scope ?? m.scope, live: true };
    else rows.push({ ...m, live: true });
  }
  return rows;
}

type ToolResult = Extract<ChatEvent, { kind: 'tool_result' }>;
export type Call = { id: string; server: string; tool: string; input: Record<string, unknown>; at: number; result?: ToolResult };
export type Usage = { calls: Call[]; errors: number };

export function mcpCalls(events: ChatEvent[]): Map<string, Usage> {
  const results = new Map<string, ToolResult>();
  for (const e of events) if (e.kind === 'tool_result') results.set(e.toolUseId, e);
  const by = new Map<string, Usage>();
  for (const e of events) {
    if (e.kind !== 'tool_use' || !e.name.startsWith('mcp__') || e.name.endsWith('__set_status')) continue;
    const [, server, ...tool] = e.name.split('__');
    const result = results.get(e.id);
    const u = by.get(server) ?? { calls: [], errors: 0 };
    u.calls.push({ id: e.id, server, tool: tool.join('__'), input: e.input, at: e.at, result });
    if (result?.isError) u.errors++;
    by.set(server, u);
  }
  return by;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const usageText = (u: Usage) => `${plural(u.calls.length, 'call')}${u.errors ? ` · ${plural(u.errors, 'error')}` : ''}`;
const brief = (input: Record<string, unknown>) =>
  Object.entries(input).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').replace(/\s+/g, ' ').slice(0, 160);

async function share(lead: string, text: string, file: string) {
  if (text.length <= 2000) return insert(`${lead}: ${text.slice(0, 300).trim()}${text.length > 300 ? '...' : ''} `);
  try {
    const r = await fetch(api(`/api/paste?name=${encodeURIComponent(file)}`), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: text });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    insert(`${lead}: [File: ${body.path}] `);
  } catch (err) {
    notice(`Could not attach the result: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const cite = (c: Call) => share(`Earlier mcp__${c.server}__${c.tool} call ${c.result?.isError ? 'failed with' : 'returned'}`, c.result?.text ?? '', `${c.server}-${c.tool}.txt`);

export type Field = { name: string; kind: 'text' | 'long' | 'number' | 'integer' | 'bool' | 'enum' | 'json'; required: boolean; description?: string; options?: unknown[]; default?: unknown };
export type Values = Record<string, string | boolean>;
const LONG = /\b(sql|body|content|markdown|code|script|prompt|message|logql|promql|json|yaml|multi-?line)\b/i;

export function fieldsOf(schema?: McpSchema): Field[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, p]) => {
    const type = [p.type].flat().find((t) => t && t !== 'null');
    const kind: Field['kind'] = p.enum?.length ? 'enum'
      : type === 'string' ? (LONG.test(`${name} ${p.description ?? ''}`) || (p.maxLength ?? 0) > 200 ? 'long' : 'text')
      : type === 'number' || type === 'integer' ? type
      : type === 'boolean' ? 'bool' : 'json';
    return { name, kind, required: required.has(name), description: p.description, options: p.enum, default: p.default };
  });
}

export function initialValues(fields: Field[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.kind === 'bool') { if (f.default !== undefined || f.required) v[f.name] = f.default === true; }
    else if (f.kind === 'enum') v[f.name] = f.default !== undefined ? JSON.stringify(f.default) : f.required ? JSON.stringify(f.options![0]) : '';
    else if (f.kind === 'json') v[f.name] = f.default !== undefined ? JSON.stringify(f.default, null, 2) : '';
    else v[f.name] = f.default !== undefined ? String(f.default) : '';
  }
  return v;
}

export function argsOf(fields: Field[], values: Values): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.kind === 'bool') { if (v !== undefined) args[f.name] = !!v; continue; }
    const s = typeof v === 'string' ? v : '';
    if (!s.trim()) { if (f.required) throw new Error(`${f.name} is required`); continue; }
    if (f.kind === 'number' || f.kind === 'integer') {
      const n = Number(s);
      if (!Number.isFinite(n) || (f.kind === 'integer' && !Number.isInteger(n))) throw new Error(`${f.name} must be ${f.kind === 'integer' ? 'a whole number' : 'a number'}`);
      args[f.name] = n;
    } else if (f.kind === 'enum' || f.kind === 'json') {
      try { args[f.name] = JSON.parse(s); } catch { throw new Error(`${f.name} is not valid JSON`); }
    } else args[f.name] = s;
  }
  return args;
}

const runnable = (r: Row) => r.type !== 'claudeai' && r.type !== 'sse' && r.status !== 'needs-auth' && ['user', 'project', 'local'].includes(r.scope ?? '');

export type Kind = 'Databases' | 'Tools' | 'Connectors';
export type Service = { name: string; kind: Kind; variants: { variant: string; row: Row }[] };
const KINDS: Kind[] = ['Databases', 'Tools', 'Connectors'];
const SQL_TOOL = /execute_sql|run_query|query_sql|list_tables/;
const SQL_CMD = /postgres|mysql|sqlite|toolbox/i;

export const splitName = (name: string): [service: string, variant: string] => {
  const i = name.search(/[_-]/);
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ''];
};

export const kindOf = (r: Row): Kind =>
  r.tools?.some((t) => SQL_TOOL.test(t.name)) || SQL_CMD.test(r.command ?? '') ? 'Databases' : r.type === 'claudeai' ? 'Connectors' : 'Tools';

const rank = (k: Kind) => (k === 'Databases' ? 2 : k === 'Connectors' ? 1 : 0);

export function services(rows: Row[]): Service[] {
  const by = new Map<string, Service>();
  for (const row of rows) {
    const [name, variant] = splitName(row.name);
    const key = row.account ? `${row.account}:${name}` : name;
    const s = by.get(key) ?? { name, kind: 'Tools', variants: [] };
    s.variants.push({ variant, row });
    if (rank(kindOf(row)) > rank(s.kind)) s.kind = kindOf(row);
    by.set(key, s);
  }
  for (const s of by.values()) s.variants.sort((a, b) => a.variant.localeCompare(b.variant));
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type Group = 'work' | 'personal';

// claude.ai connectors belong to the chat's Claude account: alt is the work account, main the personal one.
const accountGroup = (a: string): Group => (a === 'alt' ? 'work' : 'personal');
const hideKey = (s: Service) => `hide:${s.name}`;
const groupKey = (r: Row) => (r.account ? `${r.account}:${r.name}` : splitName(r.name)[0]);
const CONNECTORS = 'agentview.mcp.connectors';

// Keeps the last connector list seen per account, so both accounts show whichever one this chat runs on.
function connectorsByAccount(account: string, live: Row[]): Row[] {
  let seen: Record<string, Row[]> = {};
  try { seen = JSON.parse(localStorage.getItem(CONNECTORS) ?? '{}'); } catch {}
  const mine = live.filter((r) => r.type === 'claudeai');
  if (mine.length) {
    seen[account] = mine.map((r) => ({ name: r.name, type: r.type, status: r.status, scope: r.scope, tools: r.tools?.map((t) => ({ name: t.name })) }) as Row);
    localStorage.setItem(CONNECTORS, JSON.stringify(seen));
  }
  return Object.entries(seen).filter(([a]) => a !== account).flatMap(([a, rows]) => rows.map((r) => ({ ...r, account: a, live: false })));
}

export function McpPage() {
  const mcp = useStore((s) => s.session.mcp);
  const account = useStore((s) => s.session.account);
  const id = useStore((s) => s.session.id);
  const events = useStore((s) => s.events);
  const [probed, setProbed] = useState<McpServer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [groups, setGroups] = useState<Record<string, Group | 'hidden'>>({});
  const [showHidden, setShowHidden] = useState(false);

  const load = (refresh = false) => {
    setBusy(true);
    setError('');
    send({ type: 'mcp_status' });
    // A connector logged in on claude.ai after the chat started only shows up once the chat reconnects it.
    for (const m of getState().session.mcp) if (m.type === 'claudeai' && m.status === 'needs-auth') send({ type: 'mcp_reconnect', name: m.name });
    fetch(api(`/api/mcp/probe${refresh ? '?refresh=1' : ''}`))
      .then((r) => r.json())
      .then((p) => { if (Array.isArray(p)) { setProbed(p); setAt(Date.now()); } else setError(p?.error ?? 'Probe failed'); }, (e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => load(), [id]);
  useEffect(() => {
    fetch(api('/api/mcp/groups')).then((r) => r.json()).then((g) => g && typeof g === 'object' && setGroups(g), () => undefined);
  }, []);
  useTick(15000);

  const setGroup = (service: string, group: Group | 'hidden' | 'shown') => {
    setGroups((g) => { const { [service]: _, ...rest } = g; return group === 'shown' ? rest : { ...rest, [service]: group }; });
    post('/api/mcp/groups', { service, group }).then(setGroups, (e) => notice(`Could not save the group: ${e.message}`));
  };

  const rows = useMemo(() => {
    const merged: Row[] = merge(probed ?? [], mcp).map((r) => (r.type === 'claudeai' ? { ...r, account } : r));
    const other = connectorsByAccount(account, merged).filter((o) => !merged.some((r) => r.name === o.name && r.account === o.account));
    return [...merged, ...other];
  }, [probed, mcp, account]);
  const list = useMemo(() => services(rows), [rows]);
  const usage = useMemo(() => mcpCalls(events), [events]);
  const usageOf = (r: Row) => usage.get(slug(r.name));
  const current = rows.find((r) => rowKey(r) === sel) ?? null;
  const ok = rows.filter((r) => r.status === 'connected').length;
  const attention = rows.filter(needsYou).length;
  const extra = document.getElementById('page-mcp-extra');
  const groupOf = (r: Row): Group => { const g = groups[groupKey(r)]; return g === 'work' || g === 'personal' ? g : r.account ? accountGroup(r.account) : 'work'; };
  const hidden = (s: Service) => groups[hideKey(s)] === 'hidden';
  const shown = list.filter((s) => !hidden(s));
  const hiddenList = list.filter(hidden);
  const pick = (name: string) => setSel((s) => (s === name ? null : name));

  return (
    <div className={`mcp-page ${current ? 'with-detail' : ''}`}>
      <div className="mcp-main">
        {extra && createPortal(
          <div className="mcp-stats">
            {probed !== null && <span className={attention ? 'warn' : ''}><b>{ok}</b> connected of {rows.length}</span>}
            {attention > 0 && <span className="bad"><b>{attention}</b> need you</span>}
            <button className={`btn mcp-refresh ${busy ? 'busy' : ''}`} onClick={() => load(true)} disabled={busy} title="Connect to every server again">
              <Icon name={busy ? 'loading' : 'refresh'} small spin={busy} /> {busy ? 'Checking' : at ? `Checked ${ago(at, ' ago')}` : 'Check'}
            </button>
          </div>,
          extra,
        )}
        {error && <div className="mcp-error"><Icon name="error" small /> {error}</div>}
        {probed === null && !error && (
          <div className="mcp-list">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="mcp-row skeleton" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
        )}
        {probed !== null && rows.length === 0 && (
          <div className="mcp-empty">
            <Icon name="plug" />
            <div className="empty-title">No MCP servers yet</div>
            <div className="muted">Add one with <code>claude mcp add</code> or connect one on claude.ai, then check again.</div>
          </div>
        )}
        {(['work', 'personal'] as Group[]).map((g) => {
          const mine = shown.filter((s) => groupOf(s.variants[0].row) === g);
          if (!mine.length) return null;
          return (
            <section key={g} className="mcp-section">
              <div className="mcp-group-head">{g === 'work' ? 'Work' : 'Personal'}<span className="muted count">{mine.length}</span></div>
              {KINDS.map((k) => {
                const of = mine.filter((s) => s.kind === k);
                if (!of.length) return null;
                return (
                  <div key={k} className="mcp-kind">
                    <div className="mcp-section-head"><span>{k}</span></div>
                    <div className="mcp-list">
                      {of.map((s) => <ServiceRow key={rowKey(s.variants[0].row)} service={s} sel={sel} usageOf={usageOf} onPick={pick} group={g} onGroup={(to) => setGroup(groupKey(s.variants[0].row), to)} onHide={() => setGroup(hideKey(s), 'hidden')} />)}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
        {hiddenList.length > 0 && (
          <section className="mcp-section">
            <button className="mcp-group-head mcp-hidden-head" onClick={() => setShowHidden((v) => !v)}>
              <Icon name={showHidden ? 'chevron-down' : 'chevron-right'} small />Hidden<span className="muted count">{hiddenList.length}</span>
            </button>
            {showHidden && (
              <div className="mcp-list">
                {hiddenList.map((s) => <ServiceRow key={rowKey(s.variants[0].row)} service={s} sel={sel} usageOf={usageOf} onPick={pick} group={groupOf(s.variants[0].row)} onGroup={(to) => setGroup(groupKey(s.variants[0].row), to)} onHide={() => setGroup(hideKey(s), 'shown')} isHidden />)}
              </div>
            )}
          </section>
        )}
      </div>
      {current && <Detail row={current} usage={usageOf(current)} group={groupOf(current)} onGroup={(to) => setGroup(groupKey(current), to)} onClose={() => setSel(null)} />}
    </div>
  );
}

function ServiceRow({ service, sel, usageOf, onPick, group, onGroup, onHide, isHidden }: { service: Service; sel: string | null; usageOf: (r: Row) => Usage | undefined; onPick: (name: string) => void; group: Group; onGroup: (g: Group) => void; onHide: () => void; isHidden?: boolean }) {
  const calls = service.variants.reduce((n, v) => n + (usageOf(v.row)?.calls.length ?? 0), 0);
  const errors = service.variants.reduce((n, v) => n + (usageOf(v.row)?.errors ?? 0), 0);
  const other: Group = group === 'work' ? 'personal' : 'work';
  return (
    <div className={`mcp-row ${service.variants.some((v) => rowKey(v.row) === sel) ? 'selected' : ''}`}>
      <button className="mcp-row-name" onClick={() => onPick(rowKey(service.variants[0].row))}>{service.name}</button>
      <div className="mcp-chips">
        {service.variants.map(({ variant, row }) => {
          const [tone, label] = stateOf(row);
          const u = usageOf(row);
          const title = `${row.name} · ${label}${row.tools?.length ? ` · ${plural(row.tools.length, 'tool')}` : ''}${u ? ` · ${usageText(u)}` : ''}`;
          return (
            <button key={rowKey(row)} className={`mcp-chip ${tone} ${rowKey(row) === sel ? 'selected' : ''}`} title={title} onClick={() => onPick(rowKey(row))}>
              <span className={`dot ${tone}`} />{variant || label}
            </button>
          );
        })}
      </div>
      {calls > 0 && <span className={`mcp-row-use ${errors ? 'bad' : ''}`}>{plural(calls, 'call')}</span>}
      <button className="icon-btn mcp-row-move" title={isHidden ? 'Show' : 'Hide'} onClick={onHide}><Icon name={isHidden ? 'eye' : 'eye-closed'} small /></button>
      <button className="icon-btn mcp-row-move" title={`Move to ${other === 'work' ? 'Work' : 'Personal'}`} onClick={() => onGroup(other)}><Icon name={other === 'work' ? 'briefcase' : 'home'} small /></button>
    </div>
  );
}

function Detail({ row, usage, group, onGroup, onClose }: { row: Row; usage?: Usage; group: Group; onGroup: (g: Group) => void; onClose: () => void }) {
  const [tone, label] = stateOf(row);
  const [, scope, where] = scopeInfo(row.scope ?? 'other');
  const [q, setQ] = useState('');
  const [run, setRun] = useState<string | null>(null);
  useEffect(() => { setQ(''); setRun(null); }, [row.name]);
  const url = row.command?.startsWith('http');
  const tools = (row.tools ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.description?.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="mcp-detail">
      <div className="mcp-detail-head">
        <span className={`dot ${tone}`} />
        <h2>{row.name}</h2>
        <span className="spacer" />
        <button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" small /></button>
      </div>
      <div className="mcp-detail-acts">
        {row.live && MCP_BAD.includes(row.status) && <button className="btn" onClick={() => send({ type: 'mcp_reconnect', name: row.name })}><Icon name="debug-restart" small /> Reconnect in chat</button>}
        {row.live && row.status === 'disabled' && <button className="btn" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: true })}><Icon name="debug-start" small /> Enable</button>}
        {row.live && row.status !== 'disabled' && <button className="btn" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: false })}><Icon name="circle-slash" small /> Disable for this chat</button>}
        {row.live && row.status === 'connected' && <button className="btn" onClick={() => use(row.name)} title="Ask Claude to use this server in your next message"><Icon name="comment" small /> Add to chat</button>}
        {!row.live && !row.account && <AddToChat name={row.name} />}
        {row.type === 'claudeai' && row.status !== 'needs-auth' && <a className="btn" href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer"><Icon name="key" small /> {row.account && !row.live ? 'Log in on claude.ai' : 'Manage on claude.ai'}</a>}
        {url && <a className="btn" href={row.command} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open URL</a>}
      </div>
      <dl className="mcp-kv">
        <dt>Status</dt><dd className={tone}>{label}{row.version ? <span className="muted mono"> · v{row.version}</span> : null}</dd>
        {row.error && (row.live || row.status !== 'needs-auth') && <><dt>Error</dt><dd className="bad mono wrap">{row.error}</dd></>}
        {row.status === 'needs-auth' && row.type === 'claudeai' && <><dt>Log in</dt><dd><ClaudeAiLogin name={row.name} live={Boolean(row.live)} /></dd></>}
        {row.status === 'needs-auth' && row.type !== 'claudeai' && row.live && <><dt>Log in</dt><dd><Login name={row.name} /></dd></>}
        {row.status === 'needs-auth' && row.type !== 'claudeai' && !row.live && (
          <><dt>Login</dt><dd>Load it in this chat, then log in here.</dd></>
        )}
        {row.command && <><dt>{url ? 'URL' : 'Command'}</dt><dd className="mono wrap">{row.command}</dd></>}
        {row.env && <><dt>Env</dt><dd className="mono wrap">{row.env.join('  ')}</dd></>}
        <dt>From</dt><dd>{scope}{where ? <span className="muted mono"> · {where}</span> : null}</dd>
        <dt>In chat</dt><dd>{row.live ? 'Loaded' : 'Not loaded'}</dd>
        <dt>Group</dt>
        <dd className="mcp-seg">
          {(['work', 'personal'] as Group[]).map((g) => <button key={g} className={`btn ${g === group ? 'on' : ''}`} onClick={() => g !== group && onGroup(g)}>{g === 'work' ? 'Work' : 'Personal'}</button>)}
        </dd>
        {row.account && <><dt>Account</dt><dd>{row.account === 'alt' ? 'Work' : 'Personal'} Claude account</dd></>}
      </dl>
      {usage && (
        <>
          <div className="mcp-tools-head"><span>Used in this chat</span><span className="muted">{usageText(usage)}</span></div>
          <div className="mcp-calls">{[...usage.calls].reverse().map((c) => <CallRow key={c.id} call={c} />)}</div>
        </>
      )}
      <div className="mcp-tools-head">
        <span>Tools</span><span className="muted">{row.tools?.length ?? 0}</span>
        <span className="spacer" />
        {(row.tools?.length ?? 0) > 6 && <input placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />}
      </div>
      <div className="mcp-tools">
        {tools.map((t) => (
          <div key={t.name} className={`mcp-tool ${run === t.name ? 'open' : ''}`}>
            <div className="t"><Icon name="symbol-method" small /><span className="mono">{t.name}</span>{t.readOnly && <span className="chip outline sm mcp-tag ok">read only</span>}{t.destructive && <span className="chip outline sm mcp-tag bad">destructive</span>}<span className="spacer" />{t.inputSchema && runnable(row) && <button className={`icon-btn mcp-insert ${run === t.name ? 'on' : ''}`} title={run === t.name ? 'Close' : 'Run this tool'} onClick={() => setRun((r) => (r === t.name ? null : t.name))}><Icon name={run === t.name ? 'close' : 'play'} small /></button>}{row.live && <button className="icon-btn mcp-insert" title={`Ask Claude to use ${t.name} in your next message`} onClick={() => use(row.name, t.name)}><Icon name="comment" small /></button>}</div>
            {t.description && <div className="d">{t.description}</div>}
            {run === t.name && <RunForm key={`${row.name}:${t.name}`} server={row.name} tool={t} />}
          </div>
        ))}
        {row.tools && row.tools.length > 0 && tools.length === 0 && <div className="muted">No tool matches</div>}
        {!row.tools?.length && <div className="muted">{row.status === 'connected' ? 'No tools reported' : 'Tools appear once it connects'}</div>}
      </div>
    </aside>
  );
}

function CallRow({ call }: { call: Call }) {
  const [open, setOpen] = useState(false);
  const state = !call.result ? 'wait' : call.result.isError ? 'bad' : 'ok';
  return (
    <div className={`mcp-call ${state} ${open ? 'open' : ''}`}>
      <div className="t" {...pressable(() => setOpen((v) => !v))}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} small />
        <span className="mono name">{call.tool}</span>
        <span className="in" title={brief(call.input)}>{brief(call.input)}</span>
        <span className={`s ${state}`}>{state === 'wait' ? 'running' : state === 'bad' ? 'error' : 'ok'}</span>
        <button className="icon-btn mcp-insert" title="Add the result to chat" disabled={!call.result} onClick={(e) => { e.stopPropagation(); void cite(call); }}><Icon name="insert" small /></button>
      </div>
      {open && (
        <div className="r">
          <pre>{JSON.stringify(call.input, null, 2)}</pre>
          {call.result && <pre className={call.result.isError ? 'bad' : ''}>{call.result.text || '(no output)'}</pre>}
        </div>
      )}
    </div>
  );
}

type Out = { text: string; isError: boolean; args: Record<string, unknown> };

function RunForm({ server, tool }: { server: string; tool: McpTool }) {
  const fields = useMemo(() => fieldsOf(tool.inputSchema), [tool]);
  const [values, setValues] = useState(() => initialValues(fields));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [out, setOut] = useState<Out | null>(null);
  const set = (k: string, v: string | boolean) => { setValues((o) => ({ ...o, [k]: v })); setArmed(false); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let args: Record<string, unknown>;
    try { args = argsOf(fields, values); } catch (err) { return setError((err as Error).message); }
    if (tool.destructive && !armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    post('/api/mcp/call', { server, tool: tool.name, args })
      .then((r: Out) => setOut({ text: r.text, isError: r.isError, args }), (err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const lead = (o: Out) => `${toolId(server, tool.name)} run from the MCP tab with ${JSON.stringify(o.args).slice(0, 200)} ${o.isError ? 'failed with' : 'returned'}`;
  const input = (f: Field) => {
    const v = values[f.name];
    const str = typeof v === 'string' ? v : '';
    if (f.kind === 'bool') return <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} />;
    if (f.kind === 'enum') return (
      <select value={str} onChange={(e) => set(f.name, e.target.value)}>
        {!f.required && <option value="">Not set</option>}
        {f.options!.map((o) => <option key={JSON.stringify(o)} value={JSON.stringify(o)}>{String(o)}</option>)}
      </select>
    );
    if (f.kind === 'long' || f.kind === 'json') return <textarea value={str} rows={f.kind === 'json' ? 3 : 4} placeholder={f.kind === 'json' ? 'JSON' : undefined} onChange={(e) => set(f.name, e.target.value)} spellCheck={false} />;
    return <input type={f.kind === 'text' ? 'text' : 'number'} step={f.kind === 'integer' ? 1 : 'any'} value={str} onChange={(e) => set(f.name, e.target.value)} spellCheck={false} />;
  };
  return (
    <form className="mcp-run" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className={`mcp-field ${f.kind === 'bool' ? 'bool' : ''}`}>
          {f.kind === 'bool' && input(f)}
          <span className="k"><span className="mono">{f.name}</span>{f.required && <span className="req" title="Required">*</span>}<span className="ty mono">{f.kind === 'long' ? 'text' : f.kind}</span></span>
          {f.kind !== 'bool' && input(f)}
          {f.description && <span className="d">{f.description}</span>}
        </label>
      ))}
      {!fields.length && <div className="muted">This tool takes no input.</div>}
      <div className="mcp-run-acts">
        <button type="submit" className={armed ? 'btn danger' : 'btn primary'} disabled={busy}>
          <Icon name={busy ? 'loading' : armed ? 'warning' : 'play'} small spin={busy} /> {busy ? 'Running' : armed ? 'Confirm run' : 'Run'}
        </button>
        {armed && <span className="bad">This tool can change or delete data. Click again to run it.</span>}
        {error && <span className="bad">{error}</span>}
      </div>
      {out && (
        <div className="mcp-run-out">
          <pre className={out.isError ? 'bad' : ''}>{out.text || '(no output)'}</pre>
          <button type="button" className="btn" onClick={() => void share(lead(out), out.text, `${slug(server)}-${tool.name}.txt`)}><Icon name="insert" small /> Add result to chat</button>
        </div>
      )}
    </form>
  );
}

const post = (path: string, body?: unknown) =>
  fetch(api(path), { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
    .then((r) => r.json())
    .then((r) => { if (r?.error) throw new Error(r.error); return r; });

function AddToChat({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [name]);
  const add = () => {
    setBusy(true);
    setError('');
    post(`/api/mcp/add?name=${encodeURIComponent(name)}`).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <>
      <button className="btn" onClick={add} disabled={busy}><Icon name={busy ? 'loading' : 'add'} small spin={busy} /> Load in this chat</button>
      {error && <span className="mcp-act-error bad">{error}</span>}
    </>
  );
}

// claude.ai connectors are authorized on claude.ai, for the account this chat runs on; the chat picks them up on reconnect.
function ClaudeAiLogin({ name, live }: { name: string; live: boolean }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(false), [name]);
  return (
    <div className="mcp-login">
      <div className="mcp-login-acts">
        <a className="btn" href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" onClick={() => setOpened(true)}><Icon name="link-external" small /> Connect on claude.ai</a>
        {opened && live && <button className="btn" onClick={() => send({ type: 'mcp_reconnect', name })}><Icon name="debug-restart" small /> Reconnect in chat</button>}
      </div>
      <div className="muted">{opened ? 'Once it says Connected there, reconnect it here.' : 'Sign in with the Claude account this chat uses.'}</div>
    </div>
  );
}

function Login({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setOpened(false); setError(''); }, [name]);
  useEffect(() => {
    if (!opened) return;
    const t = setInterval(() => !document.hidden && send({ type: 'mcp_status' }), 3000);
    return () => clearInterval(t);
  }, [opened]);
  const start = () => {
    setBusy(true);
    setError('');
    post(`/api/mcp/login?name=${encodeURIComponent(name)}`)
      .then((r) => { if (r.authUrl) setOpened(true); else send({ type: 'mcp_status' }); })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="mcp-login">
      <div className="mcp-login-acts">
        <button className="btn" onClick={start} disabled={busy}><Icon name={busy ? 'loading' : 'key'} small spin={busy} /> {opened ? 'Open again' : 'Log in'}</button>
        {opened && <button className="btn" onClick={() => command('tab:browser')}><Icon name="globe" small /> Show browser</button>}
      </div>
      {opened && <div className="muted">The login page is open in Chrome on the Mac. This updates once you finish there.</div>}
      {error && <div className="bad">{error}</div>}
    </div>
  );
}
