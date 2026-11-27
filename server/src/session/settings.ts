import { ACCOUNT_LABEL, ACCOUNT_NOTE, EFFORT_LEVELS, type Account, type Effort } from '../../../shared/protocol.js';
import { providerLabel, startModeFor } from '../../../shared/providers.js';
import os from 'node:os';
import path from 'node:path';
import { statSync } from 'node:fs';
import type { AgentSession } from './session.js';

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export class SessionSettings {
  constructor(private s: AgentSession) {}

  async setModel(model: string) {
    const r = await this.s.driver.setModel(model);
    this.s.setSession(r);
    this.s.system(`Model set to ${model}`);
  }

  async setEffort(level: string) {
    if (!EFFORT_LEVELS.includes(level as Effort)) return;
    const { model, models } = this.s.state.session;
    const efforts = models.find((m) => m.value === model)?.efforts;
    if (efforts && !efforts.includes(level)) return this.s.system(`${model} does not support ${level} effort`, true);
    await this.s.driver.setEffort(level as Effort);
    this.s.setSession({ effort: level as Effort });
    this.s.system(`Effort set to ${level}`);
  }

  setAccount(a: string) {
    const { driver, state } = this.s;
    const accounts = driver.accounts();
    if (!accounts.includes(a as Account)) return this.s.system('That Claude account is not logged in. Run ./claude-alt.sh first');
    if (state.session.running) return this.s.system(`Stop ${providerLabel(driver.provider)} before switching account`);
    if (a === driver.account) return;
    driver.setAccount(a as Account);
    this.s.setSession({ account: a as Account, accounts });
    const note = ACCOUNT_NOTE[a as Account];
    this.s.system(`Switched to the ${ACCOUNT_LABEL[a as Account]} Claude account${note ? `. ${note}` : ''}`);
  }

  // A mode the provider does not offer becomes its Default, whichever client sent it.
  async setPermissionMode(asked: string) {
    const mode = startModeFor(asked, this.s.driver.provider)!;
    await this.s.driver.setPermissionMode(mode);
    this.s.setSession({ permissionMode: mode });
    this.s.system(`Permission mode: ${mode}`);
  }

  setDirs(asked: string[]) {
    const { driver, state } = this.s;
    if (!driver.setDirs) return this.s.system(`${providerLabel(driver.provider)} chats cannot add a folder`, true);
    if (state.session.running) return this.s.system(`Stop ${providerLabel(driver.provider)} before changing its folders`);
    const dirs = [...new Set(asked.map((d) => path.resolve(d.trim().replace(/^~(?=\/|$)/, os.homedir()))))].filter((d) => d !== path.resolve(this.s.cwd));
    const missing = dirs.find((d) => !isDir(d));
    if (missing) return this.s.system(`${missing} is not a folder`, true);
    const before = state.session.dirs ?? [];
    driver.setDirs(dirs);
    this.s.setSession({ dirs });
    const added = dirs.filter((d) => !before.includes(d));
    const removed = before.filter((d) => !dirs.includes(d));
    this.s.system([...added.map((d) => `Added folder ${d}`), ...removed.map((d) => `Removed folder ${d}`)].join('. ') || 'Folders unchanged');
  }

  setReview(on: boolean) {
    this.s.setSession({ review: on });
    this.s.system(`Review changes after each turn: ${on ? 'on' : 'off'}`);
  }
}
