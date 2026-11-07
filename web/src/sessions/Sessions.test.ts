import { describe, expect, it } from 'vitest';
import { buildFolders, chatFinder, chatState, findHere, groupByRepo, groupByKind, segmentOf, since, staleKeys, unreadCount } from './folders';
import type { LiveChat, Repo, SavedSession, Worktree } from '../../../shared/protocol';

const repo = (name: string, lastCommit = 0): Repo => ({ name, root: 'workspace', kind: 'other', cwd: `/w/${name}`, branch: 'main', dirty: 0, lastCommit, paseo: false });
const chat = (cwd: string, lastModified: number, id = cwd + lastModified): SavedSession => ({ sessionId: id, title: id, cwd, gitBranch: null, lastModified });
const tree: Worktree = { id: 'wt1', project: 'shop', repo: '/w/shop', name: 'anshuman/ast-1/shop', cwd: '/p/wt1', dirty: 0, lastActive: 0, removable: false };

describe('buildFolders', () => {
  it('groups chats under their repo, including subfolders', () => {
    const f = buildFolders([repo('shop'), repo('cafe')], [], [chat('/w/shop', 5), chat('/w/shop/web', 6)]);
    expect(f.find((x) => x.name === 'shop')?.chats).toHaveLength(2);
  });

  it('does not mix up repos that share a name prefix', () => {
    const f = buildFolders([repo('shop'), repo('shop-web')], [], [chat('/w/shop-web', 5)]);
    expect(f.find((x) => x.name === 'shop')?.chats).toHaveLength(0);
    expect(f.find((x) => x.name === 'shop-web')?.chats).toHaveLength(1);
  });

  it('puts worktrees and their chats under the repo', () => {
    const f = buildFolders([repo('shop')], [tree], [chat('/p/wt1', 9)]);
    const t = f.find((x) => x.name === 'shop')!;
    expect(t.trees).toEqual([tree]);
    expect(t.chats).toHaveLength(1);
  });

  it('keeps chats outside any repo in their own folder', () => {
    const f = buildFolders([repo('shop')], [], [chat('/tmp/scratch', 3)]);
    expect(f.map((x) => x.cwd)).toContain('/tmp/scratch');
  });

  it('sorts by the latest commit or chat', () => {
    const f = buildFolders([repo('old', 1), repo('new', 2), repo('chatty', 0)], [], [chat('/w/chatty', 10)]);
    expect(f.map((x) => x.name)).toEqual(['chatty', 'new', 'old']);
  });
});

describe('findHere', () => {
  it('labels a worktree by its branch and the main checkout by its branch', () => {
    const f = buildFolders([repo('shop')], [tree], []);
    expect(findHere(f, '/p/wt1')).toMatchObject({ label: 'anshuman/ast-1/shop', tree });
    expect(findHere(f, '/w/shop/src').label).toBe('main');
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
    const f = buildFolders([repo('shop'), { ...repo('agentview'), root: 'workspace_personal' }], [], [chat('/u/workspace_personal/x', 1)]);
    expect(f.map((x) => [x.name, segmentOf(x)])).toEqual([['x', 'personal'], ['shop', 'work'], ['agentview', 'personal']]);
  });
});

describe('groupByRepo', () => {
  const live = (id: string, cwd: string, extra: Partial<LiveChat> = {}): LiveChat => ({ id, sessionId: id, cwd, title: id, running: false, pending: 0, status: '', lastActive: 1, ...extra });
  it('groups open and recent chats by repo and counts states', () => {
    const f = buildFolders([repo('shop'), repo('cafe')], [tree], []);
    const g = groupByRepo([live('a', '/p/wt1', { running: true, lastActive: 50 }), live('b', '/w/shop', { pending: 1 })], [chat('/w/cafe', 20), chat('/w/shop/web', 10), chat('/w/shop', 1, 'a')], f);
    expect(g.map((x) => x.name)).toEqual(['shop', 'cafe']);
    expect(g[0]).toMatchObject({ running: 1, waiting: 1 });
    expect(g[0].open.map((c) => c.id)).toEqual(['b', 'a']);
    expect(g[0].recent).toHaveLength(1);
  });
  it('leaves pinned chats out, live or saved, even when waiting', () => {
    const f = buildFolders([repo('shop')], [], []);
    const g = groupByRepo([live('a', '/w/shop', { pending: 1 }), live('b', '/w/shop')], [chat('/w/shop', 1, 'c'), chat('/w/shop', 2, 'd')], f, '', new Set(['a', 'c']));
    expect(g[0].open.map((c) => c.id)).toEqual(['b']);
    expect(g[0].recent.map((c) => c.sessionId)).toEqual(['d']);
    expect(g[0].waiting).toBe(0);
  });
  it('filters by repo name or chat title', () => {
    const f = buildFolders([repo('shop'), repo('cafe')], [], []);
    const chats = [chat('/w/cafe', 2, 'fix login'), chat('/w/shop', 3, 'other')];
    expect(groupByRepo([], chats, f, 'sho').map((x) => x.name)).toEqual(['shop']);
    expect(groupByRepo([], chats, f, 'LOGIN')[0].recent.map((c) => c.title)).toEqual(['fix login']);
  });
});

