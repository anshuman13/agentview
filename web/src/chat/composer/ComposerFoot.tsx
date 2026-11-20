import { useRef } from 'react';
import { send, useStore } from '../../app/store';
import { Chip, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useChatSettings, type Pick } from '../ChatSettings';
import { useCan } from '../useCan';
import { Voice, type useDictation } from './Voice';
import type { Use } from './composerLogic';
import { providerLabel, shortModel } from '../../../../shared/providers';

export function useModeText() {
  const { effort, modelName, effortName, menu } = useChatSettings();
  const canEffort = useCan('effort');
  return `${shortModel(modelName)}${effort && canEffort ? ` · ${effortName}` : ''} · ${menu.label}`;
}

function ModeChip({ setPick }: { setPick: (p: Pick) => void }) {
  const { modeInfo } = useChatSettings();
  const modeText = useModeText();
  return (
    <Chip className="cp-mode" title={`${modeInfo.detail} (Shift+Tab to switch mode)`} onClick={(e) => setPick({ kind: 'menu', at: e.currentTarget.getBoundingClientRect() })}>
      <Icon name={modeInfo.icon} small /><span>{modeText}</span><Icon name="chevron-down" small />
    </Chip>
  );
}

function AttachButton({ attach }: { attach: (list: File[]) => Promise<void> }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <IconButton className="attach" icon="file-add" label="Add files" title="Add files for the agent to look at (or paste or drop them)" small onClick={() => picker.current?.click()} />
    </>
  );
}

export function SendButton({ typed, shell, submit }: { typed: boolean; shell: boolean; submit: (stop?: boolean) => void }) {
  const running = useStore((s) => s.session.running);
  const stopping = useStore((s) => s.session.stopping);
  const compacting = useStore((s) => s.session.compacting);
  const label = useStore((s) => providerLabel(s.session.provider));
  if (running && !typed) {
    return (
      <button className="cp-stop" title={stopping ? 'Stopping…' : `Stop ${label}`} aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onPointerDown={(e) => e.preventDefault()} onClick={() => send({ type: 'interrupt' })}>
        <Icon name={stopping ? 'loading' : 'debug-stop'} small spin={stopping} />
      </button>
    );
  }
  return (
    <button
      className="cp-send"
      title={shell ? 'Run in the terminal (Enter)' : compacting ? 'Sends when compacting is done (Enter)' : running ? `Send at ${label}'s next step (Enter), stop and send (⌘Enter or hold)` : 'Send (Enter)'}
      aria-label={shell ? 'Run' : 'Send'}
      disabled={!typed}
      onPointerDown={(e) => e.preventDefault()}
      onClick={(e) => submit(e.metaKey || e.ctrlKey)}
      onContextMenu={(e) => { if (!running) return; e.preventDefault(); submit(true); }}
    >
      <Icon name={shell ? 'terminal' : 'arrow-up'} small />
    </button>
  );
}

type FootProps = { uses: Use[]; uploading: number; typed: boolean; shell: boolean; setPick: (p: Pick) => void; attach: (list: File[]) => Promise<void>; dictate: ReturnType<typeof useDictation>; submit: (stop?: boolean) => void };

export function ComposerFoot({ uses, uploading, typed, shell, setPick, attach, dictate, submit }: FootProps) {
  const canMcp = useCan('mcp');
  const connected = useStore((s) => s.session.mcp).some((m) => m.status === 'connected');
  const hasServers = canMcp && connected;
  const label = useStore((s) => providerLabel(s.session.provider));
  return (
    <div className="cp-foot">
      <ModeChip setPick={setPick} />
      <span className="cp-spacer" />
      {hasServers && (
        <IconButton className="mcp" icon="plug" label="Use an MCP server" title={`Ask ${label} to use an MCP server or tool`} small on={uses.length > 0} onClick={(e) => setPick({ kind: 'mcp', at: e.currentTarget.getBoundingClientRect() })} />
      )}
      <AttachButton attach={attach} />
      {uploading > 0 && <span className="cp-hint"><Icon name="loading" small spin /> Uploading {uploading}</span>}
      <Voice onText={dictate} />
      <SendButton typed={typed} shell={shell} submit={submit} />
    </div>
  );
}
