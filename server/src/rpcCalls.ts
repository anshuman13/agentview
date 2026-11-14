type Call = { resolve: (v: any) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> };

// The calls of one JSON-RPC connection still waiting for their answer.
export class RpcCalls {
  private next = 1;
  private calls = new Map<number, Call>();

  // A new call: its id, and its answer, which fails with timedOut() after ms when ms is given.
  start<T = any>(ms?: number, timedOut = () => new Error('The request timed out')): { id: number; answer: Promise<T> } {
    const id = this.next++;
    const answer = new Promise<T>((resolve, reject) => {
      const timer = ms === undefined ? undefined : setTimeout(() => this.fail(id, timedOut()), ms);
      this.calls.set(id, { resolve, reject, timer });
    });
    return { id, answer };
  }

  // Settles the call an answer is for; false when nothing waits on its id.
  settle(id: unknown, error: Error | undefined, result?: unknown) {
    const c = typeof id === 'number' ? this.take(id) : undefined;
    if (error) c?.reject(error);
    else c?.resolve(result);
    return Boolean(c);
  }

  fail(id: number, err: Error) {
    this.take(id)?.reject(err);
  }

  failAll(err: Error) {
    for (const id of [...this.calls.keys()]) this.fail(id, err);
  }

  private take(id: number) {
    const c = this.calls.get(id);
    this.calls.delete(id);
    clearTimeout(c?.timer);
    return c;
  }
}
