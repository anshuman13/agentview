import { afterEach, describe, expect, it, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '../../../testing.js';
import { alarmPhone, type Client } from '../http/clients.js';
import { ALARM_WAIT_MS, alarmResult, phoneAlarm } from './phoneAlarm.js';
import { apis } from './state.js';

afterEach(() => {
  apis.clear();
  vi.useRealTimers();
});

const connect = () => {
  const sent: { alarm: { id: string } }[] = [];
  apis.add((v) => sent.push(v as never));
  return sent;
};

describe('host phone alarm', () => {
  it('answers at once with no API connection', async () => {
    expect(await phoneAlarm({ time: '07:30' })).toBe('No phone connected: tell the user to open AgentView on the phone');
  });

  it('sends to the first API connection only and resolves with the phone result', async () => {
    const first = connect();
    const second = connect();
    const out = phoneAlarm({ time: '07:30', day: '2026-11-24' });
    expect(second).toHaveLength(0);
    expect(first[0].alarm).toMatchObject({ time: '07:30', day: '2026-11-24' });
    alarmResult({ op: 'alarm_result', id: first[0].alarm.id, ok: true, weekday: 'Tuesday' });
    expect(await out).toBe('Set on the phone for Tuesday; it repeats weekly until the user deletes it');
  });

  it('words each result', async () => {
    const sent = connect();
    const ask = async (r: object) => {
      const out = phoneAlarm({ time: '07:30' });
      alarmResult({ op: 'alarm_result', id: sent.at(-1)!.alarm.id, ok: true, ...r });
      return out;
    };
    expect(await ask({})).toBe('Set on the phone');
    expect(await ask({ notified: true })).toBe('Sent to the phone as a notification: the user taps it to set the alarm');
    expect(await ask({ ok: false, error: 'no phone' })).toBe('No phone connected: tell the user to open AgentView on the phone');
    expect(await ask({ ok: false, error: 'No clock app on the phone' })).toBe('Not set on the phone: No clock app on the phone');
  });

  it('times out after 20 s and ignores a late result', async () => {
    vi.useFakeTimers();
    const sent = connect();
    const out = phoneAlarm({ time: '07:30' });
    await advanceTimersByTimeAsync(ALARM_WAIT_MS);
    expect(await out).toBe('The phone did not answer: ask the user to check their alarms');
    expect(() => alarmResult({ op: 'alarm_result', id: sent[0].alarm.id, ok: true })).not.toThrow();
  });
});

describe('alarmPhone', () => {
  const client = (c: Partial<Client>) => ({ send: () => {}, sendRaw: () => {}, view: '', app: false, readOnly: false, opened: 0, ...c }) as Client;

  it('picks the latest opened phone app, the later one on a tie', () => {
    const a = client({ app: true, opened: 5 });
    const b = client({ app: true, opened: 9 });
    const c = client({ app: true, opened: 9 });
    expect(alarmPhone([a, b, c])).toBe(c);
    expect(alarmPhone([a, b])).toBe(b);
  });

  it('skips read-only streams and browsers', () => {
    const browser = client({ phone: true, opened: 20 });
    const readOnly = client({ app: true, readOnly: true, opened: 30 });
    const app = client({ app: true, opened: 1 });
    expect(alarmPhone([browser, readOnly, app])).toBe(app);
    expect(alarmPhone([browser, readOnly])).toBeUndefined();
  });
});
