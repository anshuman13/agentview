import type { SavedSession } from './protocol';

// A chat matches when every word of the query is, ignoring case, in its title, repo name, or the title, first prompt, summary or branch of its saved copy. shared/fixtures/chat-search.json holds the cases.
export function chatMatches(query: string, title: string, saved: Pick<SavedSession, 'title' | 'firstPrompt' | 'summary' | 'gitBranch'> | null | undefined, repo: string | null | undefined): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [title, saved?.title, saved?.firstPrompt, saved?.summary, saved?.gitBranch, repo].join(' ').toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
}
