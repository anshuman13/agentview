const MIN_MS = 1500;

const ERRORS: Record<string, (mac: boolean) => string> = {
  'not-allowed': () => 'Microphone blocked. Allow it in the site settings',
  'service-not-allowed': (mac) => (mac ? 'Turn on Dictation in System Settings > Keyboard' : 'Speech recognition is not allowed here'),
  'no-speech': () => 'No speech heard',
  network: () => 'Speech service unreachable',
  'audio-capture': () => 'No microphone found',
  'language-not-supported': () => 'Speech recognition does not support this language',
};

export function voiceEnded({ error, heard, ms, mac, stopped }: { error: string | null; heard: boolean; ms: number; mac: boolean; stopped: boolean }): string {
  if (heard) return '';
  if (error === 'aborted') return stopped ? '' : 'Voice input was interrupted';
  if (error) return ERRORS[error]?.(mac) ?? `Voice input failed (${error})`;
  if (ms >= MIN_MS) return 'No speech heard';
  if (stopped) return '';
  return mac
    ? 'Voice input stopped right away - Allow Microphone and Speech Recognition for AgentView in System Settings > Privacy & Security'
    : 'Voice input stopped right away';
}
