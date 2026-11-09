import { ACCOUNT_LABEL } from '../../../shared/protocol.js';
import { clock } from '../../../shared/util.js';
import type { AgentSession } from './session.js';

const CONTINUE = 'You hit a usage limit and now run on another Claude account. Continue where you stopped.';

export class UsageLimit {
  reset: number | null = null;

  constructor(private s: AgentSession) {}

  clear() {
    this.reset = null;
  }

  // The turn ends like one that hit the usage limit; false when a limit was already noted.
  note(until: number) {
    const s = this.s;
    if (this.reset) return false;
    // A report while idle (a background agent) has no turn to end, so the account changes now.
    if (!s.state.session.running) {
      const from = s.driver.account;
      const to = this.hit(until);
      s.system(`Usage limit reported on the ${ACCOUNT_LABEL[from]} account${to ? `, next turn runs on the ${ACCOUNT_LABEL[to]} account` : ''}`);
      return true;
    }
    this.reset = until;
    return true;
  }

  // A turn that ended on a usage limit goes on under the other account, if it has usage left.
  failOver() {
    if (!this.reset) return false;
    const from = this.s.driver.account;
    const to = this.hit(this.reset);
    if (!to) return false;
    this.s.system(`Usage limit on the ${ACCOUNT_LABEL[from]} account until ${clock(this.reset)}, continuing on the ${ACCOUNT_LABEL[to]} account`);
    this.s.sendPrompt(CONTINUE);
    return true;
  }

  private hit(until: number) {
    const to = this.s.driver.limitHit(until);
    if (to) this.s.setSession({ account: to, accounts: this.s.driver.accounts() });
    return to;
  }
}
