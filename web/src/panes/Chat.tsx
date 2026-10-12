import { useMemo, useState } from 'react';
import { Marked } from 'marked';
import { send, useStore } from '../store';
import { Icon } from '../Icon';
import { QuickPick } from '../QuickPick';
import { PERMISSION_MODES } from '../../../shared/protocol';

const MODES: Record<string, { label: string; detail: string; icon: string }> = {
  default: { label: 'Ask before edits', detail: 'Ask before risky tools', icon: 'shield' },
  acceptEdits: { label: 'Edit automatically', detail: 'Auto-accept file edits, ask for the rest', icon: 'edit' },
  plan: { label: 'Plan mode', detail: 'Read-only planning, no edits', icon: 'eye' },
  dontAsk: { label: "Don't ask", detail: 'Deny anything not pre-approved', icon: 'circle-slash' },
};

export function Composer() {
  const running = useStore((s) => s.session.running);
  const waiting = useStore((s) => s.pending.length > 0);
  const commands = useStore((s) => s.session.commands);
  const mode = useStore((s) => s.session.permissionMode) ?? 'default';
  const model = useStore((s) => s.session.model);
  const models = useStore((s) => s.session.models);
  const team = useStore((s) => s.session.team);
  const [pick, setPick] = useState<{ kind: 'model' | 'mode'; at: DOMRect } | null>(null);
  const [text, setText] = useState('');
  const [cmdIdx, setCmdIdx] = useState(0);
  const cmdMatches = useMemo(() => {
    const m = /^\/(\S*)$/.exec(text);
    if (!m) return [];
    const needle = m[1].toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(needle)).slice(0, 12);
  }, [text, commands]);
  const modelName = team ? 'Team' : models.find((m) => m.value === (model ?? 'default'))?.displayName ?? model ?? 'Default';
  const cycleMode = () => send({ type: 'set_permission_mode', mode: PERMISSION_MODES[(PERMISSION_MODES.indexOf(mode as never) + 1) % PERMISSION_MODES.length] });

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: running ? 'steer' : 'prompt', text: t });
    setText('');
  };

  return (
    <>
      <div className="composer" data-mode={mode}>
        {cmdMatches.length > 0 && (
          <ul className="cmd-popup">
            {cmdMatches.map((c, i) => (
              <li key={c.name} className={i === cmdIdx ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); setText(`/${c.name} `); }}>
                <span>/{c.name}</span>
                <span className="muted small detail">{c.description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={text}
          rows={1}
          placeholder={waiting ? 'Answer below, or steer Claude' : running ? 'Steer Claude: stops the current step and sends this' : 'What should Claude do? (/ for commands)'}
          onChange={(e) => { setText(e.target.value); setCmdIdx(0); }}
          onKeyDown={(e) => {
            if (cmdMatches.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx((i) => Math.min(i + 1, cmdMatches.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx((i) => Math.max(i - 1, 0)); return; }
              if (e.key === 'Tab' || (e.key === 'Enter' && text !== `/${cmdMatches[cmdIdx].name}`)) {
                e.preventDefault();
                setText(`/${cmdMatches[cmdIdx].name} `);
                return;
              }
            }
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault();
              cycleMode();
              return;
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-foot">
          <button className="pill" title={`${MODES[mode]?.detail ?? mode} (Shift+Tab to switch)`} onClick={(e) => setPick({ kind: 'mode', at: e.currentTarget.getBoundingClientRect() })}>
            <Icon name={MODES[mode]?.icon ?? 'shield'} small /> {MODES[mode]?.label ?? mode}
          </button>
          <button className="pill" title="Switch model" onClick={(e) => setPick({ kind: 'model', at: e.currentTarget.getBoundingClientRect() })}>
            <Icon name="sparkle" small /> {modelName}
          </button>
          <span className="spacer" />
          {running && <button className="icon-btn stop" title="Stop" onClick={() => send({ type: 'interrupt' })}><Icon name="debug-stop" /></button>}
          <button className={`send ${running ? 'steer' : ''}`} title={running ? 'Steer (Enter)' : 'Send (Enter)'} disabled={!text.trim()} onClick={submit}><Icon name="arrow-up" /></button>
        </div>
      </div>
      {pick?.kind === 'model' && (
        <QuickPick
          anchor={pick.at}
          title="Select model"
          current={team ? 'team' : model}
          items={models.map((m) => ({ value: m.value, label: m.displayName, detail: m.description }))}
          onPick={(v) => { send({ type: 'set_model', model: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'mode' && (
        <QuickPick
          anchor={pick.at}
          title="Permission mode"
          current={mode}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: MODES[m]?.label ?? m, detail: MODES[m]?.detail }))}
          onPick={(v) => { send({ type: 'set_permission_mode', mode: v }); setPick(null); }}
          onClose={() => setPick(null)}
        />
      )}
    </>
  );
}

const md = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

function escapeHtml(t: string) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }) as string, [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
