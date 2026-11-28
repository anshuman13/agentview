import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'bun:test';
import { buildFolders, buildsState, type Folder, type RepoGroup, chatFinder, CHAT_MENU_KEYS, chatMenuItems, chatWindowUrl, chatState, doneChats, findHere, groupByRepo, groupChats, rowsById, groupByKind, groupGlance, holdOrder, newChatGroups, orderGroups, renameTitle, segmentOf, since, staleKeys, unreadCount, waitingChats } from './folders';
import { RepoRow } from './RepoRow';
import type { LiveChat, Repo, SavedSession, Worktree } from '../../../shared/protocol';
import { WORKSPACE } from '../../../shared/workspace';
import { setRoots } from '../app/store/roots';

const repo = (name: string, lastCommit = 0): Repo => ({ name, root: 'workspace', kind: 'other', cwd: `/w/${name}`, branch: 'main', dirty: 0, lastCommit, paseo: false });
const chat = (cwd: string, lastModified: number, id = cwd + lastModified): SavedSession => ({ sessionId: id, title: id, cwd, gitBranch: null, lastModified });
const tree: Worktree = { id: 'wt1', project: 'shop', repo: '/w/shop', name: 'dev/ast-1/shop', cwd: '/p/wt1', dirty: 0, lastActive: 0, removable: false };

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
    expect(findHere(f, '/p/wt1')).toMatchObject({ label: 'dev/ast-1/shop', tree });
    expect(findHere(f, '/w/shop/src').label).toBe('main');
  });

  it('picks the deepest folder, so a chat in a parent folder does not take over its repos', () => {
    const f = buildFolders([repo('shop')], [], [chat('/w', 9)]);
    expect(f[0].cwd).toBe('/w');
    expect(findHere(f, '/w/shop/src').folder?.cwd).toBe('/w/shop');
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
    WORKSPACE.personalRoot = '/u/workspace_personal';
    const f = buildFolders([repo('shop'), { ...repo('agentview'), cwd: '/u/workspace_personal/agentview' }], [], [chat('/u/workspace_personal/x', 1)]);
    expect(f.map((x) => [x.name, segmentOf(x)])).toEqual([['x', 'personal'], ['shop', 'work'], ['agentview', 'personal']]);
  });
});

