import type { Capabilities } from '../../../shared/protocol';

// A chat without capabilities (an older host) supports everything.
export const can = (caps: Capabilities | undefined, what: keyof Capabilities) => caps?.[what] !== false;

// The Team entry is the Opus advisor setup, which only Claude chats have.
export const modelsFor = <M extends { value: string }>(models: M[], caps: Capabilities | undefined) => (can(caps, 'team') ? models : models.filter((m) => m.value !== 'team'));
