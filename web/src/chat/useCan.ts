import { useStore } from '../app/store';
import type { Capabilities } from '../../../shared/protocol';
import { can } from './capabilitiesLogic';

export const useCan = (what: keyof Capabilities) => useStore((s) => can(s.session.capabilities, what));
