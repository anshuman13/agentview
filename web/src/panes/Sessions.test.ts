import { describe, expect, it } from 'vitest';
import { buildFolders, findHere } from './Sessions';
import type { Repo, SavedSession, Worktree } from '../../../shared/protocol';

const repo = (name: string, lastCommit = 0): Repo => ({ name, root: 'workspace', cwd: `/w/${name}`, branch: 'main', dirty: 0, lastCommit, paseo: false });
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
