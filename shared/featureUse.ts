export type FeatureKind = 'page' | 'tab' | 'list' | 'palette' | 'sheet' | 'more' | 'action';
export type Feature = { id: string; label: string; kind: FeatureKind; hideable: boolean };
export type UseDays = Record<string, Record<string, number>>;
export type UsedFeature = Feature & { n7: number; n30: number; last: string };

const make = (kind: FeatureKind, rows: [string, string][], hideable: (id: string) => boolean = () => false): Feature[] => rows.map(([id, label]) => ({ id: `${kind}:${id}`, label, kind, hideable: hideable(id) }));

const PALETTE = make('palette', [
  ['view:explorer', 'Show Explorer'], ['view:changes', 'Show Source Control'], ['view:github', 'Show Pull Requests'], ['view:chats', 'Show Sessions'], ['view:sessions', 'Show Workspace'], ['view:runs', 'Show Runs'],
  ['tab:chat', 'Tab: Chat'], ['tab:code', 'Tab: Files'], ['tab:term', 'Tab: Terminal'], ['tab:browser', 'Tab: Browser'], ['tab:agents', 'Tab: Agents'],
  ['codex:today', 'Codex: Overview'], ['codex:tasks', 'Codex: Tasks'], ['codex:meetings', 'Codex: Meetings'], ['codex:jobs', 'Codex: Jobs'], ['codex:wiki', 'Codex: Wiki'], ['codex:summary', 'Codex: Slack summary'], ['codex:goals', 'Codex: All goals'], ['codex:search', 'Codex: Search'], ['codex:newtask', 'Codex: New task'],
  ['terminal', 'Toggle Terminal'], ['switchEditor', 'Switch File and Browser'], ['toggleSidebar', 'Toggle Left Sidebar'], ['toggleChat', 'Toggle Chat'], ['file', 'Go to File'], ['repo', 'Open Repository'],
  ['forkChat', 'Fork Chat'], ['compact', 'Compact Context'], ['loop', 'Toggle Build Cycle'], ['review', 'Toggle Review Changes'], ['goal', 'New goal'], ['goalFile', 'Run file as goal'], ['spec', 'Start with a spec'], ['stop', 'Stop the Agent'],
  ['theme', 'Toggle Theme'], ['notify', 'Toggle Notifications'], ['shortcuts', 'Keyboard shortcuts'], ['phone', 'Open on Phone'], ['restart', 'Restart Server When Agents Are Idle'],
  ['model', 'Pick a model'], ['effort', 'Pick an effort'], ['mode', 'Pick a permission mode'], ['newChat', 'New chat'], ['open', 'Open a chat, task, meeting or wiki page'],
], () => true);

export const FEATURES: Feature[] = [
  ...make('page', [['observe', 'Observe'], ['deploy', 'Deploy'], ['mcp', 'MCP Servers'], ['sketches', 'Sketches'], ['settings', 'Settings']], (id) => id !== 'settings'),
  ...make('tab', [['codex', 'Codex'], ['chat', 'Chat'], ['sessions', 'Sessions'], ['agents', 'Agents']]),
  ...make('list', [['overview', 'Overview'], ['tasks', 'Tasks'], ['meetings', 'Meetings'], ['jobs', 'Jobs'], ['wiki', 'Wiki']]),
  ...PALETTE,
  ...make('sheet', [['goal', 'Goal sheet'], ['needsYou', 'Needs you'], ['more', 'More']]),
  ...make('more', [['files', 'Files'], ['browser', 'Browser'], ['terminal', 'Terminal'], ['changes', 'Source Control'], ['github', 'Pull Requests']], () => true),
  ...make('action', [['startGoal', 'Start a goal'], ['approveRun', 'Approve a run'], ['approveSpec', 'Approve a spec phase'], ['runAll', 'Run all spec tasks'], ['runAsGoal', 'Run a spec as a goal'], ['startTask', 'Start a spec task']], (id) => id === 'runAll' || id === 'runAsGoal'),
];

export const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
const HIDEABLE_IDS = new Set(FEATURES.filter((f) => f.hideable).map((f) => f.id));

// The known hideable ids, once each; anything that is not a list gives none.
export const hideableIds = (ids: unknown): string[] => (Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => HIDEABLE_IDS.has(id)))] : []);
const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

const FAMILY_ALIAS: Record<string, string> = { pin: 'open' };

// Page commands are counted as pages, so they have no palette feature.
export function paletteFeature(commandId: string): string | null {
  const head = commandId.split(':')[0];
  const family = `palette:${FAMILY_ALIAS[head] ?? head}`;
  const id = FEATURE_IDS.has(family) ? family : `palette:${commandId}`;
  return FEATURE_IDS.has(id) ? id : null;
}

export const shownFeature = (id: string, hidden: readonly string[]) => !hidden.includes(id);

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

// The day in the local time of whoever counts it.
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

// Features with no count in the kept days, and the rest by uses in the last window days (fewest first), then by label.
export function featureRows(days: UseDays, today: string, window: 7 | 30): { never: Feature[]; used: UsedFeature[] } {
  const rows = new Map<string, UsedFeature>();
  const at = dayNumber(today);
  for (const [day, counts] of Object.entries(days)) {
    const age = at - dayNumber(day);
    for (const [id, n] of Object.entries(counts)) {
      const f = FEATURE_BY_ID.get(id);
      if (!f || n <= 0) continue;
      const row = rows.get(id) ?? { ...f, n7: 0, n30: 0, last: day };
      if (age < 7) row.n7 += n;
      if (age < 30) row.n30 += n;
      if (day > row.last) row.last = day;
      rows.set(id, row);
    }
  }
  const count = (r: UsedFeature) => (window === 7 ? r.n7 : r.n30);
  const byLabel = (a: Feature, b: Feature) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  return {
    never: FEATURES.filter((f) => !rows.has(f.id)).sort(byLabel),
    used: [...rows.values()].sort((a, b) => count(a) - count(b) || byLabel(a, b)),
  };
}
