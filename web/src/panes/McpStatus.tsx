import { useEffect, useState } from 'react';
import { MCP_BAD, type McpConfigEntry } from '../../../shared/protocol';
import { api, send, useStore } from '../store';
import { Icon } from '../Icon';
import '../mcp.css';

const dot = (status: string) => (status === 'connected' ? 'ok' : MCP_BAD.includes(status) ? 'bad' : status === 'pending' ? 'wait' : 'off');

export function McpItem() {
  const mcp = useStore((s) => s.session.mcp);
  const [open, setOpen] = useState(false);
  const ok = mcp.filter((m) => m.status === 'connected').length;
  const bad = mcp.some((m) => MCP_BAD.includes(m.status));
  return (
    <>
      <span className="item clickable" title="MCP servers" onClick={() => setOpen((v) => !v)}>
        {bad && <span className="mcp-dot bad" />} MCP {mcp.length ? `${ok}/${mcp.length}` : ''}
      </span>
      {open && <McpStatus onClose={() => setOpen(false)} />}
    </>
  );
}

function McpStatus({ onClose }: { onClose: () => void }) {
  const mcp = useStore((s) => s.session.mcp);
  const id = useStore((s) => s.session.id);
  const live = useStore((s) => s.live);
  const [config, setConfig] = useState<McpConfigEntry[]>([]);

  useEffect(() => {
    send({ type: 'mcp_status' });
    fetch(api('/api/mcp/config')).then((r) => r.json()).then((c) => Array.isArray(c) && setConfig(c), () => {});
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = [...mcp, ...config.filter((c) => !mcp.some((m) => m.name === c.name)).map((c) => ({ name: c.name, status: 'not loaded', tools: undefined, error: undefined }))];

  return (
    <div className="overlay mcp-overlay" onClick={onClose}>
      <div className="switcher mcp" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-head">
          <span>MCP servers</span>
          <span className="spacer" />
          <button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mcp-list">
          {rows.length === 0 && <div className="mcp-empty muted small">No MCP servers reported yet. Status appears once Claude starts in this chat.</div>}
          {rows.map((m) => {
            const conf = config.find((c) => c.name === m.name);
            return (
              <div key={m.name} className="mcp-row">
                <div className="mcp-line">
                  <span className={`mcp-dot ${dot(m.status)}`} />
                  <span className="mcp-name">{m.name}</span>
                  <span className="muted small">{m.status}</span>
                  <span className="spacer" />
                  {m.tools !== undefined && <span className="muted small">{m.tools} tools</span>}
                  <span className="muted small">{conf ? `${conf.type} · ${conf.scope}` : 'plugin or claude.ai'}</span>
                  {MCP_BAD.includes(m.status) && <button className="link small" onClick={() => send({ type: 'mcp_reconnect', name: m.name })}>Reconnect</button>}
                </div>
                {m.status === 'needs-auth' && <div className="mcp-note small">Run /mcp in a terminal in this folder to log in</div>}
                {m.error && <div className="mcp-note small error-text">{m.error}</div>}
              </div>
            );
          })}
        </div>
        <div className="mcp-head">All chats</div>
        <div className="mcp-list">
          {live.map((c) => (
            <div key={c.id} className={`mcp-line mcp-chat ${c.id === id ? 'current' : ''}`} onClick={() => send({ type: 'view', id: c.id })}>
              <span className={`mcp-dot ${c.mcpFailed ? 'bad' : 'ok'}`} />
              <span className="mcp-name">{c.cwd.split('/').pop()}</span>
              <span className="muted small mcp-title">{c.title}</span>
              <span className="spacer" />
              <span className={`small ${c.mcpFailed ? 'error-text' : 'muted'}`}>{c.mcpFailed ? `${c.mcpFailed} failed` : 'OK'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
