import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { apiBase, apiUrl, macOrigin, shell } from './api';

export type Mac = { name: string; url: string; running: number; self?: boolean };
export type Connect = { hostname: string; macs: Mac[]; netbird?: string };

let hostname = '';
const listeners = new Set<(name: string) => void>();

export function loadMacName() {
  hostname = '';
  listeners.forEach((f) => f(hostname));
  const base = apiBase();
  fetch(apiUrl('/api/connect?peer=1'))
    .then((r) => r.json())
    .then((d: Connect) => {
      if (base !== apiBase()) return;
      hostname = d.hostname;
      shell()?.remember?.(macOrigin(), hostname);
      listeners.forEach((f) => f(hostname));
    })
    .catch(() => {});
}

loadMacName();

export function useMacName() {
  const [name, setName] = useState(hostname);
  useEffect(() => {
    listeners.add(setName);
    return () => void listeners.delete(setName);
  }, []);
  return name;
}

const switched = typeof location !== 'undefined' && new URLSearchParams(location.search).has('switched');

export function SwitchedBanner() {
  const name = useMacName();
  const [shown, setShown] = useState(switched);
  useEffect(() => {
    if (!shown || !name) return;
    const t = setTimeout(() => setShown(false), 5000);
    return () => clearTimeout(t);
  }, [shown, name]);
  if (!shown || !name) return null;
  return (
    <div className="app-update">
      <Icon name="vm" small />
      <span>Switched to {name}</span>
      <button className="icon-btn" title="Close" onClick={() => setShown(false)}><Icon name="close" small /></button>
    </div>
  );
}

