export type PlaceholderState = 'waiting' | 'compacting' | 'running' | 'uses' | 'idle';
export type PlaceholderDevice = 'desktop' | 'touch' | 'phone';

// The composer's empty-field hint on web and the phone; shared/fixtures/composer-placeholder.json holds the cases.
export function composerPlaceholder(label: string, state: PlaceholderState, device: PlaceholderDevice) {
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
