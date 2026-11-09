import { useEffect, useState } from 'react';
import type { Fact } from '../data/wiki/wiki';
import { setView, useView } from '../view';

// A cited claim may sit past the window or in Older, so a page opened at an anchor shows every claim, opens Older and flashes the claim.
export function useClaimAnchor(id: string, older: Fact[], loaded: boolean) {
  const { anchor } = useView();
  const [allFor, setAllFor] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => { setShowOlder(false); }, [id]);
  // An anchor that arrives before the claims waits for them.
  useEffect(() => {
    if (!anchor || !loaded) return;
    setAllFor(id);
    if (older.some((f) => f.id === anchor)) setShowOlder(true);
    setFlash(anchor);
    setView({ anchor: null });
  }, [anchor, id, loaded, older]);
  // Runs again once Older opens, so a claim in it exists before the scroll.
  useEffect(() => {
    if (!flash) return;
    document.getElementById(`claim-${flash}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash, showOlder]);
  return { showAll: Boolean(anchor) || allFor === id, showOlder, setShowOlder, flash };
}
