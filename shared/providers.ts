import { PERMISSION_MODES, type Provider } from './protocol.js';

// What each provider fixes: its name, how its use is billed and the permission modes it offers.
export type Billing = 'usd' | 'none' | 'plan';
export type ModeOption = { value: string; label: string; detail: string };

const LABEL: Record<Provider, string> = { claude: 'Claude', openrouter: 'OpenRouter', codex: 'Codex' };
const BILLING: Record<Provider, Billing> = { claude: 'usd', openrouter: 'none', codex: 'plan' };

const CLAUDE_MODES: Record<(typeof PERMISSION_MODES)[number], Omit<ModeOption, 'value'>> = {
  default: { label: 'Default', detail: 'Ask before edits and risky commands' },
  acceptEdits: { label: 'Accept edits', detail: 'Edit files without asking, ask for the rest' },
  plan: { label: 'Plan', detail: 'Read and plan, no edits' },
  auto: { label: 'Auto', detail: 'Claude runs what is safe and asks only for risky actions' },
  dontAsk: { label: "Don't ask", detail: 'Deny anything not pre-approved' },
};

const CODEX_MODES: ModeOption[] = [
  { value: 'default', label: 'Ask first', detail: 'Ask before edits and commands' },
  { value: 'auto', label: 'Auto', detail: 'Edit and run commands, network on' },
  { value: 'readOnly', label: 'Read only', detail: 'Read files, no edits' },
];

// A chat with no provider runs on Claude.
export const providerLabel = (p?: Provider) => LABEL[p ?? 'claude'];
export const billing = (p?: Provider): Billing => BILLING[p ?? 'claude'];

// The mark a row shows before its time for a chat that is not on Claude.
export const providerMark = (p?: Provider) => (p && p !== 'claude' ? LABEL[p] : undefined);

export const providerModes = (p?: Provider): ModeOption[] => (p === 'codex' ? CODEX_MODES : PERMISSION_MODES.map((value) => ({ value, ...CLAUDE_MODES[value] })));
