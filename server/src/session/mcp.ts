import { errText } from '../../../shared/util.js';
import type { AgentSession } from './session.js';

export class Mcp {
  constructor(private s: AgentSession) {}

  async refresh() {
    const list = await this.s.driver.mcpStatus();
    if (list) this.s.setSession({ mcp: list });
  }

  async reconnect(name: string) {
    await this.s.driver.reconnectMcp(name).catch((err) => this.s.system(`Reconnecting ${name} failed: ${errText(err)}`));
    await this.refresh();
  }

  async toggle(name: string, enabled: boolean) {
    await this.s.driver.toggleMcp(name, enabled).catch((err) => this.s.system(`${enabled ? 'Enabling' : 'Disabling'} ${name} failed: ${errText(err)}`));
    await this.refresh();
  }

  async add(name: string, def: unknown) {
    const r = await this.s.driver.addMcp(name, def);
    await this.refresh();
    return r;
  }

  login(name: string) {
    return this.s.driver.loginMcp(name);
  }
}
