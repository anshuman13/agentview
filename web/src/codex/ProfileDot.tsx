import type { Profile } from './data/sync';
import { useView } from './view';

export function ProfileDot({ profile }: { profile: Profile }) {
  const { filter } = useView();
  if (filter !== 'all') return null;
  const label = profile === 'work' ? 'Work' : 'Personal';
  return <span className={`prof-dot ${profile}`} title={label} aria-label={label} role="img" />;
}