describe('chat search', () => {
  const live = (id: string, sessionId: string | null = null): LiveChat => ({ id, sessionId, cwd: '/w/shop', title: id, running: false, pending: 0, status: '', lastActive: 1 });
  const saved: SavedSession[] = [{ ...chat('/w/shop', 1, 's1'), title: 'Billing', firstPrompt: 'Fix the Invoice rounding' }];
  const f = buildFolders([repo('shop')], [], []);
  const names = (q: string, l: LiveChat[] = [], c = saved) => groupByRepo(l, c, f, q).flatMap((g) => [...g.open.map((x) => x.id), ...g.recent.map((x) => x.sessionId)]);
  it('matches words in the first prompt, split across fields, ignoring case', () => {
    expect(names('invoice')).toEqual(['s1']);
    expect(names('BILLING rounding')).toEqual(['s1']);
    expect(names('invoice nothing')).toEqual([]);
    expect(names('  ')).toEqual(['s1']);
  });
  it('does not match a saved chat without a first prompt on it', () => {
    expect(names('invoice', [], [{ ...saved[0], firstPrompt: undefined }])).toEqual([]);
  });
  it('finds a live chat through its saved copy only when it has a sessionId', () => {
    expect(names('invoice', [live('a', 's1')])).toEqual(['a']);
    expect(chatFinder('invoice', saved).match('b', null, 'shop')).toBe(false);
    expect(chatFinder('invoice', saved).match('b', 's1', 'shop')).toBe(true);
  });
});

describe('staleKeys', () => {
  const at = (n: number) => ({ repos: n, chats: n, trees: n });

  it('skips data younger than the minimum age', () => {
    expect(staleKeys(at(1_000_000), 1_029_999)).toEqual([]);
    expect(staleKeys(at(1_000_000), 1_030_000)).toHaveLength(3);
  });

  it('checks each resource on its own age', () => {
    expect(staleKeys({ repos: 1_000_000, chats: 960_000, trees: 1_000_000 }, 1_010_000)).toEqual(['chats']);
  });

});

describe('chatState', () => {
  const live = (o: Partial<LiveChat> = {}): LiveChat => ({ id: 'c1', sessionId: 's1', cwd: '/w/shop', title: 't', running: false, pending: 0, status: '', lastActive: 100, ...o });
  const seen = { s1: 50 };

  it('ranks needs you, failed, running in that order', () => {
    expect(chatState({ live: live({ pending: 1, failed: true, running: true }) }, seen)).toBe('needs');
    expect(chatState({ live: live({ failed: true, running: true }) }, seen)).toBe('failed');
    expect(chatState({ live: live({ running: true }) }, seen)).toBe('running');
  });

  it('shows nothing for a stalled running chat', () => {
    expect(chatState({ live: live({ running: true, stalled: true }) }, seen)).toBeNull();
  });

  it('is done only when activity is newer than the seen time', () => {
    expect(chatState({ live: live() }, seen)).toBe('done');
    expect(chatState({ live: live() }, { s1: 100 })).toBeNull();
    expect(chatState({ live: live() }, {})).toBeNull();
    expect(chatState({ live: live({ lastActive: 0 }) }, seen)).toBeNull();
  });

  it('uses the newer of the live and saved times', () => {
    const saved = chat('/w/shop', 200, 's1');
    expect(chatState({ live: live(), saved }, { s1: 150 })).toBe('done');
    expect(chatState({ live: live({ lastActive: 300 }), saved }, { s1: 250 })).toBe('done');
  });

  it('marks a saved chat done and never failed', () => {
    expect(chatState({ saved: chat('/w/shop', 200, 's1') }, seen)).toBe('done');
    expect(chatState({ saved: chat('/w/shop', 20, 's1') }, seen)).toBeNull();
  });

  it('clears once the chat is opened', () => {
    expect(chatState({ live: live() }, { s1: 150 })).toBeNull();
  });

  it('counts unread chats other than the viewed one', () => {
    const l = [live(), live({ id: 'c2', sessionId: 's2', pending: 1 }), live({ id: 'c3', sessionId: 's3' })];
    expect(unreadCount(l, 'c1', { s1: 50, s3: 500 }, 1)).toBe(2);
    expect(unreadCount(l, 'c2', { s1: 50, s3: 500 }, 0)).toBe(1);
  });
});

describe('since', () => {
  const now = new Date(2026, 5, 15, 14, 0).getTime();
  const back = (ms: number) => since(now - ms, now);

  it('words the elapsed time', () => {
    expect(back(30_000)).toBe('just now');
    expect(back(2 * 60_000)).toBe('2 min ago');
    expect(back(3 * 3_600_000)).toBe('3 h ago');
    expect(since(new Date(2026, 5, 14, 9, 0).getTime(), now)).toBe('yesterday');
    expect(back(3 * 864e5)).toBe('3 d ago');
    expect(back(14 * 864e5)).toBe('2 w ago');
  });
});
