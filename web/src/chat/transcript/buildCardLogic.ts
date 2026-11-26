import { specSlug } from '../../../../shared/specTasks';
import type { BuildCardState, SpawnedBuild } from '../../../../shared/protocol';

export type BuildCardInput = { spec?: string; request?: string };
export type BuildCardOpen = { chat: string } | { session: string } | null;
export type BuildCard = { title: string; status: string; tasks: string; round: string; open: BuildCardOpen; found: boolean };

const STATUS: Record<BuildCardState, string> = {
  spec: 'Writing spec',
  approval: 'Waiting for approval',
  running: 'Running',
  paused: 'Paused',
  needs: 'Needs you',
  done: 'Done',
  stopped: 'Stopped',
};

const chatIdOf = (result: string | null | undefined) => (result ? /new chat \(([^)]+)\)/.exec(result)?.[1] : undefined);

function taskText({ state, done, total }: SpawnedBuild) {
  if (!total) return '';
  if (state === 'done' || state === 'stopped') return `${done} of ${total} tasks`;
  if (state === 'running' || state === 'needs' || state === 'paused') return `Task ${Math.min(done + 1, total)} of ${total}`;
  return `${total} tasks`;
}

// The card for the index-th start_build call in a chat: matched by the chat id its result names, else by order.
export function buildCard(input: BuildCardInput, result: string | null | undefined, index: number, builds: SpawnedBuild[]): BuildCard {
  const title = input.spec ? specSlug(input.spec) : (input.request ?? '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  const chat = chatIdOf(result);
  const build = (chat && builds.find((b) => b.chatId === chat)) || builds[index];
  if (!build) return { title, status: result ?? 'Starting', tasks: '', round: '', open: chat ? { chat } : null, found: false };
  return {
    title,
    status: STATUS[build.state],
    tasks: taskText(build),
    round: build.round ?? '',
    open: build.chatId ? { chat: build.chatId } : { session: build.sessionId },
    found: true,
  };
}
