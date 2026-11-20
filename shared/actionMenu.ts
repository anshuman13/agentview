// Which of a meeting action's menu items show for its status, on web and Android. Assign also needs the action's meeting. Delete shows for every status.
export function actionMenu(status: string): { notMine: boolean; assign: boolean; snooze: boolean } {
  const live = status === 'open' || status === 'suggested';
  return { notMine: live, assign: status === 'open', snooze: live };
}

// The More menu items of a task row in the Overview's Today list: an overdue row can move to today.
export function todayTaskMenu(late: boolean): string[] {
  return late ? ['moveToday', 'snooze', 'open'] : ['snooze', 'open'];
}

// Suggested actions grouped by meeting, else by source with a person's own promises ("said:" ids) apart, in first-seen order.
// A group never mixes profiles; its key is the profile and the meeting id or source.
export function actionGroups<T extends { id: string; profile: string; meeting_id?: string | null; source?: string | null }>(rows: T[]): { key: string; rows: T[] }[] {
  const groups: { key: string; rows: T[] }[] = [];
  for (const r of rows) {
    const key = `${r.profile}:${r.meeting_id || `source:${r.source ?? ''}${r.id.startsWith('said:') ? ':said' : ''}`}`;
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  return groups;
}
