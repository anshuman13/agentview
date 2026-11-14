import { useRef, useState } from 'react';
import { renameTitle, type RenameEvent } from './folders';

export function RenameInput({ value, onSave, onCancel }: { value: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (event: RenameEvent) => {
    if (done.current) return;
    done.current = true;
    const title = renameTitle(event, text, value);
    if (title) onSave(title);
    else onCancel();
  };
  return (
    <input
      className="chat-rename"
      autoFocus
      maxLength={120}
      aria-label="Chat title"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish('Enter');
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish('Escape');
        }
      }}
    />
  );
}
