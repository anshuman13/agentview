import { z } from 'zod';
import { defineTool } from './tool.js';

export const PHONE_ALARM_RULES = "To set an alarm on the user's phone, use mcp__agentview__phone_alarm; offer it when a wake-up or leave-home time is settled.";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const localDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The error line for an argument the phone should not see, or null. The day gets a day of slack each way for a phone in another time zone.
function invalidAlarm(time: string, day?: string) {
  if (!TIME.test(time)) return 'time must be HH:MM (24 h)';
  if (day === undefined) return null;
  if (!DAY.test(day) || Number.isNaN(Date.parse(day))) return 'day must be YYYY-MM-DD';
  return day < localDay(-1) || day > localDay(7) ? 'day must be within the next 7 days' : null;
}

export const phoneAlarmTool = defineTool({
  name: 'phone_alarm',
  description: "Set an alarm in the clock app on the user's phone, through the AgentView app. Without day it rings the next time the time comes round; with day (within the next 7 days) it repeats weekly on that weekday until the user deletes it. The phone may only show a notification the user taps.",
  schema: {
    time: z.string().describe("HH:MM, 24 h, the phone's local time"),
    day: z.string().optional().describe('YYYY-MM-DD'),
    label: z.string().optional(),
  },
  async handler({ time, day, label }, { host }) {
    return invalidAlarm(time, day) ?? host.phoneAlarm({ time, ...(day && { day }), ...(label && { label }) });
  },
});
