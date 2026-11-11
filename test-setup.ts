import { afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), `agentview-test-env-${process.pid}`);
process.env.AGENTVIEW_LIMITS_DIR = dir;
process.env.AGENTVIEW_ALT_CLAUDE = path.join(dir, 'alt');
process.env.AGENTVIEW_ALT2_CLAUDE = path.join(dir, 'alt2');
process.env.AGENTVIEW_FINDINGS_DIR = dir;
process.env.AGENTVIEW_FEATURE_USE = path.join(dir, 'feature-use.json');
process.env.AGENTVIEW_SETTINGS = path.join(dir, 'settings.json');
mkdirSync(dir, { recursive: true });
// Tests never touch the real home folder; git still finds the user's identity.
process.env.GIT_CONFIG_GLOBAL ??= path.join(os.homedir(), '.gitconfig');
process.env.HOME = path.join(dir, 'home');
mkdirSync(process.env.HOME, { recursive: true });
// Bun reads HOME once at startup.
os.homedir = () => process.env.HOME!;
writeFileSync(process.env.AGENTVIEW_SETTINGS, JSON.stringify({ personalRoot: '~/workspace_personal' }));
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');

afterAll(() => rmSync(dir, { recursive: true, force: true }));
