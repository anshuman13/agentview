import { useEffect, useRef, useState } from 'react';
import { embedded } from '../store';
import { Back } from '../touch/back';
import { useReturnFocus } from '../../ui/util';
import { keyText, MAC } from './keys';
import '../../styles/features/palette.css';

export const SHORTCUTS: { group: string; rows: { key: string; label: string }[] }[] = [
  { group: 'Chat', rows: [
    { key: '⌘O', label: 'Start a chat in a repo' },
    { key: '⌘F', label: 'Find in the chat, or search in Codex' },
    { key: '⌘;', label: 'Ask in a side chat beside this one' },
    { key: 'Enter', label: 'Send; Shift+Enter for a new line' },
    { key: 'Tab', label: 'Accept the suggested command or the ghost text' },
    { key: 'Shift+Tab', label: 'Cycle the permission mode' },
    { key: '⇧⌘I', label: 'Choose the model' },
    { key: '⇧⌘M', label: 'Choose the permission mode' },
    { key: '⇧⌘E', label: 'Choose the effort' },
    { key: '↑ / ↓', label: 'Step through sent prompts when the box is empty' },
  ] },
  { group: 'Navigation', rows: [
    { key: '⌘P', label: 'Open a file' },
    { key: '⇧⌘P or F1', label: 'Command palette' },
    { key: '⌘I', label: 'Focus the assistant' },
    { key: '⌘E', label: 'Switch between file and browser' },
    { key: 'j / k or arrows', label: 'Move between chats in Sessions; Enter opens' },
    { key: '⇧⌘] / ⇧⌘[', label: 'Next or previous open chat in Sessions, wraps' },
    { key: '⌥⇧↓ / ⌥⇧↑', label: 'Next or previous unread open chat (Done or Needs you)' },
  ] },
  { group: 'Panels', rows: [
    { key: '⌘B', label: 'Toggle the sidebar' },
    { key: '⌥⌘B', label: 'Toggle the task box' },
    { key: '⌘J', label: 'Toggle the terminal' },
    { key: '⌘K', label: 'Clear the terminal' },
    { key: '⇧⌘Space', label: 'Show the desktop window app with the composer focused (desktop window app only)' },
    { key: '⌘Enter', label: 'Commit in Source Control' },
  ] },
  { group: 'Tasks', rows: [
    { key: 'j / k', label: 'Move between tasks; Enter or Space opens, Esc closes, x done, s snooze, Delete removes' },
    { key: 'n', label: 'New task for today' },
    { key: '/', label: 'Search tasks' },
    { key: 'j / k, Enter, s, x', label: 'On a Reply queue ask: move between asks, open the task, send the draft, skip the ask' },
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

export function filterShortcuts(groups: typeof SHORTCUTS, query: string, mac = MAC) {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const hit = (r: { key: string; label: string }) => [r.label, r.key, keyText(r.key, mac)].some((t) => t.toLowerCase().includes(q));
  return groups.map((g) => ({ ...g, rows: g.rows.filter(hit) })).filter((g) => g.rows.length);
}

const inField = (el: Element | null) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (el as HTMLElement).isContentEditable);

export function Shortcuts() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (embedded) return;
    const onOpen = () => { setQuery(''); setOpen(true); };
    window.addEventListener('agentview:shortcuts', onOpen);
    return () => window.removeEventListener('agentview:shortcuts', onOpen);
  }, []);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (query) setQuery('');
        else setOpen(false);
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
  }, [open, query]);

  if (!open) return null;
  return <Sheet query={query} setQuery={setQuery} close={() => setOpen(false)} />;
}

function Sheet({ query, setQuery, close }: { query: string; setQuery: (q: string) => void; close: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useReturnFocus();
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const groups = filterShortcuts(SHORTCUTS, query);
  return (
    <div className="overlay" onClick={close}>
      <Back close={close} />
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <div className="palette-input shortcuts-search">
          <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" spellCheck={false} />
        </div>
        <div className="shortcuts-list">
          {!groups.length && <p className="palette-empty">No shortcuts match</p>}
          {groups.map((g) => (
            <section key={g.group}>
              <h3>{g.group}</h3>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.key}>
                    <kbd>{keyText(r.key)}</kbd>
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
