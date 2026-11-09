import { useEffect, useRef, useState } from 'react';
import { embedded } from '../store';
import { Back } from '../touch/back';
import { useReturnFocus } from '../../ui/util';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export const SHORTCUTS: { group: string; rows: { key: string; label: string }[] }[] = [
  { group: 'Chat', rows: [
    { key: '⌘O', label: 'Start a chat in a repo' },
    { key: 'Enter', label: 'Send; Shift+Enter for a new line' },
    { key: 'Tab', label: 'Accept the suggested command or the ghost text' },
    { key: 'Shift+Tab', label: 'Cycle the permission mode' },
    { key: '↑ / ↓', label: 'Step through sent prompts when the box is empty' },
  ] },
  { group: 'Navigation', rows: [
    { key: '⌘P', label: 'Open a file' },
    { key: '⇧⌘P or F1', label: 'Command palette' },
    { key: '⌘I', label: 'Focus the assistant' },
    { key: '⌘E', label: 'Switch between file and browser' },
    { key: 'j / k or arrows', label: 'Move between chats in Sessions; Enter opens' },
    { key: '⇧⌘] / ⇧⌘[', label: 'Next or previous open chat in Sessions, wraps' },
  ] },
  { group: 'Panels', rows: [
    { key: '⌘B', label: 'Toggle the sidebar' },
    { key: '⌥⌘B', label: 'Toggle the task box' },
    { key: '⌘J', label: 'Toggle the terminal' },
    { key: '⌘K', label: 'Clear the terminal' },
    { key: '⌘Enter', label: 'Commit in Source Control; run the query in Observe' },
  ] },
  { group: 'Tasks', rows: [
    { key: 'j / k', label: 'Move between tasks; Enter or Space opens, Esc closes, x done, s snooze, Delete removes' },
    { key: 'n', label: 'New task for today' },
    { key: '/', label: 'Search tasks' },
  ] },
  { group: 'Permissions and Questions', rows: [
    { key: 'y / n / a', label: 'Allow, deny or always allow the top permission card' },
    { key: '1-9', label: 'Pick an answer on the top question card' },
  ] },
  { group: 'General', rows: [
    { key: '?', label: 'Show this list' },
    { key: 'Esc', label: 'Close a popup or clear a filter' },
  ] },
];

const show = (key: string) => (MAC ? key : key.replace(/⌘/g, 'Ctrl+'));

const inField = (el: Element | null) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);

export function Shortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (embedded) return;
    const onOpen = () => setOpen(true);
    window.addEventListener('agentview:shortcuts', onOpen);
    return () => window.removeEventListener('agentview:shortcuts', onOpen);
  }, []);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || inField(document.activeElement)) return;
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (!document.querySelector('.overlay, [role="dialog"]')) {
        e.preventDefault();
        window.dispatchEvent(new Event('agentview:shortcuts'));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  return <Sheet close={() => setOpen(false)} />;
}

function Sheet({ close }: { close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <div className="overlay" onClick={close}>
      <Back close={close} />
      <div ref={ref} tabIndex={-1} className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="shortcuts-list">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3>{g.group}</h3>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.key}>
                    <kbd>{show(r.key)}</kbd>
                    <span>{r.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
