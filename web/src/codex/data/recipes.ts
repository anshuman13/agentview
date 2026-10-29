import { save, stored } from '../../ui/util';

export type Recipe = { id: string; title: string; text: string };

const KEY = 'codex.recipes';

export const DEFAULT_RECIPES: Recipe[] = [
  { id: 'week', title: "Summarize this week's meetings", text: "Summarize this week's meetings: key points, decisions and follow-ups." },
  { id: 'committed', title: 'What did I commit to?', text: 'What did I commit to in recent meetings and chats, and what is still open?' },
  { id: 'decisions', title: 'Open decisions', text: 'List the open decisions, who owns each, and what is blocking them.' },
];

export const savedRecipes = (): Recipe[] => stored<Recipe[]>(KEY, []);
export const allRecipes = (): Recipe[] => [...savedRecipes(), ...DEFAULT_RECIPES];

export function saveRecipe(text: string, title = text.slice(0, 60)) {
  const t = text.trim();
  if (!t) return;
  save(KEY, [{ id: `r${Date.now().toString(36)}`, title, text: t }, ...savedRecipes().filter((r) => r.text !== t)]);
}

export function recipeQuery(input: string): string | null {
  return input.startsWith('/') ? input.slice(1).trim().toLowerCase() : null;
}

export function matchRecipes(recipes: Recipe[], input: string): Recipe[] {
  const q = recipeQuery(input);
  if (q === null) return [];
  const words = q.split(/\s+/).filter(Boolean);
  return recipes.filter((r) => words.every((w) => r.title.toLowerCase().includes(w) || r.text.toLowerCase().includes(w)));
}
