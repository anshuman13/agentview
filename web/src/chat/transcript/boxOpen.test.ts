import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBox, saveBox } from './boxOpen';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
});

describe('boxOpen', () => {
  it('uses the fallback for an unknown id and the saved value after a save', () => {
    expect(readBox('agent:a', false)).toBe(false);
    expect(readBox('agent:a', true)).toBe(true);
    saveBox('agent:a', true);
    expect(readBox('agent:a', false)).toBe(true);
    saveBox('agent:a', false);
    expect(readBox('agent:a', true)).toBe(false);
  });

  it('drops the oldest id after 301 saves', () => {
    for (let i = 0; i <= 300; i++) saveBox(`agent:${i}`, true);
    expect(readBox('agent:0', false)).toBe(false);
    expect(readBox('agent:1', false)).toBe(true);
    expect(readBox('agent:300', false)).toBe(true);
  });
});
