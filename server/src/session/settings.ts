import { ACCOUNT_LABEL, ACCOUNT_NOTE, EFFORT_LEVELS, type Account, type Effort } from '../../../shared/protocol.js';
import { errText } from '../../../shared/util.js';
import type { AgentSession } from './session.js';

export class SessionSettings {
  constructor(private s: AgentSession) {}

  async setModel(model: string) {
    const r = await this.s.driver.setModel(model);
    this.s.setSession(r);
    this.s.system(r.team ? 'Team mode: Opus plans each task, Sonnet 5.5 builds it with Opus advising, Fable only with your OK' : `Model set to ${model}`);
  }

  async setEffort(level: string) {
    if (!EFFORT_LEVELS.includes(level as Effort)) return;
    await this.s.driver.setEffort(level as Effort);
    this.s.setSession({ effort: level as Effort });
    this.s.system(`Effort set to ${level}`);
  }

  setAccount(a: string) {
    const { driver, state } = this.s;
    const accounts = driver.accounts();
    if (!accounts.includes(a as Account)) return this.s.system('That Claude account is not logged in. Run ./claude-alt.sh first');
    if (state.session.running) return this.s.system('Stop Claude before switching account');
    if (a === driver.account) return;
    driver.setAccount(a as Account);
    this.s.setSession({ account: a as Account, accounts });
    const note = ACCOUNT_NOTE[a as Account];
    this.s.system(`Switched to the ${ACCOUNT_LABEL[a as Account]} Claude account${note ? `. ${note}` : ''}`);
  }

  async setPermissionMode(mode: string) {
    await this.s.driver.setPermissionMode(mode);
    this.s.setSession({ permissionMode: mode });
    this.s.system(`Permission mode: ${mode}`);
  }

  // A message that cannot start in plan mode waits in the queue, where Send now retries it.
  async planFirst() {
    const { team, permissionMode } = this.s.state.session;
    if (!team || permissionMode === 'plan') return true;
    try {
      await this.setPermissionMode('plan');
      return true;
    } catch (err) {
      this.s.system(`Could not switch to plan mode (${errText(err)}), so the message is queued`);
      return false;
    }
  }
}
