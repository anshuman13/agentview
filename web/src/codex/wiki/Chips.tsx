import { Icon } from '../../ui/Icon';
import { safeHref } from '../../ui/util';
import type { Source } from '../data/wiki';
import { SOURCE_ICON } from './shared';

export function SourceChip({ s }: { s: Source }) {
  const body = <><Icon name={SOURCE_ICON[s.kind]} small /> <span className="wk-src-text">{s.label}</span></>;
  return s.url ? <a className="wk-src" href={safeHref(s.url)} target="_blank" rel="noreferrer">{body}</a> : <span className="wk-src">{body}</span>;
}

export function ClaudeChip({ chat }: { chat: string }) {
  return <a className="wk-src" href={`/?session=${encodeURIComponent(chat)}`} title="Open the chat that proposed this"><Icon name="sparkle" small /> Claude</a>;
}
