// Sub-chats: a chat that sends /clear goes on in a new session, linked to the chat's first (root) session.
// shared/fixtures/sub-chats.json holds the cases; android sessions/SubChats.kt runs the same ones.

export type SubVia = 'clear' | 'build';
export type SubLink = { parent: string; via: SubVia; at: number };
export type SubLinks = Record<string, SubLink>;

export type GroupSession = { sessionId: string; lastModified: number; parentId?: string; via?: SubVia; startedAt?: number };
export type OpenSession = { sessionId: string | null; parentId?: string; lastActive?: number };
export type ParentRow<T extends GroupSession> = { root: T; latest: string; count: number; label: string; lastModified: number; members: string[] };

export const SUB_GAP_MS = 2 * 60 * 1000;

// The first session of the chain the id belongs to; the id itself when it is not a sub-chat.
export function rootOf(links: SubLinks, id: string): string {
  const seen = new Set<string>();
  let cur = id;
  while (links[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = links[cur].parent;
  }
  return cur;
}

export function subChatLabel(count: number, allBuild: boolean): string {
  if (count <= 0) return '';
  const noun = allBuild ? 'task' : 'sub-chat';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const startOf = (s: GroupSession) => s.startedAt ?? s.lastModified;

// One row per chat: sub-chats fold into their root's row. A sub-chat whose root is not in the list stands on its own.
// An open chat whose current session is a sub-chat not yet saved joins its root's row as the latest member.
export function groupSessions<T extends GroupSession>(saved: T[], open: OpenSession[] = []): ParentRow<T>[] {
  const byId = new Map(saved.map((s) => [s.sessionId, s]));
  const groups = new Map<string, { root: T; subs: T[]; live: { id: string; at: number }[] }>();
  for (const s of saved) if (!(s.parentId && byId.has(s.parentId))) groups.set(s.sessionId, { root: s, subs: [], live: [] });
  for (const s of saved) if (s.parentId && byId.has(s.parentId)) groups.get(s.parentId)?.subs.push(s);
  for (const o of open) {
    if (!o.sessionId || byId.has(o.sessionId) || !o.parentId) continue;
    groups.get(o.parentId)?.live.push({ id: o.sessionId, at: o.lastActive ?? 0 });
  }
  const rows = [...groups.values()].map(({ root, subs, live }) => {
    subs.sort((a, b) => startOf(a) - startOf(b));
    live.sort((a, b) => a.at - b.at);
    const members = [root.sessionId, ...subs.map((s) => s.sessionId), ...live.map((l) => l.id)];
    const count = subs.length + live.length;
    const allBuild = live.length === 0 && subs.every((s) => s.via === 'build');
    const lastModified = Math.max(root.lastModified, ...subs.map((s) => s.lastModified), ...live.map((l) => l.at));
    return { root, latest: members[members.length - 1], count, label: subChatLabel(count, allBuild), lastModified, members };
  });
  return rows.sort((a, b) => b.lastModified - a.lastModified);
}

export type SubHit = { sessionId: string; parentId?: string };

// Where a message search hit opens: the root chat, with the sub-chat to expand when the hit is in one.
export function searchHitRow<H extends SubHit>(hit: H): H & { session: string; sub?: string } {
  return hit.parentId ? { ...hit, session: hit.parentId, sub: hit.sessionId } : { ...hit, session: hit.sessionId };
}

// One row per chat for a list of hits, best (first) hit kept.
export function searchHitRows<H extends SubHit>(hits: H[]): (H & { session: string; sub?: string })[] {
  const seen = new Set<string>();
  return hits.map(searchHitRow).filter((r) => !seen.has(r.session) && !!seen.add(r.session));
}

// Older chats split by /clear before links were recorded.
export type ScanSession = { sessionId: string; cwd: string; branch: string | null; account: string; lastAt: number; clearAt?: number };
export type ScanRun = { sessionId: string; cwd: string; kind: string; startedAt: number; endedAt: number | null };

// Links each session that starts with /clear (clearAt) to the session in the same cwd, branch and account whose last
// entry is at most 2 minutes before the /clear. A session already followed by a /clear is used up. When several are
// left, a build run of that chat and cwd settles it; otherwise nothing is linked.
export function linkOlder(sessions: ScanSession[], links: SubLinks, runs: ScanRun[] = []): SubLinks {
  const out: SubLinks = {};
  const all: SubLinks = { ...links };
  const used = new Set<string>();
  const chains = new Map<string, ScanSession[]>();
  for (const s of sessions) {
    if (!links[s.sessionId]) continue;
    const r = rootOf(links, s.sessionId);
    chains.set(r, [...(chains.get(r) ?? []), s]);
  }
  for (const [r, members] of chains) {
    const ordered = [...members].sort((a, b) => (a.clearAt ?? a.lastAt) - (b.clearAt ?? b.lastAt));
    used.add(r);
    for (const m of ordered.slice(0, -1)) used.add(m.sessionId);
  }
  const clears = sessions.filter((s) => s.clearAt != null && !links[s.sessionId]).sort((a, b) => a.clearAt! - b.clearAt!);
  for (const c of clears) {
    const at = c.clearAt!;
    let cands = sessions.filter((s) => s.sessionId !== c.sessionId && !used.has(s.sessionId) && s.cwd === c.cwd && s.branch === c.branch && s.account === c.account && s.lastAt <= at && at - s.lastAt <= SUB_GAP_MS);
    if (cands.length > 1) {
      const chatRuns = runs.filter((r) => r.kind === 'build' && r.cwd === c.cwd);
      cands = cands.filter((s) => chatRuns.some((r) => r.sessionId === s.sessionId || r.sessionId === rootOf(all, s.sessionId)));
    }
    if (cands.length !== 1) continue;
    const prev = cands[0];
    const build = runs.some((r) => r.kind === 'build' && r.cwd === c.cwd && r.startedAt <= at && (r.endedAt == null || at <= r.endedAt));
    const link: SubLink = { parent: rootOf(all, prev.sessionId), via: build ? 'build' : 'clear', at };
    out[c.sessionId] = link;
    all[c.sessionId] = link;
    used.add(prev.sessionId);
  }
  return out;
}
