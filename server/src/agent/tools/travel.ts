import { z } from 'zod';
import { setHome, travelData, updateTrip } from '../../integrations/travel.js';
import { tripRange, tripText, type Trip, type TripFields } from '../../../../shared/travel.js';
import { defineTool } from './tool.js';

export const TRAVEL_RULES = "To read or change a trip's notes, itinerary or checklist, or the user's home address, use mcp__agentview__travel.";

const ACTIONS = ['get', 'notes', 'plan_add', 'plan_edit', 'plan_remove', 'check_add', 'check_set', 'check_remove', 'home'] as const;

const PLAN = z.object({
  day: z.string().optional().describe('YYYY-MM-DD'),
  start: z.string().optional().describe('HH:MM'),
  end: z.string().optional().describe('HH:MM'),
  kind: z.string().optional().describe('flight, train, taxi, hotel, meal, event or other'),
  title: z.string().optional(),
  place: z.string().optional(),
  ref: z.string().optional().describe('Flight number or booking code'),
});

type Args = { action: (typeof ACTIONS)[number]; item?: string; text?: string; replace?: boolean; done?: boolean; plan?: z.infer<typeof PLAN> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The change an action makes to a trip, or the error line for a missing field or unknown item.
function change(t: Trip, action: Exclude<Args['action'], 'get' | 'home'>, a: Args): Pick<TripFields, 'notes' | 'plan' | 'checklist'> | string {
  const plan = t.plan ?? [];
  const checklist = t.checklist ?? [];
  const known = (list: { id: string }[]) => (a.item && list.some((i) => i.id === a.item) ? null : `No item ${a.item ?? '(item missing)'} on this trip.`);
  switch (action) {
    case 'notes':
      return a.text === undefined ? 'text is required.' : { notes: (a.replace || !t.notes ? a.text : `${t.notes}\n${a.text}`).slice(0, 20_000) };
    case 'plan_add':
      return a.plan?.title && a.plan.day && DAY.test(a.plan.day) ? { plan: [...plan, a.plan] } : 'plan needs a title and a day as YYYY-MM-DD.';
    case 'plan_edit':
      return known(plan) ?? (a.plan?.day && !DAY.test(a.plan.day) ? 'day must be YYYY-MM-DD.' : { plan: plan.map((p) => (p.id === a.item ? { ...p, ...a.plan } : p)) });
    case 'plan_remove':
      return known(plan) ?? { plan: plan.filter((p) => p.id !== a.item) };
    case 'check_add':
      return a.text?.trim() ? { checklist: [...checklist, { id: '', text: a.text, done: false }] } : 'text is required.';
    case 'check_set':
      return known(checklist) ?? (a.done === undefined ? 'done is required.' : { checklist: checklist.map((c) => (c.id === a.item ? { ...c, done: a.done! } : c)) });
    case 'check_remove':
      return known(checklist) ?? { checklist: checklist.filter((c) => c.id !== a.item) };
  }
}

export const travelTool = defineTool({
  name: 'travel',
  description: "Read or change the user's trips in AgentView. get without trip lists the trips and the home address; get with trip returns its itinerary, checklist, receipts and notes with item ids. notes appends text as a new line, or replaces the notes with replace. plan_add, plan_edit and plan_remove change the itinerary (plan_add needs day and title); check_add, check_set (with done) and check_remove change the checklist, which the trip page shows. home saves the user's start address in text, empty to clear it.",
  schema: {
    action: z.enum(ACTIONS),
    trip: z.string().optional().describe('Trip id'),
    item: z.string().optional().describe('Plan or checklist item id'),
    text: z.string().optional().describe('Notes line, checklist text or home address'),
    replace: z.boolean().optional().describe('notes only: true replaces the notes'),
    done: z.boolean().optional().describe('check_set only'),
    plan: PLAN.optional().describe('plan_add and plan_edit; plan_edit changes only the keys given'),
  },
  async handler(args) {
    const { action, trip } = args;
    if (action === 'home') {
      if (args.text === undefined) return 'text is required.';
      await setHome(args.text);
      return 'Saved.';
    }
    const data = await travelData();
    const home = `Home: ${data.home || 'not set'}`;
    if (action === 'get' && !trip) return [...data.trips.map((t) => `${t.id} | ${t.name} | ${tripRange(t)}`), home].join('\n');
    const found = data.trips.find((t) => t.id === trip);
    if (!found) return `No trip ${trip ?? '(trip missing)'}.`;
    if (action === 'get') return `${tripText(found, data.receipts.filter((r) => r.tripId === found.id))}\n${home}`;
    const failed: string[] = [];
    const saved = await updateTrip(found.id, (t) => {
      const c = change(t, action, args);
      if (typeof c !== 'string') return c;
      failed.push(c);
      return {};
    });
    return failed[0] ?? (saved ? 'Saved.' : `No trip ${trip}.`);
  },
});
