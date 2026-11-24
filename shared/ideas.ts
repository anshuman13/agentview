// Muse's Ideas for Codex: open tasks an agent could take on, by the verb they start with.
const AGENT_VERBS = /^(draft|write|research|find|summari[sz]e|prepare|prep|review|check|look up|look into|compare|plan|read|reply|answer|investigate|analy[sz]e|update|fix|outline|collect|gather|list)\b/i;

export const IDEAS_SHOWN = 3;

export const canDelegate = (title: string | null | undefined) => AGENT_VERBS.test((title ?? '').trim());

// Dated tasks first, soonest due first, then undated ones; at most IDEAS_SHOWN, skipping the hidden keys.
export function pickIdeas<T extends { title: string | null; due: number | null; key: string }>(tasks: T[], hidden: string[]): T[] {
  return tasks.filter((t) => canDelegate(t.title) && !hidden.includes(t.key))
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
    .slice(0, IDEAS_SHOWN);
}

export const ideaTitle = (title: string) => `I can help: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
