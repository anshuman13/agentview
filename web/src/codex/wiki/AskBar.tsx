import { useState } from 'react';
import { Icon } from '../../ui/Icon';

export function AskBar({ placeholder, onAsk }: { placeholder: string; onAsk: (q: string) => boolean }) {
  const [q, setQ] = useState('');
  const submit = () => q.trim() && onAsk(q.trim()) && setQ('');
  return (
    <div className="wk-ask">
      <div className="wk-ask-box">
        <Icon name="sparkle" />
        <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
        <button className="cp-send" aria-label="Ask" title="Ask in a new chat" disabled={!q.trim()} onClick={submit}><Icon name="arrow-up" /></button>
      </div>
    </div>
  );
}
