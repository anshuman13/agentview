import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_LABEL, type Account, type PublicSettings } from '../../shared/protocol.js';
import { readJsonSync, writeJson } from './json.js';

export const SETTINGS_FILE = process.env.AGENTVIEW_SETTINGS ?? path.join(os.homedir(), '.agentview/settings.json');

// owner: the name in auto-replies. hubUrl: how phones and other Macs reach the hub. deployUrl: the base URL of the deploy
// service; empty turns Deploy off. accountLabels: names for the Claude accounts.
export type Settings = { owner: string; hubUrl: string; deployUrl: string; accountLabels: Partial<Record<Account, string>> };

export const EMPTY_SETTINGS: Settings = { owner: '', hubUrl: '', deployUrl: '', accountLabels: {} };

export const loadSettings = (): Settings => ({ ...EMPTY_SETTINGS, ...readJsonSync<Partial<Settings>>(SETTINGS_FILE, {}) });

export const saveSettings = (s: Settings) => writeJson(SETTINGS_FILE, s, { pretty: true });

export const ownerName = () => loadSettings().owner || 'the owner';

export const deployUrl = () => loadSettings().deployUrl.replace(/\/+$/, '');

export const accountLabels = (s = loadSettings()): Record<Account, string> => ({ ...ACCOUNT_LABEL, ...s.accountLabels });

export const applyAccountLabels = () => Object.assign(ACCOUNT_LABEL, accountLabels());

export const publicSettings = (): PublicSettings => ({ deploy: !!deployUrl(), accountLabels: accountLabels() });
