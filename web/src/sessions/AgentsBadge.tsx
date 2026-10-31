import { useStore } from '../app/store';
import { agentCounts, agentsOf } from './agents';

export function AgentsBadge() {
  const running = agentCounts(useStore((s) => agentsOf(s.events))).running;
  return running > 0 ? <span className="dot running" role="img" aria-label={`${running} running`} /> : null;
}
