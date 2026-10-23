// Recent broadcasts, so an event stream that drops can resume from its Last-Event-ID instead of taking a full init.
type Entry = { id: number; data: string; chat: unknown };

export class Ring {
  private entries: Entry[] = [];
  // Ids keep rising across restarts, so an id from an older server never matches a newer entry.
  seq = Date.now();

  constructor(private size = 500) {}

  push(data: string, chat: unknown) {
    const id = ++this.seq;
    this.entries.push({ id, data, chat });
    if (this.entries.length > this.size) this.entries.shift();
    return id;
  }

  // Entries after `last` for one chat plus the chat-less ones, or null when `last` is not in the buffer any more.
  since(last: number, chat: unknown) {
    const oldest = this.entries[0]?.id ?? this.seq + 1;
    if (!Number.isFinite(last) || last > this.seq || last < oldest - 1) return null;
    return this.entries.filter((e) => e.id > last && (e.chat === null || e.chat === chat));
  }
}

export const frame = (data: string, id?: number) => `${id === undefined ? '' : `id: ${id}\n`}data: ${data}\n\n`;
