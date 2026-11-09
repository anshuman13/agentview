import { inside } from './util.js';

// The folder whose chats use the personal profile and account; empty means every folder is work. Set at startup from
// ~/.agentview/settings.json (server) or /api/settings (web).
export const WORKSPACE = { personalRoot: '' };

export const profileOfPath = (cwd: string, root = WORKSPACE.personalRoot): 'personal' | 'work' => (root && inside(cwd, root) ? 'personal' : 'work');
