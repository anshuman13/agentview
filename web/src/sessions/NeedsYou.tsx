import { useState, type ReactNode } from 'react';
import { api, notice, send, useStore } from '../app/store';
import { Icon } from '../ui/Icon';
import { ATTENTION_LABEL, type AttentionItem } from '../../../shared/protocol';
import { ago, pressable } from '../ui/util';
import { PullState, usePullRequests } from '../ops/pulls';

const PR_KINDS = new Set<AttentionItem['kind']>(['review', 'ci', 'changes', 'ready', 'stale']);
const ATTENTION_ICON: Record<AttentionItem['kind'], string> = { ci: 'error', changes: 'request-changes', review: 'eye', ready: 'check', issue: 'issues', stale: 'history', commit: 'git-commit', deploy: 'rocket' };

// Chats waiting on the user plus GitHub items the server flagged (failing CI, reviews, assigned issues).
export function NeedsYou({ n, children }: { n: number; children: ReactNode }) {
  const items = useStore((s) => s.attention);
  const cwd = useStore((s) => s.session.cwd);
  const live = useStore((s) => s.live);
  const prs = usePullRequests(cwd);
  const [busy, setBusy] = useState<string | null>(null);
  if (n + items.length === 0) return null;
  const pullOf = (it: AttentionItem) => (it.cwd === cwd && PR_KINDS.has(it.kind) ? prs.find((p) => p.number === it.number) : undefined);
  const post = (path: string, id: string) => fetch(api(path), { method: 'POST', body: JSON.stringify({ id }) }).then((r) => r.json());
  const ask = async (it: AttentionItem) => {
    setBusy(it.id);
    try {
      const r = await post('/api/attention/ask', it.id);
      if (r.error) notice(r.error);
      else send({ type: 'view', id: r.id });
    } catch {
      notice('Could not ask Claude');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="tree needs">
      <div className="group">Needs you <span className="badge waiting">{n + items.length}</span></div>
      {children}
      {items.map((it) => (
        <div key={it.id} className={`row session live two ${busy === it.id ? 'removing' : ''}`} title={`${ATTENTION_LABEL[it.kind]}\n${it.title}\n${it.url}`} {...pressable(() => { const id = it.chatId ?? it.fixing; id ? send({ type: 'view', id }) : window.open(it.url, '_blank'); })}>
          <span className={`state ${it.kind}`}><Icon name={ATTENTION_ICON[it.kind]} small /></span>
          <span className="lines">
            <span className="l1">
              <span className="repo">{it.repo}</span>
              <span className="name">{it.number ? `#${it.number} ` : ''}{it.title}</span>
              <span className="when">{ago(it.since)}</span>
            </span>
            <span className="l2">
              <span className="sub">{ATTENTION_LABEL[it.kind]}</span>
              {pullOf(it) && <PullState pr={pullOf(it)!} />}
              {it.fixing && <span className="sub fixing">Fixing in {live.find((c) => c.id === it.fixing)?.title ?? 'a chat'}</span>}
            </span>
          </span>
          <span className="acts">
            <button className="icon-btn" title="Ask Claude to handle this" onClick={(e) => { e.stopPropagation(); void ask(it); }}><Icon name="sparkle" small /></button>
            <button className="icon-btn" title="Dismiss until it changes" onClick={(e) => { e.stopPropagation(); post('/api/attention/dismiss', it.id).catch(() => notice('Could not dismiss. It stays in Needs you.')); }}><Icon name="close" small /></button>
          </span>
        </div>
      ))}
    </div>
  );
}
