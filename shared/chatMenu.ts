export const reviewLabel = (running: boolean, hasChanges: boolean) =>
  running ? 'Review changes · Agent is working' : hasChanges ? 'Review changes' : 'Review changes · No changes';


// Claude's output styles as Claude.app lists them; Default is the CLI's 'default'.
export const OUTPUT_STYLES = ['Default', 'Proactive', 'Concise', 'Explanatory', 'Learning'];
export const outputStyleValue = (label: string) => (label === 'Default' ? 'default' : label);
export const outputStyleLabel = (value: string | null | undefined) => OUTPUT_STYLES.find((l) => outputStyleValue(l) === value) ?? 'Default';
