import { describe, expect, it } from 'bun:test';
import { taskBrief } from '../../../../shared/build';
import { chainSpec, foldRows, parseBrief, specTasks, subChatRow, subChatTitle, type SubChat } from './subChatsLogic';

const SPEC = '.claude/specs/x.md';
const MD = 'Goal: x\n\n## Requirements\n\n- [ ] not a task\n\n## Tasks\n\n- [x] Add the store\n- [~] Wire it up (blocked)\n- [ ] Write docs\n\n## After\n- [ ] no';

describe('subChatTitle', () => {
  it('reads the task number from a build brief', () => {
    expect(parseBrief(taskBrief(SPEC, 2, 3, true))).toEqual({ n: 2, of: 3, spec: SPEC });
    expect(subChatTitle(taskBrief(SPEC, 1, 3, false), specTasks(MD))).toBe('Task 1 of 3: Add the store');
    expect(subChatTitle(taskBrief(SPEC, 9, 9, false), specTasks(MD))).toBe('Task 9 of 9');
    expect(subChatTitle(taskBrief(SPEC, 1, 2, false), specTasks(MD))).toBe('Task 1 of 2');
    expect(subChatTitle(taskBrief(SPEC, 2, 3, false))).toBe('Task 2 of 3');
  });

  it('uses the first prompt on one line without mentions', () => {
    expect(subChatTitle('fix @web/src/a.ts the\n  header  @b')).toBe('fix the header');
    expect(subChatTitle('')).toBe('Untitled');
  });
});

describe('specTasks', () => {
  it('reads only the Tasks section', () => {
    expect(specTasks(MD)).toEqual(['Add the store', 'Wire it up (blocked)', 'Write docs']);
  });
});

describe('subChatRow', () => {
  const sub: SubChat = {
    sessionId: 's1',
    title: taskBrief(SPEC, 1, 3, true),
    startedAt: 1,
    round: { n: 1, at: 2, outcome: 'done', line: 'added the store' },
    commit: { hash: 'a1b2c3d4e5f6', subject: 'Add the store' },
  };

  it('joins title, round and commit, leaving out empty parts', () => {
    expect(subChatRow(sub, specTasks(MD))).toEqual(['Task 1 of 3: Add the store', 'done: added the store', 'a1b2c3d Add the store']);
    expect(subChatRow({ sessionId: 's2', title: 'hi', startedAt: 1 })).toEqual(['hi']);
  });

  it('finds the spec of the chain', () => {
    expect(chainSpec([{ sessionId: 'r', title: '/build x', startedAt: 0 }, sub])).toBe(SPEC);
    expect(chainSpec([{ sessionId: 'r', title: 'hi', startedAt: 0 }])).toBeNull();
  });
});

describe('foldRows', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7];
  it('keeps the last 5 until unfolded', () => {
    expect(foldRows(rows, false)).toEqual({ shown: [3, 4, 5, 6, 7], hidden: 2 });
    expect(foldRows(rows, true)).toEqual({ shown: rows, hidden: 0 });
    expect(foldRows([1, 2], false)).toEqual({ shown: [1, 2], hidden: 0 });
  });
});
