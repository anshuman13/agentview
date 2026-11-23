import { describe, expect, it, vi } from 'bun:test';
import { ASK_TOOLS, TOOLS } from './index.js';
import { phoneAlarmTool } from './phoneAlarm.js';

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const run = async (args: Record<string, unknown>) => {
  const phoneAlarm = vi.fn(async () => 'sent');
  const text = await phoneAlarmTool.handler(args as never, { cwd: '/tmp', chatId: null, provider: 'claude', host: { phoneAlarm } } as never);
  return { text, phoneAlarm };
};

describe('phone_alarm tool', () => {
  it('is a tool that runs without asking', () => {
    expect(TOOLS.some((t) => t.name === 'phone_alarm')).toBe(true);
    expect(ASK_TOOLS).not.toContain('phone_alarm');
  });

  it('rejects a bad time, a bad day and a day out of range without sending', async () => {
    for (const [args, text] of [
      [{ time: '7:30' }, 'time must be HH:MM (24 h)'],
      [{ time: '24:00' }, 'time must be HH:MM (24 h)'],
      [{ time: '07:30', day: '07/12/2026' }, 'day must be YYYY-MM-DD'],
      [{ time: '07:30', day: day(-2) }, 'day must be within the next 7 days'],
      [{ time: '07:30', day: day(9) }, 'day must be within the next 7 days'],
    ] as const) {
      const r = await run(args);
      expect(r.text).toBe(text);
      expect(r.phoneAlarm).not.toHaveBeenCalled();
    }
  });

  it('passes a valid alarm to the host', async () => {
    const r = await run({ time: '07:30', day: day(-1), label: 'Flight' });
    expect(r.text).toBe('sent');
    expect(r.phoneAlarm).toHaveBeenCalledWith({ time: '07:30', day: day(-1), label: 'Flight' });
    expect((await run({ time: '06:00', label: '' })).phoneAlarm).toHaveBeenCalledWith({ time: '06:00' });
    expect((await run({ time: '06:00', day: day(7) })).text).toBe('sent');
  });
});
