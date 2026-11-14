import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_LABEL, type Account, type Provider, type PublicSettings } from '../../shared/protocol.js';
import { hideableIds } from '../../shared/featureUse.js';
import { readJsonSync, writeJson } from './json.js';

export const SETTINGS_FILE = process.env.AGENTVIEW_SETTINGS ?? path.join(os.homedir(), '.agentview/settings.json');

// owner: the name in auto-replies. hubUrl: how phones and other Macs reach the hub. deployUrl: the base URL of the deploy
// service; empty turns Deploy off. accountLabels: names for the Claude accounts. roots: the folders holding repos.
// personalRoot: the folder whose chats use the personal profile and account, also a root; empty means all work.
// defaultProvider: what a new chat runs on when the client does not pick one. featureUse: whether this Mac counts which features are used. hiddenFeatures: the ids the user hid from the app.
export type UnattendedLimits = { allowWrite: string[]; allowedDomains: string[] };

// unattended: what a scheduled coding chat may write and fetch, besides its worktree.
export type Settings = { unattended: UnattendedLimits; owner: string; hubUrl: string; deployUrl: string; accountLabels: Partial<Record<Account, string>>; roots: string[]; personalRoot: string; defaultProvider: Provider; featureUse: boolean; hiddenFeatures: string[] };

export const UNATTENDED_DOMAINS = ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org'];

export const EMPTY_SETTINGS: Settings = { unattended: { allowWrite: [], allowedDomains: UNATTENDED_DOMAINS }, owner: '', hubUrl: '', deployUrl: '', accountLabels: {}, roots: ['~/workspace'], personalRoot: '', defaultProvider: 'claude', featureUse: false, hiddenFeatures: [] };

// Paths go to the hub Mac relative to the home folder, so they resolve under its own home.
export const homeRelative = (p: string) => (p === os.homedir() || p.startsWith(`${os.homedir()}/`) ? `~${p.slice(os.homedir().length)}` : p);
export const expandHome = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir());
const resolveHome = (dir: string) => path.resolve(expandHome(dir));

export const personalRoot = (s = loadSettings()) => (s.personalRoot ? resolveHome(s.personalRoot) : '');

export const workspaceRoots = (s = loadSettings()) => [...new Set([...s.roots.map(resolveHome), personalRoot(s)].filter(Boolean))];

const strings = (v: unknown, fallback: string[], name: string, log: (line: string) => void) => {
  if (v === undefined) return fallback;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  log(`settings: unattended.${name} is not a list of strings, using the default`);
  return fallback;
};

const reachesThisMac = (d: string) => /^(\*|localhost|(.+\.)?(localhost|local|netbird\.cloud))$/i.test(d) || net.isIP(d.replace(/^\[|\]$/g, '')) > 0;

// The limits of an unattended chat. Domains that reach this Mac or its NetBird peers are dropped, so the chat cannot call the server or the hub.
export function unattendedLimits(raw: unknown, log: (line: string) => void = console.error): UnattendedLimits {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const domains = strings(o.allowedDomains, UNATTENDED_DOMAINS, 'allowedDomains', log);
  const dropped = domains.filter(reachesThisMac);
  if (dropped.length) log(`settings: unattended.allowedDomains dropped ${dropped.join(', ')}`);
  return { allowWrite: strings(o.allowWrite, [], 'allowWrite', log).map(resolveHome), allowedDomains: domains.filter((d) => !reachesThisMac(d)) };
}

export const loadSettings = (): Settings => ({ ...EMPTY_SETTINGS, ...readJsonSync<Partial<Settings>>(SETTINGS_FILE, {}) });

export const saveSettings = (s: Settings) => writeJson(SETTINGS_FILE, s, { pretty: true });

export const ownerName = () => loadSettings().owner || 'the owner';

export const deployUrl = () => loadSettings().deployUrl.replace(/\/+$/, '');

export const accountLabels = (s = loadSettings()): Record<Account, string> => ({ ...ACCOUNT_LABEL, ...s.accountLabels });

export const applyAccountLabels = () => Object.assign(ACCOUNT_LABEL, accountLabels());

export const publicSettings = (): PublicSettings => ({ deploy: !!deployUrl(), accountLabels: accountLabels(), personalRoot: personalRoot(), defaultProvider: loadSettings().defaultProvider, featureUse: loadSettings().featureUse, hiddenFeatures: hideableIds(loadSettings().hiddenFeatures), roots: workspaceRoots().map((r) => path.basename(r)) });
