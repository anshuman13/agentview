import { Icon } from '../../ui/Icon';
import { Chip } from '../../ui/Button';
import { safeHref } from '../../ui/util';
import type { Source } from '../data/wiki/wiki';
import { SOURCE_ICON } from './shared';

export const KIND: Record<Source['kind'], string> = { slack: 'Slack', linear: 'Linear', pr: 'PR', doc: 'Doc', meeting: 'Meeting', chat: 'Chat' };

export function SourceChip({ s }: { s: Source }) {
  const href = safeHref(s.url);
  const name = KIND[s.kind];
  const label = `${name}: ${s.label}`;
  if (href) return <Chip size="sm" quiet icon={SOURCE_ICON[s.kind]} href={href} target="_blank" rel="noopener noreferrer" title={s.label} aria-label={label}>{name}</Chip>;
  return <span className="chip" title={s.label} aria-label={label}><Icon name={SOURCE_ICON[s.kind]} small /> {name}</span>;
}

export function ClaudeChip({ chat }: { chat: string }) {
  return <a className="wk-src" href={`/?session=${encodeURIComponent(chat)}`} title="Open the chat that proposed this"><Icon name="sparkle" small /> Chat</a>;
}
