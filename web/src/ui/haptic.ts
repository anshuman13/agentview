const PATTERNS = { tap: 8, success: 15 };

export const haptic = (kind: keyof typeof PATTERNS = 'tap') => navigator.vibrate?.(PATTERNS[kind]);
