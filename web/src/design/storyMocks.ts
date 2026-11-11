import { createRequire } from 'node:module';
import { vi } from 'vitest';
import { stubGlobal } from '../../../testing';

const react = createRequire(import.meta.url)('react') as typeof import('react');
const { useSyncExternalStore } = react;

const doc = { documentElement: { dataset: {}, style: {} }, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} };
stubGlobal('document', doc);
stubGlobal('window', { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} });
stubGlobal('matchMedia', () => ({ matches: false }));
stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
stubGlobal('location', { search: '', hash: '' });

vi.mock('react', () => ({ ...react, useSyncExternalStore: (subscribe: never, get: () => unknown) => useSyncExternalStore(subscribe, get, get) }));
