import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_LABEL, type Account, type PublicSettings } from '../../shared/protocol.js';
import { readJsonSync, writeJson } from './json.js';

export const SETTINGS_FILE = process.env.AGENTVIEW_SETTINGS ?? path.join(os.homedir(), '.agentview/settings.json');

// owner: the name in auto-replies. hubUrl: how phones and other Macs reach the hub. deployUrl: the base URL of the deploy
// service; empty turns Deploy off. accountLabels: names for the Claude accounts. roots: the folders holding repos.
// personalRoot: the folder whose chats use the personal profile and account, also a root; empty means all work.
export type Settings = { owner: string; hubUrl: string; deployUrl: string; accountLabels: Partial<Record<Account, string>>; roots: string[]; personalRoot: string };

export const EMPTY_SETTINGS: Settings = { owner: '', hubUrl: '', deployUrl: '', accountLabels: {}, roots: ['~/workspace'], personalRoot: '' };

const expandHome = (dir: string) => path.resolve(dir.replace(/^~/, os.homedir()));

export const personalRoot = (s = loadSettings()) => (s.personalRoot ? expandHome(s.personalRoot) : '');

export const workspaceRoots = (s = loadSettings()) => [...new Set([...s.roots.map(expandHome), personalRoot(s)].filter(Boolean))];

export const loadSettings = (): Settings => ({ ...EMPTY_SETTINGS, ...readJsonSync<Partial<Settings>>(SETTINGS_FILE, {}) });

export const saveSettings = (s: Settings) => writeJson(SETTINGS_FILE, s, { pretty: true });

export const ownerName = () => loadSettings().owner || 'the owner';

export const deployUrl = () => loadSettings().deployUrl.replace(/\/+$/, '');

export const accountLabels = (s = loadSettings()): Record<Account, string> => ({ ...ACCOUNT_LABEL, ...s.accountLabels });

export const applyAccountLabels = () => Object.assign(ACCOUNT_LABEL, accountLabels());

export const publicSettings = (): PublicSettings => ({ deploy: !!deployUrl(), accountLabels: accountLabels(), personalRoot: personalRoot(), roots: workspaceRoots().map((r) => path.basename(r)) });
