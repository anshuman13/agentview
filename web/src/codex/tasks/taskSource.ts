import { isSaid, type ItemRow } from '../data/sync';

const SOURCES: Record<string, { icon: string; label: string }> = {
  slack: { icon: 'comment-discussion', label: 'Slack' },
  linear: { icon: 'issues', label: 'Linear' },
  gmail: { icon: 'mail', label: 'Gmail' },
  mail: { icon: 'mail', label: 'Mail' },
  calendar: { icon: 'calendar', label: 'Calendar' },
  meeting: { icon: 'record', label: 'Meeting' },
  action: { icon: 'checklist', label: 'Meeting' },
  github: { icon: 'github', label: 'GitHub' },
  capture: { icon: 'edit', label: 'You' },
  job: { icon: 'history', label: 'Job' },
  chat: { icon: 'sparkle', label: 'Chat' },
};
export const channelOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };
export const sourceOf = (r: ItemRow) => (isSaid(r) ? { icon: 'reply', label: 'You said' } : channelOf(r));
// The link to a task's source: a meeting task links to its transcript.
export const sourceLink = (r: ItemRow) => { const s = sourceOf(r); return r.meeting_id ? { ...s, label: 'Transcript' } : s; };
