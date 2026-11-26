import { useStore } from '../app/store';
import { Button } from '../ui/Button';
import { askChat } from '../chat/chatActions';
import { providerLabel } from '../../../shared/providers';
import { setupPrompt, type SetupKind } from '../../../shared/setupPrompt';

// The one action of a setup empty state: asks the chat on screen to do the setup.
export function SetupButton({ kind, repo, mcpCommand = '', label }: { kind: SetupKind; repo?: string; mcpCommand?: string; label?: string }) {
  const provider = useStore((s) => s.session.provider);
  const cwd = useStore((s) => s.session.cwd);
  return <Button variant="filled" size="sm" icon={label ? 'add' : undefined} title={label ? `Ask ${providerLabel(provider)} to set it up` : undefined} onClick={() => askChat(setupPrompt(kind, repo ?? cwd.split('/').pop() ?? '', mcpCommand))}>{label ?? `Set up with ${providerLabel(provider)}`}</Button>;
}
