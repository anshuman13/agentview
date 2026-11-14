import { useEffect, useState } from 'react';
import { send, useStore } from '../store';
import { ACCOUNT_LABEL } from '../../../../shared/protocol';
import { billing, providerLabel } from '../../../../shared/providers';
import { Icon } from '../../ui/Icon';
import { command, spendLines, weekPace } from '../../ui/util';
import { OFFLINE_DELAY_MS, offlineBanner, type OfflineState } from '../runtime/offlineBanner';
import { mcpDot, useCounts } from '../store/counts';
import { Badge } from '../../ui/Badge';

export function Restarting() {
  const restarting = useStore((s) => s.ui.restarting && s.ui.connected);
  const busy = useStore((s) => s.live.filter((c) => c.running || c.agents).length);
  const agents = useStore((s) => s.live.reduce((n, c) => n + (c.agents ?? 0), 0));
  if (!restarting) return null;
  return (
    <div className="app-update">
      <Icon name="debug-restart" small />
      <span>Restarting AgentView when {busy > 1 ? `${busy} chats finish` : 'the agent finishes'}</span>
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
  const [state, setState] = useState<OfflineState>('hidden');
  useEffect(() => {
    if (connected) {
      setState((s) => offlineBanner(s, 'up'));
      return;
    }
    setState((s) => offlineBanner(s, 'down'));
    const t = setTimeout(() => setState((s) => offlineBanner(s, 'elapsed')), OFFLINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [connected]);
  if (connected || state !== 'shown') return null;
  return (
    <div className="offline-badge mobile-only">
      <span role="status"><Badge status="waiting" reason={restarting ? 'Restarting' : 'Offline and reconnecting'} /></span>
    </div>
  );
}

export function McpItem() {
  const { mcp } = useCounts();
  return (
    <button className="item clickable" title="MCP servers" onClick={() => command('page:mcp')}>
      <span className={`dot ${mcpDot(mcp)}`} /> MCP {mcp.total ? `${mcp.connected}/${mcp.total}` : ''}
    </button>
  );
}

export function RunsItem() {
  const { running, waiting } = useCounts();
  if (!running && !waiting) return null;
  return (
    <button className="item clickable" title="Loops and goals" onClick={() => command('view:chats')}>
      <Icon name="sync" small /> {running} running{waiting > 0 && <span className="warn"> · {waiting} need you</span>}
    </button>
  );
}

export function useUsage() {
  const usage = useStore((s) => s.session.usage);
  const running = useStore((s) => s.session.running);
  const account = useStore((s) => s.session.account) ?? 'main';
  const accounts = useStore((s) => s.session.accounts) ?? [];
  const live = useStore((s) => s.live);
  const models = useStore((s) => s.session.models);
  const provider = useStore((s) => s.session.provider);
  if (!usage) return null;
  const { fiveHour, week } = usage;
  const at = (t: number | null) => (t ? new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown');
  const pace = week?.resetsAt ? weekPace(week.resetsAt) : null;
  const ahead = week && pace !== null && week.pct > pace;
  const other = accounts.find((a) => a !== account);
  const advice = ahead && accounts.length > 1 && other ? `Ahead of pace: switch this chat to ${ACCOUNT_LABEL[other]}` : null;
  const title = [
    `${providerLabel(provider)} plan usage${accounts.length > 1 ? ` on the ${ACCOUNT_LABEL[account]} account` : ''}`,
    fiveHour && `5-hour: ${fiveHour.pct}% used, resets ${at(fiveHour.resetsAt)}`,
    week && `Week: ${week.pct}% used, resets ${at(week.resetsAt)}`,
    pace !== null && `Even pace (100/7 a day): ${pace}% by now`,
    advice && (running ? `${advice} once ${providerLabel(provider)} stops` : `${advice}. Click to switch`),
    !(ahead && other && !running) && `Click to read usage again (needs an open ${providerLabel(provider)} process)`,
  ].filter(Boolean).concat(spendLines(live.map((c) => c.spend), models, live.some((c) => billing(c.provider) !== 'usd'))).join('\n');
  const warn = ahead || Math.max(fiveHour?.pct ?? 0, week?.pct ?? 0) >= 80;
  const label = `${accounts.length > 1 ? `${ACCOUNT_LABEL[account]} ` : ''}${[week && `w${week.pct}`, fiveHour && `h${fiveHour.pct}`].filter(Boolean).join(' ')}`;
  const onClick = () => send(ahead && other && !running ? { type: 'set_account', account: other } : { type: 'usage' });
  return { title, warn, label, onClick, week: week?.pct ?? null, fiveHour: fiveHour?.pct ?? null, account: accounts.length > 1 ? ACCOUNT_LABEL[account] : null };
}

export function UsageItem() {
  const usage = useUsage();
  if (!usage) return null;
  return (
    <button className={`item clickable${usage.warn ? ' warn' : ''}`} title={usage.title} onClick={usage.onClick}>
      <Icon name="pulse" small />
      {usage.label}
    </button>
  );
}

export function CacheItem() {
  const cache = useStore((s) => s.session.cache);
  const [now, setNow] = useState(Date.now());
  const live = Boolean(cache) && cache!.at + cache!.ttlMs > now;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => !document.hidden && setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
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
