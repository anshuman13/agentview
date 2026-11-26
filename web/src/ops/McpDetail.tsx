import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_LABEL, MCP_BAD, type Account } from '../../../shared/protocol';
import { send, useStore } from '../app/store';
import { providerLabel } from '../../../shared/providers';
import { useCan } from '../chat/useCan';
import { Icon } from '../ui/Icon';
import { Button, Chip, IconButton } from '../ui/Button';
import { EmptyState } from '../ui/Panel';
import { Menu, MenuItem } from '../ui/Menu';
import { ServerIcon, StatusCell } from './McpServiceRow';
import { Section } from '../ui/Section';
import { openConnectors, use } from './mcpActions';
import { runnable, scopeInfo, shortName, stateOf, usageText, type Group, type Row, type Usage } from './mcpHelpers';
import { CallRow } from './McpCallRow';
import { AddToChat, ClaudeAiLogin, Login } from './McpLogin';
import { RunForm } from './McpRunForm';

const DOT: Record<string, string> = { done: 'ok', failed: 'bad', waiting: 'warn', skipped: 'off' };

export function Detail({ row, usage, group, onGroup, hidden, onHide, onClose }: { row: Row; usage?: Usage; group: Group; onGroup: (g: Group) => void; hidden: boolean; onHide: () => void; onClose: () => void }) {
  const [status, statusLabel] = stateOf(row);
  const tone = DOT[status];
  const [, scope, where] = scopeInfo(row.scope ?? 'other');
  const label = providerLabel(useStore((s) => s.session.provider));
  const canEdit = useCan('mcpEdit');
  const connectors = useCan('connectors');
  const [q, setQ] = useState('');
  const [run, setRun] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => { setQ(''); setRun(null); }, [row.name]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || e.defaultPrevented || t?.closest('input, textarea, select, [contenteditable]') || document.querySelector('[role=dialog], [role=menu]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const url = row.command?.startsWith('http');
  const tools = (row.tools ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.description?.toLowerCase().includes(q.toLowerCase()));
  return (
    <section className="mcp-detail" aria-label={shortName(row.name)}>
      <Button variant="quiet" size="sm" icon="arrow-left" className="mcp-back" onClick={onClose}>MCP servers</Button>
      <div className="mcp-detail-head">
        <ServerIcon row={row} />
        <h2 className="mcp-detail-name">{shortName(row.name)}</h2>
        <span className="mcp-detail-st"><StatusCell row={row} /></span>
        <span className="spacer" />
        <IconButton ref={more} icon="ellipsis" label="More" size="sm" onClick={() => setMenu((v) => !v)} />
        {menu && (
          <Menu trigger={more} onClose={() => setMenu(false)}>
            <MenuItem icon={hidden ? 'eye' : 'eye-closed'} onClick={() => { setMenu(false); onHide(); }}>{hidden ? 'Show' : 'Hide'}</MenuItem>
            {!row.account && <MenuItem icon="arrow-swap" onClick={() => { setMenu(false); onGroup(group === 'work' ? 'personal' : 'work'); }}>Move to {group === 'work' ? 'Personal' : 'Work'}</MenuItem>}
          </Menu>
        )}
      </div>
      {row.command && <div className="mcp-detail-cmd mono">{row.command}<IconButton icon="copy" label="Copy" size="sm" small onClick={() => void navigator.clipboard.writeText(row.command!)} /></div>}
      <div className="mcp-detail-acts">
        {row.live && MCP_BAD.includes(row.status) && <Button icon="debug-restart" onClick={() => send({ type: 'mcp_reconnect', name: row.name })}>Reconnect in chat</Button>}
        {canEdit && row.live && row.status === 'disabled' && <Button icon="debug-start" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: true })}>Enable</Button>}
        {canEdit && row.live && row.status !== 'disabled' && <Button icon="circle-slash" onClick={() => send({ type: 'mcp_toggle', name: row.name, enabled: false })}>Disable for this chat</Button>}
        {row.live && row.status === 'connected' && <Button icon="comment" onClick={() => use(row.name)} title={`Ask ${label} to use this server in your next message`}>Add to chat</Button>}
        {canEdit && !row.live && !row.account && <AddToChat name={row.name} />}
        {connectors && row.type === 'claudeai' && row.status !== 'needs-auth' && <Button icon="key" onClick={() => openConnectors(row.account)}>Manage on claude.ai</Button>}
        {url && <Button icon="link-external" href={row.command} target="_blank" rel="noreferrer">Open URL</Button>}
      </div>
      {!canEdit && <div className="muted">Edit ~/.codex/config.toml, then Reconnect</div>}
      <dl className="mcp-kv">
        <dt>Status</dt><dd className={tone}>{statusLabel}{row.version ? <span className="muted mono"> · v{row.version}</span> : null}</dd>
        {row.error && (row.live || row.status !== 'needs-auth') && <><dt>Error</dt><dd className="bad mono wrap">{row.error}</dd></>}
        {canEdit && row.status === 'needs-auth' && row.type === 'claudeai' && <><dt>Log in</dt><dd><ClaudeAiLogin name={row.name} live={Boolean(row.live)} account={row.account} /></dd></>}
        {canEdit && row.status === 'needs-auth' && row.type !== 'claudeai' && <><dt>Log in</dt><dd><Login name={row.name} live={Boolean(row.live)} /></dd></>}
        {row.env && <><dt>Env</dt><dd className="mono wrap">{row.env.join('  ')}</dd></>}
        <dt>From</dt><dd>{scope}{where ? <span className="muted mono"> · {where}</span> : null}</dd>
        <dt>In chat</dt><dd>{row.live ? 'Loaded' : 'Not loaded'}</dd>
        {row.account ? <><dt>Account</dt><dd>{ACCOUNT_LABEL[row.account as Account] ?? row.account} Claude account</dd></> : <>
          <dt>Group</dt>
          <dd className="mcp-seg">
            {(['work', 'personal'] as Group[]).map((g) => <Chip key={g} on={g === group} onClick={() => g !== group && onGroup(g)}>{g === 'work' ? 'Work' : 'Personal'}</Chip>)}
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
            <div className="t"><Icon name="symbol-method" small /><span className="mono">{t.name}</span>{t.readOnly && <span className="chip sm mcp-tag st-ok">read only</span>}{t.destructive && <span className="chip sm mcp-tag st-warn">destructive</span>}<span className="spacer" />{t.inputSchema && runnable(row) && <IconButton icon={run === t.name ? 'close' : 'play'} small className="mcp-insert" on={run === t.name} label={run === t.name ? 'Close' : 'Run this tool'} onClick={() => setRun((r) => (r === t.name ? null : t.name))} />}{row.live && <IconButton icon="comment" small className="mcp-insert" label="Add to chat" title={`Ask ${label} to use ${t.name} in your next message`} onClick={() => use(row.name, t.name)} />}</div>
            {t.description && <div className="d">{t.description}</div>}
            {run === t.name && <RunForm key={`${row.name}:${t.name}`} server={row.name} tool={t} />}
          </div>
        ))}
        {row.tools && row.tools.length > 0 && tools.length === 0 && <EmptyState size="sm" title="No tool matches" />}
        {!row.tools?.length && <EmptyState size="sm" title={row.status === 'connected' ? 'No tools reported' : 'No tools yet'} hint={row.status === 'connected' ? undefined : row.status === 'needs-auth' ? 'Log in to load them' : 'They load once the server connects'} />}
      </div>
    </section>
  );
}
