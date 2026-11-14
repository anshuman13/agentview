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
  { value: 'default', label: 'Default', detail: 'Ask before edits and commands' },
  { value: 'auto', label: 'Auto', detail: 'Edit and run commands, network on' },
  { value: 'readOnly', label: 'Read only', detail: 'Read files, no edits' },
];

// A chat with no provider runs on Claude.
export const providerLabel = (p?: Provider) => LABEL[p ?? 'claude'];
export const billing = (p?: Provider): Billing => BILLING[p ?? 'claude'];

// The mark a row shows before its time for a chat that is not on Claude.
export const providerMark = (p?: Provider) => (p && p !== 'claude' ? LABEL[p] : undefined);

export const providerModes = (p?: Provider): ModeOption[] => (p === 'codex' ? CODEX_MODES : PERMISSION_MODES.map((value) => ({ value, ...CLAUDE_MODES[value] })));

// A start mode the provider does not offer (Plan on Codex) starts in Default (Android startModeFor).
export const startModeFor = (mode: string | null, p?: Provider) => (mode !== null && !providerModes(p).some((m) => m.value === mode) ? 'default' : mode);

const SUPERVISED: ModeOption = { value: 'supervised', label: 'Supervised', detail: 'Auto, and review each turn' };

// The mode list the pick menus show: Supervised (auto with review each turn) follows Auto. Shift+Tab, the palette and new chats use providerModes.
export function menuModes(p: Provider | undefined, mode: string, review: boolean) {
  const modes = providerModes(p);
  const at = modes.findIndex((m) => m.value === 'auto') + 1;
  const supervised = mode === 'auto' && review;
  const name = modes.find((m) => m.value === mode)?.label ?? mode;
  return {
    list: [...modes.slice(0, at), SUPERVISED, ...modes.slice(at)],
    checked: supervised ? SUPERVISED.value : mode,
    label: supervised ? SUPERVISED.label : review ? `${name} · Review` : name,
  };
}

// What picking a row of the menu sends: a permission mode and a review switch, each null when it already holds.
export function modeSteps(mode: string, review: boolean, picked: string) {
  if (picked === menuModes(undefined, mode, review).checked) return { mode: null, review: null };
  if (picked === SUPERVISED.value) return { mode: mode === 'auto' ? null : 'auto', review: review ? null : true };
  return { mode: picked === mode ? null : picked, review: review ? false : null };
}

// The model menu shows the newest version of each family ("Opus 5.5", not "Opus 4.6"), names without a version, and the current model.
export function newestModels<T extends { value: string; displayName: string }>(models: T[], current?: string | null): T[] {
  const parse = (m: T) => /^(\D+?)\s+(\d+(?:\.\d+)*)\b/.exec(m.displayName);
  const num = (v: string) => v.split('.').map(Number);
  const newer = (a: string, b: string) => {
    const [x, y] = [num(a), num(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    return false;
  };
  const top = new Map<string, string>();
  for (const m of models) {
    const p = parse(m);
    if (p && (!top.has(p[1]) || newer(p[2], top.get(p[1])!))) top.set(p[1], p[2]);
  }
  return models.filter((m) => {
    const p = parse(m);
    return !p || m.value === current || num(p[2]).join('.') === num(top.get(p[1])!).join('.');
  });
}
