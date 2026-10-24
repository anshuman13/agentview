import { open, stat, type FileHandle } from 'node:fs/promises';

const HEAD = 256;
const NL = 0x0a;

export type TailRead = 'same' | 'append' | 'reload' | null;

// Follows an append-only JSONL file: after the first read, only the bytes added since are parsed.
// Anything that doesn't look like a plain append (shrunk, replaced, start rewritten) is re-read in full.
export class JsonlTail {
  entries: any[] = [];
  private offset = 0;
  private ino = -1;
  private size = -1;
  private mtime = -1;
  private head = Buffer.alloc(0);
  private busy: Promise<unknown> = Promise.resolve();

  constructor(public file: string) {}

  reset() {
    this.entries = [];
    this.offset = 0;
    this.ino = this.size = this.mtime = -1;
    this.head = Buffer.alloc(0);
  }

  // Reads are serialized so overlapping callers never consume the same bytes twice.
  read(): Promise<TailRead> {
    const r = this.busy.then(() => this.readNow());
    this.busy = r.catch(() => {});
    return r;
  }

  private async readNow(): Promise<TailRead> {
    const st = await stat(this.file).catch(() => null);
    if (!st) {
      this.reset();
      return null;
    }
    if (st.ino === this.ino && st.size === this.size && st.mtimeMs === this.mtime) return 'same';
    const fh = await open(this.file, 'r').catch(() => null);
    if (!fh) return null;
    try {
      if (st.ino === this.ino && this.offset > 0 && st.size >= this.offset && (await this.intact(fh))) {
        const added = await this.consume(fh, st.size);
        this.size = st.size;
        this.mtime = st.mtimeMs;
        return added ? 'append' : 'same';
      }
      this.reset();
      await this.consume(fh, st.size);
      Object.assign(this, { ino: st.ino, size: st.size, mtime: st.mtimeMs });
      return 'reload';
    } finally {
      await fh.close();
    }
  }

  private async intact(fh: FileHandle) {
    const head = Buffer.alloc(this.head.length);
    const last = Buffer.alloc(1);
    await fh.read(head, 0, head.length, 0);
    await fh.read(last, 0, 1, this.offset - 1);
    return head.equals(this.head) && last[0] === NL;
  }

  private async consume(fh: FileHandle, end: number) {
    if (end <= this.offset) return 0;
    const buf = Buffer.alloc(end - this.offset);
    const { bytesRead } = await fh.read(buf, 0, buf.length, this.offset);
    const done = buf.lastIndexOf(NL, bytesRead - 1);
    if (done < 0) return 0;
    let added = 0;
    for (let i = 0; i < done; ) {
      const j = buf.indexOf(NL, i);
      try {
        this.entries.push(JSON.parse(buf.toString('utf8', i, j)));
        added++;
      } catch {}
      i = j + 1;
    }
    if (this.offset === 0) this.head = Buffer.from(buf.subarray(0, Math.min(HEAD, done + 1)));
    this.offset += done + 1;
    return added;
  }
}
