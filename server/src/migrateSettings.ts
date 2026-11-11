import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loggedIn } from './agent/claude/accounts.js';
import { netbirdStatus } from './http/access.js';
import { detectDeployUrl } from './integrations/deploy.js';
import { EMPTY_SETTINGS, SETTINGS_FILE, saveSettings, type Settings } from './settings.js';
import { exec } from './exec.js';

const HUB_DB = path.join(os.homedir(), '.agentview/assistant/assistant.db');

// Before the settings file existed these values were fixed in the code. The first start without the file writes the ones that
// applied on this Mac (a hub here, a deploy service reachable, extra Claude accounts logged in), so nothing changes for it.
export async function migrateSettings() {
  if (existsSync(SETTINGS_FILE)) return;
  const s: Settings = { ...EMPTY_SETTINGS, deployUrl: await detectDeployUrl() };
  if (existsSync(HUB_DB)) {
    const name = await exec('git', ['config', '--global', 'user.name']).then((r) => r.stdout.trim().split(/\s+/)[0], () => '');
    const fqdn = (await netbirdStatus())?.fqdn;
    Object.assign(s, { owner: name || os.userInfo().username, hubUrl: fqdn ? `http://${fqdn}:7790` : '' });
  }
  if (loggedIn('alt') || loggedIn('alt2')) s.accountLabels = { main: 'Personal', alt: 'Work', alt2: 'Work Enterprise' };
  await saveSettings(s);
}
