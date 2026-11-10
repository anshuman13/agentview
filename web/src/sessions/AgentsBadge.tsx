import { useCounts } from '../app/store/counts';

export function AgentsBadge() {
  const { agents } = useCounts();
  return agents > 0 ? <span className="dot running" role="img" aria-label={`${agents} running`} /> : null;
}
