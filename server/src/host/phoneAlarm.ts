import { randomUUID } from 'node:crypto';
import { apis } from './state.js';
import type { HostRequest } from './protocol.js';

export const ALARM_WAIT_MS = 20_000;

type Result = Extract<HostRequest, { op: 'alarm_result' }>;

const pending = new Map<string, (r: Result) => void>();

const NO_PHONE = 'No phone connected: tell the user to open AgentView on the phone';

const text = (r: Result) => {
  if (r.ok && r.notified) return 'Sent to the phone as a notification: the user taps it to set the alarm';
  if (r.ok) return r.weekday ? `Set on the phone for ${r.weekday}; it repeats weekly until the user deletes it` : 'Set on the phone';
  return r.error === 'no phone' ? NO_PHONE : `Not set on the phone: ${r.error}`;
};

// Sends the alarm to the first API server, which picks the phone, and waits for the phone's result.
export function phoneAlarm(a: { time: string; day?: string; label?: string }) {
  const [send] = apis;
  if (!send) return Promise.resolve(NO_PHONE);
  const id = randomUUID();
  return new Promise<string>((ok) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      ok('The phone did not answer: ask the user to check their alarms');
    }, ALARM_WAIT_MS);
    pending.set(id, (r) => {
      clearTimeout(timer);
      pending.delete(id);
      ok(text(r));
    });
    send({ alarm: { id, ...a } });
  });
}

export function alarmResult(r: Result) {
  pending.get(r.id)?.(r);
}
