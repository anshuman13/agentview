import type { ItemRow } from './data/sync';

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
};
export const sourceOf = (r: ItemRow) => SOURCES[r.source ?? 'capture'] ?? { icon: 'circle-small', label: r.source ?? '' };
