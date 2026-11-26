// Sub-chats: a chat that sends /clear goes on in a new session, linked to the chat's first (root) session.
// shared/fixtures/sub-chats.json holds the cases; android sessions/SubChats.kt runs the same ones.

import type { SubVia } from './protocol';

export type { SubVia };
export type SubLink = { parent: string; via: SubVia; at: number };
export type SubLinks = Record<string, SubLink>;

export type GroupSession = { sessionId: string; lastModified: number; parentId?: string; via?: SubVia; startedAt?: number; spawnedBy?: string };
export type OpenSession = { sessionId: string | null; parentId?: string; lastActive?: number };
export type ParentRow<T extends GroupSession> = { root: T; latest: string; count: number; label: string; lastModified: number; members: string[]; builds: number; buildMembers: string[] };

export const SUB_GAP_MS = 2 * 60 * 1000;
const SENT_MS = 5000;

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

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function subChatLabel(count: number, allBuild: boolean, builds = 0): string {
  const parts = [count > 0 ? plural(count, allBuild ? 'task' : 'sub-chat') : '', builds > 0 ? plural(builds, 'build') : ''];
  return parts.filter(Boolean).join(' · ');
}

// Every session of a row: its own chain, then the builds started from it.
export const rowSessions = (row: { members: string[]; buildMembers: string[] }) => [...row.members, ...row.buildMembers];

const startOf = (s: GroupSession) => s.startedAt ?? s.lastModified;

// One row per chat: sub-chats fold into their root's row. A sub-chat whose root is not in the list stands on its own.
// An open chat whose current session is a sub-chat not yet saved joins its root's row as the latest member.
// A build chat started from a listed chat (spawnedBy) folds into that chat's row, after its members; the row still
// opens the chat's own latest session. A build started from a build that folds stands on its own.
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
    return { root, latest: members[members.length - 1], count, allBuild, lastModified, members };
  });
  const rowOf = new Map(rows.flatMap((r) => r.members.map((id) => [id, r] as const)));
  const hostOf = (r: (typeof rows)[number]) => {
    const host = r.root.spawnedBy ? rowOf.get(r.root.spawnedBy) : undefined;
    return host && host !== r ? host : undefined;
  };
  const folded = rows.filter((r) => hostOf(r) && !hostOf(hostOf(r)!)).sort((a, b) => startOf(a.root) - startOf(b.root));
  const shown = rows.filter((r) => !folded.includes(r)).map(({ allBuild, ...r }) => {
    const bs = folded.filter((b) => hostOf(b)?.root === r.root);
    const lastModified = Math.max(r.lastModified, ...bs.map((b) => b.lastModified));
    return { ...r, label: subChatLabel(r.count, allBuild, bs.length), lastModified, builds: bs.length, buildMembers: bs.flatMap((b) => b.members) };
  });
  return shown.sort((a, b) => b.lastModified - a.lastModified);
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
export type ScanSession = { sessionId: string; cwd: string; branch: string | null; account: string; lastAt: number; clearAt?: number; clearedAt?: number };
export type ScanRun = { sessionId: string; cwd: string; kind: string; startedAt: number; endedAt: number | null };

// Links each session that starts with /clear (clearAt) to the session in the same cwd, branch and account whose last
// entry is at most 2 minutes before the /clear, or to the one session that queued that /clear (clearedAt, within 5
// seconds), even when it was resumed later. A session already followed by a /clear is used up. When several are left,
// a build run of that chat and cwd settles it; otherwise nothing is linked.
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
    const same = sessions.filter((s) => s.sessionId !== c.sessionId && !used.has(s.sessionId) && s.cwd === c.cwd && s.branch === c.branch && s.account === c.account);
    const sent = same.filter((s) => s.clearedAt != null && Math.abs(s.clearedAt - at) <= SENT_MS);
    let cands = sent.length === 1 ? sent : same.filter((s) => s.lastAt <= at && at - s.lastAt <= SUB_GAP_MS);
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
