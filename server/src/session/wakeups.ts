import { providerLabel } from '../../../shared/providers.js';
import type { Cron } from '../agent/types.js';
import type { AgentSession } from './session.js';

const MAX_TIMER = 2 ** 31 - 1;

// Node clamps setTimeout at 24.8 days and fires at once past it; longer waits go in chunks.
export function after(at: number, fn: () => void): NodeJS.Timeout {
  const left = at - Date.now();
  return setTimeout(() => (Date.now() >= at ? fn() : void after(at, fn)), Math.min(Math.max(0, left), MAX_TIMER));
}

export function fireTime(schedule: string, now = Date.now()) {
  const [m, h, dom, mon] = schedule.trim().split(/\s+/).slice(0, 4).map(Number);
  if ([m, h, dom, mon].some((n) => !Number.isInteger(n))) return null;
  const at = new Date(new Date(now).getFullYear(), mon - 1, dom, h, m);
  if (at.getTime() < now - 60_000) at.setFullYear(at.getFullYear() + 1);
  return at.getTime();
}

export const restorePrompt = (crons: Cron[], why: string) =>
  `${why}. It is now ${new Date().toString()}. Your scheduled jobs are below. First run CronList: a job that is still listed survived the restart but will not fire, so CronDelete it. Then CronCreate each job below once, with the same cron, prompt and recurring flag, so exactly one copy exists. If a one-shot job's time has already passed, run its prompt now instead. Reply in one line.\n\n${JSON.stringify(crons.map(({ schedule, prompt, recurring }) => ({ cron: schedule, prompt, recurring })), null, 2)}`;

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
    this.s.system(`${why}, so ${providerLabel(this.s.driver.provider)} is recreating ${crons.length} scheduled ${crons.length === 1 ? 'job' : 'jobs'}`);
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
