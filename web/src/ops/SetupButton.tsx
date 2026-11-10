import { useStore } from '../app/store';
import { Button } from '../ui/Button';
import { askChat } from '../ui/util';
import { providerLabel } from '../../../shared/providers';
import { setupPrompt, type SetupKind } from '../../../shared/setupPrompt';

// The one action of a setup empty state: asks the chat on screen to do the setup.
export function SetupButton({ kind, repo, mcpCommand = '' }: { kind: SetupKind; repo?: string; mcpCommand?: string }) {
  const provider = useStore((s) => s.session.provider);
  const cwd = useStore((s) => s.session.cwd);
  return <Button variant="filled" size="sm" onClick={() => askChat(setupPrompt(kind, repo ?? cwd.split('/').pop() ?? '', mcpCommand))}>Set up with {providerLabel(provider)}</Button>;
}
