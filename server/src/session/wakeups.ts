import type { Cron } from '../agent/types.js';
import { after, fireTime, restorePrompt } from './repeat.js';
import type { AgentSession } from './session.js';

export class Wakeups {
  private wokeAt = 0;
  private closed = false;
  private timers = new Set<NodeJS.Timeout>();

  constructor(private s: AgentSession) {}

  woke() {
    this.wokeAt = Date.now();
  }

  close() {
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  // Scheduled jobs live in the CLI process, so a new process has to create them again. The loop does not take this prompt as a task.
  restore(crons: Cron[], why = 'AgentView restarted') {
    this.s.crons = crons;
    this.s.system(`${why}, so Claude is recreating ${crons.length} scheduled ${crons.length === 1 ? 'job' : 'jobs'}`);
    this.s.prompts.orQueue(restorePrompt(crons, why));
  }

  rearm() {
    const since = Date.now();
    for (const c of this.s.crons.filter((x) => !x.recurring)) {
      const at = fireTime(c.schedule, since);
      if (at === null) continue;
      const timer = after(at + 5000, () => {
        this.timers.delete(timer);
        this.fire(c, since);
      });
      this.timers.add(timer);
    }
  }

  private fire(c: Cron, since: number) {
    if (this.closed || this.wokeAt > since || this.s.crons.some((x) => !x.recurring && x.prompt === c.prompt && x.schedule !== c.schedule)) return;
    // Each compaction arms its own check; the first to send counts as the wakeup for the rest.
    this.wokeAt = Date.now();
    this.s.system('Compacting dropped the scheduled wakeup, so AgentView sent it');
    void this.s.prompt(c.prompt);
  }
}
