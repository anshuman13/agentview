import { useRef } from 'react';
import { send, useStore } from '../../app/store';
import { Chip } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useChatSettings, type Pick } from '../ChatSettings';
import { useCan } from '../useCan';
import { Voice, type useDictation } from './Voice';
import { goalInfo, type GoalChoice, type Use } from './composerLogic';
import { providerLabel } from '../../../../shared/providers';

export function useModeText(goal: GoalChoice) {
  const { effort, modelName, effortName, modeInfo } = useChatSettings();
  const canEffort = useCan('effort');
  const shortModel = modelName.replace(/\s*\(.*\)$/, '').replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, (_, n: string, a, b) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`);
  return `${shortModel}${effort && canEffort ? ` · ${effortName}` : ''} · ${modeInfo.label}${goal !== 'off' ? ` · ${goalInfo(goal, Date.now()).chip}` : ''}`;
}

function ModeChip({ goal, setPick }: { goal: GoalChoice; setPick: (p: Pick) => void }) {
  const { loop, modeInfo } = useChatSettings();
  const modeText = useModeText(goal);
  return (
    <Chip className={`cp-mode${loop.on ? ' loop' : ''}`} title={`${modeInfo.detail} (Shift+Tab to switch mode)${loop.on ? `. Build cycle on, up to ${loop.max} ${loop.max === 1 ? 'round' : 'rounds'}` : ''}`} onClick={(e) => setPick({ kind: 'menu', at: e.currentTarget.getBoundingClientRect() })}>
      <Icon name={modeInfo.icon} small /><span>{modeText}</span>{(loop.on || goal !== 'off') && <Icon name="sync" small />}<Icon name="chevron-down" small />
    </Chip>
  );
}

function AttachButton({ attach }: { attach: (list: File[]) => Promise<void> }) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach([...(e.target.files ?? [])]); e.target.value = ''; }} />
      <button className="icon-btn attach" title="Add files for the agent to look at (or paste or drop them)" aria-label="Add files" onClick={() => picker.current?.click()}>
        <Icon name="file-add" small />
      </button>
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

type FootProps = { goal: GoalChoice; uses: Use[]; uploading: number; typed: boolean; shell: boolean; setPick: (p: Pick) => void; attach: (list: File[]) => Promise<void>; dictate: ReturnType<typeof useDictation>; submit: (stop?: boolean) => void };

export function ComposerFoot({ goal, uses, uploading, typed, shell, setPick, attach, dictate, submit }: FootProps) {
  const canMcp = useCan('mcp');
  const connected = useStore((s) => s.session.mcp).some((m) => m.status === 'connected');
  const hasServers = canMcp && connected;
  const label = useStore((s) => providerLabel(s.session.provider));
  return (
    <div className="cp-foot">
      <ModeChip goal={goal} setPick={setPick} />
      <span className="cp-spacer" />
      {hasServers && (
        <button className={`icon-btn mcp${uses.length ? ' on' : ''}`} title={`Ask ${label} to use an MCP server or tool`} aria-label="Use an MCP server" onClick={(e) => setPick({ kind: 'mcp', at: e.currentTarget.getBoundingClientRect() })}>
          <Icon name="plug" small />
        </button>
      )}
      <AttachButton attach={attach} />
      {uploading > 0 && <span className="cp-hint"><Icon name="loading" small spin /> Uploading {uploading}</span>}
      <Voice onText={dictate} />
      <SendButton typed={typed} shell={shell} submit={submit} />
    </div>
  );
}
