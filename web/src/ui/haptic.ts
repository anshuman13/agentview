import { tauriInvoke } from '../app/runtime/tauri';

const PATTERNS = { tap: 8, success: 15 };
const PLUGIN = {
  tap: { cmd: 'plugin:haptics|impact_feedback', args: { style: 'light' } },
  success: { cmd: 'plugin:haptics|notification_feedback', args: { type: 'success' } },
};

export function haptic(kind: keyof typeof PATTERNS = 'tap') {
  const vibrate = () => navigator.vibrate?.(PATTERNS[kind]);
  const invoke = tauriInvoke();
  if (!invoke) return vibrate();
  try {
    Promise.resolve(invoke(PLUGIN[kind].cmd, PLUGIN[kind].args)).catch(vibrate);
  } catch {
    vibrate();
  }
}
