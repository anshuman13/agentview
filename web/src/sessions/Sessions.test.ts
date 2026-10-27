import { describe, expect, it } from 'vitest';
import { buildFolders, findHere, groupByRepo, groupByKind, segmentOf } from './folders';
import type { LiveChat, Repo, SavedSession, Worktree } from '../../../shared/protocol';

const repo = (name: string, lastCommit = 0): Repo => ({ name, root: 'workspace', kind: 'other', cwd: `/w/${name}`, branch: 'main', dirty: 0, lastCommit, paseo: false });
const chat = (cwd: string, lastModified: number, id = cwd + lastModified): SavedSession => ({ sessionId: id, title: id, cwd, gitBranch: null, lastModified });
const tree: Worktree = { id: 'wt1', project: 'tienda', repo: '/w/tienda', name: 'anshuman/ast-1/shop', cwd: '/p/wt1', dirty: 0, lastActive: 0, removable: false };

describe('buildFolders', () => {
  it('groups chats under their repo, including subfolders', () => {
    const f = buildFolders([repo('tienda'), repo('comida')], [], [chat('/w/tienda', 5), chat('/w/tienda/web', 6)]);
    expect(f.find((x) => x.name === 'tienda')?.chats).toHaveLength(2);
  });

  it('does not mix up repos that share a name prefix', () => {
    const f = buildFolders([repo('tienda'), repo('tienda-web')], [], [chat('/w/tienda-web', 5)]);
    expect(f.find((x) => x.name === 'tienda')?.chats).toHaveLength(0);
    expect(f.find((x) => x.name === 'tienda-web')?.chats).toHaveLength(1);
  });

  it('puts worktrees and their chats under the repo', () => {
    const f = buildFolders([repo('tienda')], [tree], [chat('/p/wt1', 9)]);
    const t = f.find((x) => x.name === 'tienda')!;
    expect(t.trees).toEqual([tree]);
    expect(t.chats).toHaveLength(1);
  });

  it('keeps chats outside any repo in their own folder', () => {
    const f = buildFolders([repo('tienda')], [], [chat('/tmp/scratch', 3)]);
    expect(f.map((x) => x.cwd)).toContain('/tmp/scratch');
  });

  it('sorts by the latest commit or chat', () => {
    const f = buildFolders([repo('old', 1), repo('new', 2), repo('chatty', 0)], [], [chat('/w/chatty', 10)]);
    expect(f.map((x) => x.name)).toEqual(['chatty', 'new', 'old']);
  });
});

describe('findHere', () => {
  it('labels a worktree by its branch and the main checkout by its branch', () => {
    const f = buildFolders([repo('tienda')], [tree], []);
    expect(findHere(f, '/p/wt1')).toMatchObject({ label: 'anshuman/ast-1/shop', tree });
    expect(findHere(f, '/w/tienda/src').label).toBe('main');
  });
});

describe('groupByKind', () => {
  const now = 100 * 864e5;
  it('groups by kind in a fixed order, active repos first, then by name', () => {
    const f = buildFolders([repo('zeta', 1), repo('alpha', 2), { ...repo('dirty', 3), dirty: 2 }, { ...repo('branchy', 4), branch: 'x/y' }, { ...repo('shop', 5), kind: 'web' }, repo('chatting', 6)], [], []);
    const g = groupByKind(f, ['/w/chatting/sub'], now);
    expect(g.map((x) => x.kind)).toEqual(['web', 'other']);
    expect(g[1].items.map((x) => [x.f.name, x.active])).toEqual([['branchy', true], ['chatting', true], ['dirty', true], ['alpha', false], ['zeta', false]]);
  });

  it('puts personal repos in their own segment', () => {
    const f = buildFolders([repo('tienda'), { ...repo('agentview'), root: 'workspace_personal' }], [], [chat('/u/workspace_personal/x', 1)]);
    expect(f.map((x) => [x.name, segmentOf(x)])).toEqual([['x', 'personal'], ['tienda', 'work'], ['agentview', 'personal']]);
  });
});

describe('groupByRepo', () => {
  const live = (id: string, cwd: string, extra: Partial<LiveChat> = {}): LiveChat => ({ id, sessionId: id, cwd, title: id, running: false, pending: 0, status: '', lastActive: 1, ...extra });
  it('groups open and recent chats by repo and counts states', () => {
    const f = buildFolders([repo('tienda'), repo('comida')], [tree], []);
    const g = groupByRepo([live('a', '/p/wt1', { running: true, lastActive: 50 }), live('b', '/w/tienda', { pending: 1 })], [chat('/w/comida', 20), chat('/w/tienda/web', 10), chat('/w/tienda', 1, 'a')], f);
    expect(g.map((x) => x.name)).toEqual(['tienda', 'comida']);
    expect(g[0]).toMatchObject({ running: 1, waiting: 1 });
    expect(g[0].open.map((c) => c.id)).toEqual(['b', 'a']);
    expect(g[0].recent).toHaveLength(1);
  });
  it('filters by repo name or chat title', () => {
    const f = buildFolders([repo('tienda'), repo('comida')], [], []);
    const chats = [chat('/w/comida', 2, 'fix login'), chat('/w/tienda', 3, 'other')];
    expect(groupByRepo([], chats, f, 'tien').map((x) => x.name)).toEqual(['tienda']);
    expect(groupByRepo([], chats, f, 'LOGIN')[0].recent.map((c) => c.title)).toEqual(['fix login']);
  });
});
