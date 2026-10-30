import { useState } from 'react';
import { Icon } from '../../ui/Icon';
import { useRecipes } from './Recipes';

export function AskBar({ placeholder, onAsk }: { placeholder: string; onAsk: (q: string) => boolean }) {
  const [q, setQ] = useState('');
  const submit = () => q.trim() && onAsk(q.trim()) && setQ('');
  const recipes = useRecipes(q, setQ);
  return (
    <div className="wk-ask">
      {recipes.menu}
      <div className="wk-ask-box">
        <Icon name="sparkle" />
        <input value={q} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => !recipes.onKeyDown(e) && e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
        <button className="cp-send" aria-label="Ask" title="Ask in a new chat" disabled={!q.trim()} onClick={submit}><Icon name="arrow-up" /></button>
      </div>
    </div>
  );
}
