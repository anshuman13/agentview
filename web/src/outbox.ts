import type { ReliableMessage, Target } from '../../shared/protocol';

// tried: it went out on some socket at least once, so it may already have run.
export type OutboxEntry = { cid: string; to: Target; msg: ReliableMessage; at: number; state: 'pending' | 'held' | 'rejected'; reason?: string; tried?: boolean };

// A steer resent this late would stop a turn the user never meant to stop, so it goes out as a normal prompt.
export const STEER_STALE = 30_000;
// A message this old waits for the user instead of starting Claude on its own.
export const HOLD_AFTER = 10 * 60_000;
// Answers, approvals and plan edits are about the moment; later they are dropped.
export const ACTION_TTL = 5 * 60_000;

const ACTIONS = new Set(['answer', 'permission', 'allow_blocked', 'plan']);

type Storage = { get(): string | null; set(value: string): void };

function parse(raw: string | null): OutboxEntry[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.cid === 'string' && e.msg && e.to) : [];
  } catch {
    return [];
  }
}

// Messages the user sent that the server has not acked yet. They are saved before they go out, resent on every new
// connection until acked, and the server drops repeats by cid, so a message is neither lost nor run twice.
export class Outbox {
  entries: OutboxEntry[];
  private socket = 0;
  private sentOn = new Map<string, number>();
  // Cids this tab removed, so a save does not bring them back from another tab's copy.
  private removed = new Set<string>();

  constructor(
    private storage: Storage,
    private transmit: (m: object) => boolean,
    private fallback: () => Target,
    private onChange: () => void = () => {},
    private now = () => Date.now(),
  ) {
    this.entries = parse(storage.get());
  }

  enqueue(msg: ReliableMessage, to: Target, cid: string = crypto.randomUUID()) {
    this.entries = [...this.entries, { cid, to, msg, at: this.now(), state: 'pending' }];
    this.save();
    this.flush();
    return cid;
  }

  // The socket has its chat state (init or resumed), so the server knows where messages go.
  ready(socket: number) {
    this.socket = socket;
    this.flush();
  }

  lost() {
    this.socket = 0;
  }

  flush() {
    if (!this.socket) return;
    let changed = false;
    for (const e of this.entries) {
      if (e.state !== 'pending' || this.sentOn.get(e.cid) === this.socket) continue;
      const age = this.now() - e.at;
      if (ACTIONS.has(e.msg.type) && age > ACTION_TTL) {
        e.state = 'rejected';
        e.reason = 'Too old to send';
        changed = true;
        continue;
      }
      if (age > HOLD_AFTER && !e.tried) {
        e.state = 'held';
        changed = true;
        continue;
      }
      if (!e.to.chat) {
        e.to = this.fallback();
        changed = true;
      }
      const msg = e.msg.type === 'steer' && age > STEER_STALE ? { type: 'prompt', text: e.msg.text } : e.msg;
      if (!this.transmit({ ...msg, cid: e.cid, to: e.to })) break;
      this.sentOn.set(e.cid, this.socket);
      if (!e.tried) {
        e.tried = true;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  // The server is an older version that never acks: send each message once and forget it, rather than rerun it on
  // every reconnect.
  sendOnce() {
    for (const e of this.entries) if (e.state === 'pending') this.transmit({ ...e.msg, cid: e.cid, to: e.to });
    for (const e of this.entries) this.removed.add(e.cid);
    this.entries = this.entries.filter((e) => e.state !== 'pending');
    this.save();
  }

  ack(cid: string, status: 'accepted' | 'duplicate' | 'rejected', reason?: string) {
    const e = this.entries.find((x) => x.cid === cid);
    if (!e) return;
    if (status === 'rejected') Object.assign(e, { state: 'rejected', reason: reason ?? 'The server refused it' });
    else this.drop(cid);
    this.sentOn.delete(cid);
    this.save();
  }

  // Send a held or rejected message again, as if it were new.
  retry(cid: string) {
    const e = this.entries.find((x) => x.cid === cid);
    if (!e) return;
    Object.assign(e, { state: 'pending', at: this.now(), reason: undefined });
    this.sentOn.delete(cid);
    this.save();
    this.flush();
  }

  discard(cid: string) {
    this.drop(cid);
    this.sentOn.delete(cid);
    this.save();
  }

  private drop(cid: string) {
    this.removed.add(cid);
    this.entries = this.entries.filter((x) => x.cid !== cid);
  }

  // Another tab may have saved entries since this one loaded; keep those instead of overwriting them.
  private save() {
    const mine = new Set(this.entries.map((e) => e.cid));
    const theirs = parse(this.storage.get()).filter((e) => !mine.has(e.cid) && !this.removed.has(e.cid));
    this.entries = [...this.entries, ...theirs].sort((a, b) => a.at - b.at);
    try {
      this.storage.set(JSON.stringify(this.entries));
    } catch {}
    this.onChange();
  }
}
