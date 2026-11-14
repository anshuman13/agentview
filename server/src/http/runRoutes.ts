import { existsSync } from 'node:fs';
import { errText } from '../../../shared/util.js';
import type { ChatRun } from '../../../shared/protocol.js';
import { reviewDiff } from '../workspace/git.js';
import { ReviewError, approveRun, runWorktree } from '../workspace/review.js';
import { entry, type Ctx, type Entry, type RouteDeps } from './routeTypes.js';

const failed = (status: number, error: string) => ({ status, body: { error } });

// Review of a finished coding job: the diff, and the routes that push its branch, send it back or throw it away. Only approve pushes.
export function runRoutes(d: RouteDeps): Record<string, Entry<Ctx>> {
  const working = new Set<string>();
  const chatWorking = (run: ChatRun) => Boolean(d.chats().get(run.chatId)?.running);

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
    'GET /api/runs/diff': onRun(async (run) => {
      const { cwd, env } = await runWorktree(run);
      return { branch: run.branch, ...(await reviewDiff(cwd, env)) };
    }, false),
    'POST /api/runs/approve': onRun(async (run) => {
      if (chatWorking(run)) return failed(409, 'The chat is working');
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
      const left = Boolean(run.worktree && existsSync(run.worktree));
      // A discarded run whose worktree removal failed can be discarded again to retry it.
      if (run.state === 'done' && !(run.why === 'Discarded' && left)) return failed(409, 'The run is over');
      if (chatWorking(run)) return failed(409, 'The chat is working');
      if (left) await runWorktree(run);
      await d.host.req({ op: 'run_drop', id: run.id, why: 'Discarded' });
      return { ok: true };
    }, false),
  };
}
