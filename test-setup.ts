import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.tmpdir(), `agentview-test-env-${process.pid}`);
process.env.AGENTVIEW_LIMITS_DIR = dir;
process.env.AGENTVIEW_ALT_CLAUDE = path.join(dir, 'alt');
process.env.AGENTVIEW_FINDINGS_DIR = dir;
process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');

const { afterAll } = process.env.VITEST ? await import('vitest') : await import('bun:test');
afterAll(() => rmSync(dir, { recursive: true, force: true }));