describe('orderGroups', () => {
  const g = (key: string, last: number, waiting = 0) => ({ key, name: key, open: [], recent: [], last, running: 0, waiting });
  const keys = (x: ReturnType<typeof orderGroups>) => x.map((y) => y.key);
  it('puts Needs you first, then newest activity within each part', () => {
    expect(keys(orderGroups([g('a', 9), g('b', 1, 1), g('c', 5), g('d', 2, 1)]))).toEqual(['d', 'b', 'a', 'c']);
  });
  it('keeps the frozen order against newer activity', () => {
    expect(keys(orderGroups([g('a', 1), g('b', 9), g('c', 5)], ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
  });
  it('puts a group outside the frozen list first among the rest and skips missing keys', () => {
    expect(keys(orderGroups([g('a', 1), g('n', 0), g('b', 9)], ['gone', 'a', 'b']))).toEqual(['n', 'a', 'b']);
  });
  it('moves a frozen group that gains a Needs you chat to the top', () => {
    expect(keys(orderGroups([g('a', 1), g('b', 9), g('c', 5, 1)], ['a', 'b', 'c']))).toEqual(['c', 'a', 'b']);
  });
  it('returns nothing for no groups', () => {
    expect(orderGroups([], ['a'])).toEqual([]);
  });
});

describe('holdOrder', () => {
  const g = (key: string, last: number): RepoGroup => ({ key, name: key, open: [], recent: [], last, running: 0, waiting: 0 });
  it('keeps the order until the tab is shown again', () => {
    const held = holdOrder(null, [g('a', 1), g('b', 9)], true, 0);
    expect(holdOrder(held, [g('a', 99), g('b', 9)], true, 0)).toBe(held);
    expect(holdOrder(held, [g('a', 99), g('b', 9)], true, 1).groups).toEqual(['a', 'b']);
  });
  it('retakes the order once the saved chats load', () => {
    const early = holdOrder(null, [g('live', 5)], false, 0);
    const later = holdOrder(early, [g('live', 5), g('old', 1), g('busy', 9)], true, 0);
    expect(orderGroups([g('live', 5), g('old', 1), g('busy', 9)], later.groups).map((x) => x.key)).toEqual(['busy', 'live', 'old']);
  });
  it('holds the chat order inside a group', () => {
    const f = buildFolders([repo('shop')], [], []);
    const live = (id: string, lastActive: number): LiveChat => ({ id, sessionId: id, cwd: '/w/shop', title: id, running: true, pending: 0, status: '', lastActive });
    const held = holdOrder(null, groupByRepo([live('a', 2), live('b', 1)], [], f), true, 0);
    const ids = groupByRepo([live('a', 2), live('b', 9), live('n', 0)], [], f, '', new Set(), held.chats)[0].open.map((c) => c.id);
    expect(ids).toEqual(['n', 'a', 'b']);
  });
  it('shows one open row per chat group, the busiest', () => {
    const f = buildFolders([repo('shop')], [], []);
    const live = (id: string, running: boolean): LiveChat => ({ id, sessionId: id, cwd: '/w/shop', title: id, running, pending: 0, status: '', lastActive: 1 });
    const chats = groupChats([
      { sessionId: 'r', cwd: '/w/shop', title: 'r', lastModified: 1 },
      { sessionId: 's', cwd: '/w/shop', title: 's', lastModified: 2, parentId: 'r', via: 'build' },
    ] as SavedSession[]);
    expect(groupByRepo([live('r', false), live('s', true)], chats, f)[0].open.map((c) => c.id)).toEqual(['s']);
  });
  it('holds new groups and chats after their first appearance', () => {
    const held = holdOrder(null, [g('a', 1), g('b', 9)], true, 0);
    const added = holdOrder(held, [g('a', 1), g('b', 9), g('n', 0)], true, 0);
    expect(added.groups).toEqual(['n', 'b', 'a']);
    const again = holdOrder(added, [g('a', 99), g('b', 9), g('n', 5), g('m', 0)], true, 0);
    expect(again.groups).toEqual(['m', 'n', 'b', 'a']);
    expect(holdOrder(again, [g('a', 1), g('m', 0), g('n', 9)], true, 0)).toBe(again);
  });
});

describe('doneChats', () => {
  const live = (id: string, o: Partial<LiveChat> = {}): LiveChat => ({ id, sessionId: id, cwd: '/w/shop', title: id, running: false, pending: 0, status: '', lastActive: 100, ...o });
  it('lists live and saved chats with activity after the seen time', () => {
    const seen = { a: 50, b: 50, c: 50, d: 50, e: 150, g: 50 };
    const lives = [live('a'), live('b', { running: true }), live('c', { pending: 1 }), live('d', { failed: true })];
    expect(doneChats(lives, [chat('/w/shop', 100, 'e'), chat('/w/shop', 100, 'f'), chat('/w/shop', 100, 'g')], seen, new Map())).toEqual(['a', 'g']);
  });
  it('counts a live chat by the newer activity of its saved copy', () => {
    const quiet = live('h', { lastActive: 10 });
    const copy = chat('/w/shop', 100, 'h');
    expect(doneChats([quiet], [], { h: 50 }, new Map())).toEqual([]);
    expect(doneChats([quiet], [], { h: 50 }, new Map([['h', copy]]))).toEqual(['h']);
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

describe('sub-chats', () => {
  const live = (id: string, extra: Partial<LiveChat> = {}): LiveChat => ({ id: `live-${id}`, sessionId: id, cwd: '/w/shop', title: 'Build', running: false, pending: 0, status: '', lastActive: 1, ...extra });
  const saved = groupChats([
    chat('/w/shop', 10, 'r'),
    { ...chat('/w/shop', 20, 's1'), parentId: 'r', via: 'build', startedAt: 15 },
    { ...chat('/w/shop', 30, 's2'), parentId: 'r', via: 'build', startedAt: 25 },
    chat('/w/shop', 5, 'other'),
  ]);
  const f = buildFolders([repo('shop')], [], saved);
  it('shows one row per chat with the group activity and count label', () => {
    expect(saved.map((s) => [s.sessionId, s.lastModified, s.subs])).toEqual([['r', 30, '2 tasks'], ['other', 5, undefined]]);
    expect(f[0].chats.map((c) => c.sessionId)).toEqual(['r', 'other']);
  });
  it('counts an open chat on the latest sub-chat as its root row', () => {
    const g = groupByRepo([live('s2', { running: true })], saved, f);
    expect(g[0].open.map((c) => c.sessionId)).toEqual(['s2']);
    expect(g[0].recent.map((c) => c.sessionId)).toEqual(['other']);
    expect(groupByRepo([live('s2')], saved, f, '', new Set(['r']))[0].open).toEqual([]);
  });
  it('reads Done from the root seen time, else a member one', () => {
    const byId = rowsById(saved);
    expect(byId.get('s2')?.sessionId).toBe('r');
    expect(chatState({ saved: saved[0] }, { s1: 25 })).toBe('done');
    expect(chatState({ saved: saved[0] }, { s1: 40 })).toBe(null);
    expect(chatState({ saved: saved[0] }, { r: 0, s2: 40 })).toBe('done');
    expect(doneChats([live('s2')], [], { r: 20 }, byId)).toEqual(['r']);
  });
  it('takes the latest member mark unless the root is marked unread', () => {
    expect(chatState({ saved: saved[0] }, { r: 10, s2: 40 })).toBe(null);
    setRoots([{ sessionId: 's2', parentId: 'r' }]);
    expect(chatState({ live: live('s2', { lastActive: 50 }) }, { r: 0, s2: 60 })).toBe('done');
    expect(chatState({ live: live('s2', { lastActive: 50 }) }, { r: 60 })).toBe(null);
    setRoots([]);
  });
});

describe('builds', () => {
  const live = (id: string, extra: Partial<LiveChat> = {}): LiveChat => ({ id: `live-${id}`, sessionId: id, cwd: '/w/shop', title: id, running: false, pending: 0, status: '', lastActive: 1, ...extra });
  const saved = groupChats([
    chat('/w/shop', 10, 'p'),
    { ...chat('/w/shop', 20, 'b'), spawnedBy: 'p', startedAt: 15 },
    { ...chat('/w/shop', 30, 'b1'), parentId: 'b', via: 'build', startedAt: 25 },
  ]);
  const f = buildFolders([repo('shop')], [], saved);
  it('folds an open build chat into its parent row with its running and Needs you state', () => {
    expect(saved.map((s) => [s.sessionId, s.subs, s.members, s.buildMembers])).toEqual([['p', '1 build', ['p'], ['b', 'b1']]]);
    const g = groupByRepo([live('b1', { pending: 1 })], saved, f);
    expect(g[0].open).toEqual([]);
    expect(g[0].recent.map((s) => s.sessionId)).toEqual(['p']);
    expect(g[0].waiting).toBe(1);
    const both = groupByRepo([live('p'), live('b1', { running: true })], saved, f);
    expect(both[0].open.map((c) => c.sessionId)).toEqual(['p']);
    expect(both[0].running).toBe(1);
  });
  it('lifts the parent row into Needs you or Running and reads unread from the builds too', () => {
    expect(buildsState([live('b1', { pending: 1 })], saved[0].buildMembers)).toBe('needs');
    expect(buildsState([live('b', { running: true })], saved[0].buildMembers)).toBe('running');
    expect(buildsState([live('x', { pending: 1 })], saved[0].buildMembers)).toBe(null);
    expect(chatState({ saved: saved[0], builds: 'needs' }, {})).toBe('needs');
    expect(chatState({ live: live('p'), saved: saved[0], builds: 'running' }, {})).toBe('running');
    expect(chatState({ saved: saved[0] }, { p: 5, b1: 40 })).toBe(null);
    expect(chatState({ saved: saved[0] }, { p: 5 })).toBe('done');
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

describe('waitingChats', () => {
  const live = (id: string, cwd: string, pending: number, lastActive = 1): LiveChat => ({ id, sessionId: id, cwd, title: id, running: false, pending, status: '', lastActive });
  const f = buildFolders([repo('shop'), repo('cafe')], [], []);
  const l = [live('a', '/w/shop', 1, 1), live('b', '/w/cafe', 1, 2), live('c', '/w/shop', 0)];
  it('lists the waiting chats, newest first, and keeps those matching the search', () => {
    expect(waitingChats(l, [], f, '').map((c) => c.id)).toEqual(['b', 'a']);
    expect(waitingChats(l, [], f, 'sho').map((c) => c.id)).toEqual(['a']);
    expect(waitingChats(l, [], f, 'nothing')).toEqual([]);
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
    expect(back(2 * 60_000)).toBe('2m ago');
    expect(back(3 * 3_600_000)).toBe('3h ago');
    expect(since(new Date(2026, 5, 14, 9, 0).getTime(), now)).toBe('yesterday');
    expect(back(3 * 864e5)).toBe('3d ago');
    expect(back(14 * 864e5)).toBe('2w ago');
  });
});

describe('groupGlance', () => {
  const live = (id: string, o: Partial<LiveChat> = {}): LiveChat => ({ id, sessionId: id, cwd: '/w/shop', title: id, running: false, pending: 0, status: '', lastActive: 100, ...o });
  const f = buildFolders([repo('shop')], [], []);
  const seen = { fin: 50, fs: 50, old: 500 };
  it('counts running, needs and unread; failed and stalled count in none', () => {
    const l = [live('r', { running: true }), live('st', { running: true, stalled: true }), live('p', { pending: 1 }), live('fa', { failed: true }), live('fin', { lastActive: 200 }), live('old')];
    const g = groupByRepo(l, [chat('/w/shop', 300, 'fs'), chat('/w/shop', 20, 'x')], f)[0];
    expect(groupGlance(g, seen)).toEqual({ running: 1, needs: 1, unread: 2, last: 300 });
  });
  it('lets the live copy win over its saved copy', () => {
    const g = groupByRepo([live('r', { running: true })], [chat('/w/shop', 300, 'r')], f)[0];
    expect(groupGlance(g, { r: 50 })).toMatchObject({ running: 1, unread: 0 });
  });
  it('is empty for a group with nothing to show', () => {
    expect(groupGlance({ key: 'k', name: 'k', open: [], recent: [], last: 0, running: 0, waiting: 0 }, {})).toEqual({ running: 0, needs: 0, unread: 0, last: 0 });
  });
});

describe('newChatGroups', () => {
  it('ignores the first list and chats that only moved', () => {
    expect(newChatGroups(null, [['a', '/w/shop']])).toEqual([]);
    expect(newChatGroups(new Set(['a']), [['a', '/w/cafe']])).toEqual([]);
  });
  it('returns each group with a new chat once', () => {
    expect(newChatGroups(new Set(['a']), [['a', '/w/shop'], ['b', '/w/shop'], ['c', '/w/shop'], ['d', '/w/cafe']])).toEqual(['/w/shop', '/w/cafe']);
  });
});

describe('renameTitle', () => {
  it('saves trimmed text on Enter and blur', () => {
    expect(renameTitle('Enter', '  New  ', 'Old')).toBe('New');
    expect(renameTitle('blur', 'New', 'Old')).toBe('New');
  });

  it('returns nothing on Escape, empty or unchanged text', () => {
    expect(renameTitle('Escape', 'New', 'Old')).toBeUndefined();
    expect(renameTitle('Enter', '   ', 'Old')).toBeUndefined();
    expect(renameTitle('blur', ' Old ', 'Old')).toBeUndefined();
  });
});

describe('chatMenuItems', () => {
  it('gives Pin, Mark as unread, Rename and Archive distinct letter keys', () => {
    expect(CHAT_MENU_KEYS).toEqual({ pin: 'P', unread: 'U', rename: 'R', archive: 'A' });
  });

  const items = (failed: boolean, stalled: boolean) => chatMenuItems({ failed, stalled, canPin: true, beside: false, closable: false });

  it('puts Resume first for a stalled chat', () => {
    expect(items(false, true).slice(0, 2)).toEqual(['resume', 'pin']);
  });

  it('gives a failed and stalled chat Retry only', () => {
    expect(items(true, true)[0]).toBe('retry');
    expect(items(true, true)).not.toContain('resume');
  });

  it('gives an idle chat neither', () => {
    expect(items(false, false)[0]).toBe('pin');
  });

  it('offers Move to section, and Remove from section for a chat in one', () => {
    expect(items(false, false)).toContain('section');
    expect(items(false, false)).not.toContain('unsection');
    expect(chatMenuItems({ failed: false, stalled: false, canPin: true, beside: false, closable: false, inSection: true })).toContain('unsection');
  });

  it('offers its own window after Open beside', () => {
    const keys = chatMenuItems({ failed: false, stalled: false, canPin: true, beside: true, ownWindow: true, closable: true });
    expect(keys.slice(keys.indexOf('beside'), keys.indexOf('beside') + 3)).toEqual(['beside', 'window', 'close']);
    expect(items(false, false)).not.toContain('window');
    expect(chatWindowUrl('a b')).toBe('/?chat=a%20b&alone=1');
  });
});

describe('RepoRow', () => {
  const folder = (branch: string): Folder => buildFolders([{ ...repo('shop'), branch, dirty: 3 }], [], [chat('/w/shop', 5)])[0];
  const render = (d: Folder) => renderToStaticMarkup(createElement(RepoRow, { d, active: true, here: false, open: true, icon: 'folder', creating: false, toggle() {}, newTree() {}, start() {} }));

  it('shows the name and a non-default branch, with the changes in the title only', () => {
    const html = render(folder('feature-x'));
    expect(html).toContain('shop');
    expect(html).toContain('feature-x');
    expect(html).toContain('title="/w/shop\n3 uncommitted"');
    expect(html).not.toMatch(/class="(dirty|count|when)"/);
  });

  it('shows the name only on the default branch', () => {
    const html = render(folder('main'));
    expect(html).toContain('shop');
    expect(html).not.toContain('branch-chip');
  });
});

describe('messageMeta', () => {
  it('names the chat, the author and the age', async () => {
    const { messageMeta } = await import('./OpenChats');
    expect(messageMeta({ title: 'Importer', role: 'assistant', at: new Date(Date.now() - 3 * 3_600_000).toISOString() })).toBe('Importer · Agent · 3h');
    expect(messageMeta({ title: '', role: 'user', at: '' })).toBe('Untitled · You');
  });
});

