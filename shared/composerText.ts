export type PlaceholderState = 'waiting' | 'compacting' | 'running' | 'uses' | 'idle';
export type PlaceholderDevice = 'desktop' | 'touch' | 'narrow' | 'phone';

// The composer's empty-field hint on web and the phone; `narrow` is the web pill composer, whose texts fit one line at 390px. shared/fixtures/composer-placeholder.json holds the cases.
// `talk` is whether the round button can dictate; the narrow and phone idle hint then offers it.
export function composerPlaceholder(label: string, state: PlaceholderState, device: PlaceholderDevice, talk = true) {
  if (state === 'idle' && talk && (device === 'narrow' || device === 'phone')) return `Reply to ${label} or hold to talk`;
  if (device === 'narrow') {
    switch (state) {
      case 'waiting': return 'Answer above or send to stop';
      case 'compacting': return 'Sends after compacting';
      case 'running': return `${label} reads this next`;
      case 'uses': return `What should ${label} do?`;
      case 'idle': return 'Ask · / commands · @ files';
    }
  }
  switch (state) {
    case 'waiting': return `Answer above, or message ${label} to stop and send`;
    case 'compacting': return 'Sends when compacting is done';
    case 'running':
      if (device === 'touch') return `${label} reads this next · hold Send to stop`;
      return `${label} reads this at its next step${device === 'desktop' ? ' · ⌘Enter stops and sends' : ''}`;
    case 'uses': return `What should ${label} do with it?`;
    case 'idle': return 'Ask anything · / commands · @ files · @chat: chats';
  }
}

const SHELLS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

// The command of a one-line shell block in a reply, without a leading "$ " prompt; shared/fixtures/shell-line.json holds the cases.
export function shellLine(lang: string | null | undefined, code: string): string | null {
  if (!SHELLS.has((lang ?? '').trim().split(/\s+/)[0].toLowerCase())) return null;
  const lines = code.trim().split('\n');
  const cmd = lines.length === 1 ? lines[0].replace(/^\$(\s+|$)/, '').trim() : '';
  return cmd && !/[\x00-\x08\x0a-\x1f\x7f]/.test(cmd) ? cmd : null;
}

const QUOTE_MAX = 1500;

// A selected passage of a reply as a Markdown quote for the composer, ending in a blank line.
export function quoteText(text: string) {
  let body = text.trim();
  if (body.length > QUOTE_MAX) body = `${body.slice(0, QUOTE_MAX + 1).replace(/\s+\S*$/, '').slice(0, QUOTE_MAX)} ...`;
  return `${body.split('\n').map((l) => (l.trim() ? `> ${l}` : '>')).join('\n')}\n\n`;
}
