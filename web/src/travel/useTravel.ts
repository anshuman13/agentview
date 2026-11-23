import { useCallback, useEffect, useRef, useState } from 'react';
import type { TravelData } from '../../../shared/travel';
import { fetchTravel } from './travelApi';

const POLL = 2500;

// Trips and receipts, read again every 2.5 s while Claude is still reading a receipt.
export function useTravel(shown: boolean) {
  const [data, setData] = useState<TravelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const reload = useCallback(() => {
    const mine = ++latest.current;
    return fetchTravel().then(
      (d) => { if (mine === latest.current) { setData(d); setError(null); } },
      (e) => { if (mine === latest.current) setError(e instanceof Error ? e.message : String(e)); },
    );
  }, []);
  useEffect(() => { if (shown) void reload(); }, [shown, reload]);
  const reading = data?.receipts.some((r) => r.read === 'pending');
  useEffect(() => {
    if (!shown || !reading) return;
    const t = setInterval(() => void reload(), POLL);
    return () => clearInterval(t);
  }, [shown, reading, reload]);
  return { data, error, reload };
}
