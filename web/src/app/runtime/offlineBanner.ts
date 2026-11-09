export type OfflineState = 'hidden' | 'pending' | 'shown';
export type OfflineEvent = 'down' | 'up' | 'elapsed';

export const OFFLINE_DELAY_MS = 2000;

export function offlineBanner(state: OfflineState, event: OfflineEvent): OfflineState {
  if (event === 'up') return 'hidden';
  if (event === 'down') return state === 'hidden' ? 'pending' : state;
  return state === 'pending' ? 'shown' : state;
}
