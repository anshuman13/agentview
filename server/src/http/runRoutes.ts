import { errText } from '../../../shared/util.js';
import type { ChatRun } from '../../../shared/protocol.js';
import { removeChat } from '../agent/claude/pins.js';
import { reviewDiff } from '../workspace/git.js';
import { ReviewError, approveRun, runWorktree } from '../workspace/review.js';
import { removeRunWorktree } from '../workspace/worktrees.js';
import { entry, type Ctx, type Entry, type RouteDeps } from './routeTypes.js';

const failed = (status: number, error: string) => ({ status, body: { error } });

// Review of a finished coding job: the diff, and the routes that push its branch, send it back or throw it away. Only approve pushes.
export function runRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  const working = new Set<string>();

  const onRun = (fn: (run: ChatRun, ctx: Ctx) => unknown, pending = true, body = false) =>
    entry<Ctx>(async (ctx) => {
      const run = d.runs().find((r) => r.kind === 'job' && r.id === ctx.url.searchParams.get('run'));
      if (!run) return failed(404, 'Run not found');
      if (working.has(run.id)) return failed(409, 'The run is busy');
      if (pending && run.review !== 'pending') return failed(409, 'The run is not waiting for review');
      working.add(run.id);
      try {
        return await fn(run, ctx);
      } catch (err) {
        return err instanceof ReviewError ? failed(err.status, err.message) : failed(500, errText(err).split('\n')[0]);
      } finally {
        working.delete(run.id);
      }
    }, body);

  return {
    'GET /api/runs/diff': onRun(async (run) => ({ branch: run.branch, ...(await reviewDiff(await runWorktree(run))) }), false),
    'POST /api/runs/approve': onRun(async (run) => {
      const url = await approveRun(run);
      await d.host.req({ op: 'run_end', id: run.id, why: 'PR opened', pr: url });
      return { url };
    }),
    'POST /api/runs/revise': onRun(async (run, { body }) => {
      const text = String(body.text ?? '').trim();
      if (!text) return failed(400, 'Write a note first');
      await d.host.req({ op: 'run_revise', id: run.id, text });
      return { ok: true };
    }, true, true),
    'POST /api/runs/discard': onRun(async (run) => {
      if (run.state === 'done') return failed(409, 'The run is over');
      await runWorktree(run);
      await d.host.req({ op: 'run_end', id: run.id, why: 'Discarded' });
      const open = d.bySession(run.sessionId);
      if (open) await d.closeByUser(open);
      if (run.sessionId) await removeChat(run.sessionId, false, true);
      await removeRunWorktree(run);
      return { ok: true };
    }, false),
  };
}
