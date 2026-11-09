import { useEffect, useState } from 'react';
import { ACCOUNT_LABEL, MCP_BAD, type Account } from '../../../shared/protocol';
import { send, useStore } from '../app/store';
import { providerLabel } from '../../../shared/providers';
import { useCan } from '../chat/useCan';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Section } from '../ui/Section';
import { openConnectors, use } from './mcpActions';
import { runnable, scopeInfo, shortName, stateOf, usageText, type Group, type Row, type Usage } from './mcpHelpers';
import { CallRow } from './McpCallRow';
import { AddToChat, ClaudeAiLogin, Login } from './McpLogin';
import { RunForm } from './McpRunForm';

const DOT: Record<string, string> = { done: 'ok', failed: 'bad', waiting: 'warn', skipped: 'off' };

export function Detail({ row, usage, group, onGroup, onClose }: { row: Row; usage?: Usage; group: Group; onGroup: (g: Group) => void; onClose: () => void }) {
  const [status, statusLabel] = stateOf(row);
  const tone = DOT[status];
  const [, scope, where] = scopeInfo(row.scope ?? 'other');
  const label = providerLabel(useStore((s) => s.session.provider));
  const canEdit = useCan('mcpEdit');
  const connectors = useCan('connectors');
  const [q, setQ] = useState('');
  const [run, setRun] = useState<string | null>(null);
  useEffect(() => { setQ(''); setRun(null); }, [row.name]);
  const url = row.command?.startsWith('http');
  const tools = (row.tools ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.description?.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="mcp-detail">
      <Section
        label={
          <>
            <span className={`dot ${tone}`} />
            <span className="mcp-detail-name">{shortName(row.name)}</span>
          </>
        }
        action={<IconButton icon="close" label="Close" size="sm" small onClick={onClose} />}
      />
      <div className="mcp-detail-acts">
        {row.live && MCP_BAD.includes(row.status) && <button className="btn" onClick={() => send({ type: 'mcp_reconnect', name: row.name })}><Icon name="debug-restart" small /> Reconnect in chat</button>}
        {canEdit && row.live && row.status === 'disabled' && <button className="btn" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: true })}><Icon name="debug-start" small /> Enable</button>}
        {canEdit && row.live && row.status !== 'disabled' && <button className="btn" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: false })}><Icon name="circle-slash" small /> Disable for this chat</button>}
        {row.live && row.status === 'connected' && <button className="btn" onClick={() => use(row.name)} title={`Ask ${label} to use this server in your next message`}><Icon name="comment" small /> Add to chat</button>}
        {canEdit && !row.live && !row.account && <AddToChat name={row.name} />}
        {connectors && row.type === 'claudeai' && row.status !== 'needs-auth' && <button className="btn" onClick={() => openConnectors(row.account)}><Icon name="key" small /> Manage on claude.ai</button>}
        {url && <a className="btn" href={row.command} target="_blank" rel="noreferrer"><Icon name="link-external" small /> Open URL</a>}
      </div>
      {!canEdit && <div className="muted">Edit ~/.codex/config.toml, then Reconnect</div>}
      <dl className="mcp-kv">
        <dt>Status</dt><dd className={tone}>{statusLabel}{row.version ? <span className="muted mono"> · v{row.version}</span> : null}</dd>
        {row.error && (row.live || row.status !== 'needs-auth') && <><dt>Error</dt><dd className="bad mono wrap">{row.error}</dd></>}
        {canEdit && row.status === 'needs-auth' && row.type === 'claudeai' && <><dt>Log in</dt><dd><ClaudeAiLogin name={row.name} live={Boolean(row.live)} account={row.account} /></dd></>}
        {canEdit && row.status === 'needs-auth' && row.type !== 'claudeai' && <><dt>Log in</dt><dd><Login name={row.name} live={Boolean(row.live)} /></dd></>}
        {row.command && <><dt>{url ? 'URL' : 'Command'}</dt><dd className="mono wrap">{row.command}</dd></>}
        {row.env && <><dt>Env</dt><dd className="mono wrap">{row.env.join('  ')}</dd></>}
        <dt>From</dt><dd>{scope}{where ? <span className="muted mono"> · {where}</span> : null}</dd>
        <dt>In chat</dt><dd>{row.live ? 'Loaded' : 'Not loaded'}</dd>
        {row.account ? <><dt>Account</dt><dd>{ACCOUNT_LABEL[row.account as Account] ?? row.account} Claude account</dd></> : <>
          <dt>Group</dt>
          <dd className="mcp-seg">
            {(['work', 'personal'] as Group[]).map((g) => <button key={g} className={`btn ${g === group ? 'on' : ''}`} onClick={() => g !== group && onGroup(g)}>{g === 'work' ? 'Work' : 'Personal'}</button>)}
          </dd>
        </>}
      </dl>
      {usage && (
        <>
          <Section label="Used in this chat" count={usageText(usage)} />
          <div className="mcp-calls">{[...usage.calls].reverse().map((c) => <CallRow key={c.id} call={c} />)}</div>
        </>
      )}
      <div className="mcp-tools">
        <Section
          label="Tools"
          count={row.tools?.length ?? 0}
          action={(row.tools?.length ?? 0) > 6 && <input placeholder="Filter" aria-label="Filter tools" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />}
        />
        {tools.map((t) => (
          <div key={t.name} className={`mcp-tool ${run === t.name ? 'open' : ''}`}>
            <div className="t"><Icon name="symbol-method" small /><span className="mono">{t.name}</span>{t.readOnly && <span className="chip sm mcp-tag st-ok">read only</span>}{t.destructive && <span className="chip sm mcp-tag st-warn">destructive</span>}<span className="spacer" />{t.inputSchema && runnable(row) && <button className={`icon-btn mcp-insert ${run === t.name ? 'on' : ''}`} title={run === t.name ? 'Close' : 'Run this tool'} onClick={() => setRun((r) => (r === t.name ? null : t.name))}><Icon name={run === t.name ? 'close' : 'play'} small /></button>}{row.live && <button className="icon-btn mcp-insert" title={`Ask ${label} to use ${t.name} in your next message`} onClick={() => use(row.name, t.name)}><Icon name="comment" small /></button>}</div>
            {t.description && <div className="d">{t.description}</div>}
            {run === t.name && <RunForm key={`${row.name}:${t.name}`} server={row.name} tool={t} />}
          </div>
        ))}
        {row.tools && row.tools.length > 0 && tools.length === 0 && <EmptyState size="sm" title="No tool matches" />}
        {!row.tools?.length && <EmptyState size="sm" title={row.status === 'connected' ? 'No tools reported' : 'No tools yet'} hint={row.status === 'connected' ? undefined : row.status === 'needs-auth' ? 'Log in to load them' : 'They load once the server connects'} />}
      </div>
    </aside>
  );
}
