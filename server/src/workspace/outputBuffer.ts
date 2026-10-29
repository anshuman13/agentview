export class OutputBuffer {
  buf = '';
  private pending: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private max: number,
    private delayMs: number,
    private emit: (chunk: string) => void,
  ) {}

  push(chunk: string) {
    this.pending.push(chunk);
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.length) return;
    const d = this.pending.join('');
    this.pending = [];
    this.buf += d;
    if (this.buf.length > this.max * 2) this.trim();
    this.emit(d);
  }

  snapshot() {
    this.flush();
    return this.buf;
  }

  clearLine() {
    this.flush();
    this.buf = this.buf.slice(this.buf.lastIndexOf('\n') + 1);
  }

  dispose() {
    this.flush();
  }

  private trim() {
    const from = this.buf.length - this.max;
    const nl = this.buf.indexOf('\n', from);
    this.buf = this.buf.slice(nl < 0 ? from : nl + 1);
  }
}
