import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { allRecipes, matchRecipes, type Recipe } from '../data/recipes';

export function useRecipes(q: string, fill: (text: string) => void) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const list = useMemo(() => (q.startsWith('/') ? matchRecipes(allRecipes(), q) : []), [q]);
  const open = list.length > 0 && !dismissed;
  useEffect(() => { setIndex(0); setDismissed(false); }, [q]);

  const pick = (r: Recipe) => { fill(r.text); setDismissed(true); };

  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) pick(list[index]);
    else if (e.key === 'Escape') setDismissed(true);
    else return false;
    e.preventDefault();
    return true;
  };

  const menu = open && (
    <ul className="wk-recipes" role="listbox">
      {list.map((r, i) => (
        <li key={r.id} role="option" aria-selected={i === index} className={i === index ? 'on' : ''} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
          {r.title}
        </li>
      ))}
    </ul>
  );

  return { menu, onKeyDown };
}
