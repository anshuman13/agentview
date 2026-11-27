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
