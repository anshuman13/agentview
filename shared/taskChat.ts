// The first message of a chat started from a task: its title, then its notes and its link, each after a blank line.
export const taskChatPrompt = ({ title, text, sourceUrl }: { title?: string | null; text?: string | null; sourceUrl?: string | null }) =>
  [title, text, sourceUrl].map((s) => s?.trim()).filter(Boolean).join('\n\n');
