import { AgentSession } from '../../session/session.js';
import { reopenAccount } from './accounts.js';
import { claudeDriver } from './driver.js';

// A session on a Claude driver, for tests.
export const claudeSession = (cwd: string, resume?: string, fork = false, account = reopenAccount(resume, cwd)) => new AgentSession(cwd, claudeDriver(cwd, resume, fork, false, account), resume ?? null);
