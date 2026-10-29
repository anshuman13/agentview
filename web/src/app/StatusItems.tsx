import { useEffect, useState } from 'react';
import { apiUrl, bundled, useApiBase } from './api';
import { send, useStore } from './store';
import { ACCOUNT_LABEL, MCP_BAD } from '../../../shared/protocol';
import { Icon } from '../ui/Icon';
import { command, weekPace } from '../ui/util';
import { useShownMcp } from '../ops/mcpShown';

export function AppUpdate() {
  const [ready, setReady] = useState(0);
  const base = useApiBase();
  useEffect(() => {
    const own = bundled ? fetch('build.txt').then((r) => (r.ok ? r.text() : '')).then(Number).catch(() => 0) : Promise.resolve(Number(localStorage.getItem('agentview.shell')) || (/; wv\)/.test(navigator.userAgent) ? 1 : 0));
    const later = Number(localStorage.getItem('agentview.shell.later'));
    void own.then((shell) => (shell ? fetch(apiUrl('/api/app')).then((r) => r.json()).then((a) => setReady(a.build > shell && a.build > later ? a.build : 0)).catch(() => {}) : undefined));
  }, [base]);
  if (!ready) return null;
  return (
    <div className="app-update">
      <Icon name="cloud-download" small />
      <span>A new version of the app is ready</span>
      <a href={apiUrl('/api/app.apk')}>Install</a>
      <button className="icon-btn" title="Later" onClick={() => { localStorage.setItem('agentview.shell.later', String(ready)); setReady(0); }}><Icon name="close" small /></button>
    </div>
  );
}

export function Restarting() {
  const restarting = useStore((s) => s.ui.restarting && s.ui.connected);
  const busy = useStore((s) => s.live.filter((c) => c.running || c.agents).length);
  const agents = useStore((s) => s.live.reduce((n, c) => n + (c.agents ?? 0), 0));
  if (!restarting) return null;
  return (
    <div className="app-update">
      <Icon name="debug-restart" small />
      <span>Restarting AgentView when {busy > 1 ? `${busy} chats finish` : 'Claude finishes'}</span>
      <a href="#" onClick={(e) => {
        e.preventDefault();
        if (busy && !confirm(`Restart now? This stops ${agents ? `${agents} background agent${agents > 1 ? 's' : ''} and ` : ''}any running turn.`)) return;
        send({ type: 'restart', now: true });
      }}>Restart now</a>
    </div>
  );
}

export function Offline() {
  const connected = useStore((s) => s.ui.connected);
  const restarting = useStore((s) => s.ui.restarting);
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (connected) return;
    const t = setTimeout(() => setLate(true), 2000);
    return () => clearTimeout(t);
  }, [connected]);
  if (connected || !late) return null;
  return (
    <div className="app-update offline mobile-only">
      <Icon name="plug" small />
      <span>{restarting ? 'AgentView is restarting' : 'Disconnected from the Mac, reconnecting'}</span>
    </div>
  );
}

export function McpItem() {
  const mcp = useShownMcp();
  const ok = mcp.filter((m) => m.status === 'connected').length;
  const bad = mcp.some((m) => MCP_BAD.includes(m.status));
  return (
    <button className="item clickable" title="MCP servers" onClick={() => command('page:mcp')}>
      <span className={`dot ${bad ? 'bad' : ok ? 'ok' : 'off'}`} /> MCP {mcp.length ? `${ok}/${mcp.length}` : ''}
    </button>
  );
}

export function UsageItem() {
  const usage = useStore((s) => s.session.usage);
  const running = useStore((s) => s.session.running);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  if (!usage) return null;
  const { fiveHour, week } = usage;
  const at = (t: number | null) => (t ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown');
  const pace = week?.resetsAt ? weekPace(week.resetsAt) : null;
  const ahead = week && pace !== null && week.pct > pace;
  const other = accounts.find((a) => a !== account);
  const advice = ahead ? (other ? `Ahead of pace: switch this chat to ${ACCOUNT_LABEL[other]}` : 'Ahead of pace: slow down or add a second account') : null;
  const title = [
    `Claude plan usage${accounts.length > 1 ? ` on the ${ACCOUNT_LABEL[account]} account` : ''}`,
    fiveHour && `5-hour: ${fiveHour.pct}% used, resets ${at(fiveHour.resetsAt)}`,
    week && `Week: ${week.pct}% used, resets ${at(week.resetsAt)}`,
    pace !== null && `Even pace (100/7 a day): ${pace}% by now`,
    advice && (other && running ? `${advice} once Claude stops` : other ? `${advice}. Click to switch` : advice),
  ].filter(Boolean).join('\n');
  const warn = ahead || Math.max(fiveHour?.pct ?? 0, week?.pct ?? 0) >= 80;
  const body = (
    <>
      <Icon name="pulse" small />
      {accounts.length > 1 && `${ACCOUNT_LABEL[account]} `}
      {[week && `w${week.pct}`, fiveHour && `h${fiveHour.pct}`].filter(Boolean).join(' ')}
    </>
  );
  return ahead && other && !running ? (
    <button className={`item clickable${warn ? ' warn' : ''}`} title={title} onClick={() => send({ type: 'set_account', account: other })}>{body}</button>
  ) : (
    <span className={`item${warn ? ' warn' : ''}`} title={title}>{body}</span>
  );
}

export function CacheItem() {
  const cache = useStore((s) => s.session.cache);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!cache) return null;
  const expires = cache.at + cache.ttlMs;
  const left = Math.max(0, Math.round((expires - now) / 1000));
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const title = `Prompt cache (${cache.ttlMs >= 3_600_000 ? '1h' : '5m'} TTL) ${left ? 'expires' : 'expired'} at ${new Date(expires).toLocaleTimeString()}. Last request read ${k(cache.readTokens)} cached tokens, wrote ${k(cache.writeTokens)}.`;
  return (
    <span className={`item ${left ? '' : 'muted'}`} title={title}>
      <Icon name="database" small /> {left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Expired'}
    </span>
  );
}
