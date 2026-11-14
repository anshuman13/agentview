export const reviewLabel = (running: boolean, hasChanges: boolean) =>
  running ? 'Review changes · Agent is working' : hasChanges ? 'Review changes' : 'Review changes · No changes';

export function usageMenuLabel(account: string | null, week: number | null, fiveHour: number | null) {
  if (week === null && fiveHour === null) return null;
  const parts = [account, week !== null && `Week ${Math.round(week)}%`, fiveHour !== null && `5-hour ${Math.round(fiveHour)}%`].filter(Boolean);
  return `Usage · ${parts.join(' · ')}`;
}
