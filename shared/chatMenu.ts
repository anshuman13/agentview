export const reviewLabel = (running: boolean, hasChanges: boolean) =>
  running ? 'Review changes · Agent is working' : hasChanges ? 'Review changes' : 'Review changes · No changes';

