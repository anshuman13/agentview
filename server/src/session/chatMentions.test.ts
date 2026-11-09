import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeTranscript } from '../agent/claude/chatMentions.js';
import { expandChatMentions } from './chatMentions.js';

describe('expandChatMentions', () => {
  it('appends the transcript path of each mentioned chat', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mentions-'));
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    mkdirSync(path.join(root, '-repo'));
    writeFileSync(path.join(root, '-repo', `${id}.jsonl`), '');
    const other = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const out = expandChatMentions(`like @chat:${id} and @chat:${other}`, (x) => claudeTranscript(x, [root, path.join(root, 'missing')]));
    expect(out).toContain(`its transcript is ${path.join(root, '-repo', `${id}.jsonl`)}`);
    expect(out).toContain(`@chat:${other} was not found.`);
    expect(expandChatMentions('no mention', () => null)).toBe('no mention');
  });

  it('resolves a chat of any provider through the lookup it is given', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(expandChatMentions(`see @chat:${id}`, () => '/codex/rollout.jsonl')).toContain('its transcript is /codex/rollout.jsonl');
  });
});
