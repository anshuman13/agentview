import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { run } from './slack.js';

const SLACK = 'mcp__claude_ai_Slack__';

export const ANSWERED = 'answered';
export const CHANGED = 'changed';

// Posts text as a thread reply under the ask's permalink with the work account's Slack connector and returns the permalink of
// the post, or ANSWERED when a re-read of the thread shows someone else answered since the scan.
export async function postReply(url: string, text: string) {
  let posted: string | null = null;
  const done = tool('posted', 'Call once the message is posted, or once you decided not to post.', { url: z.string().describe(`Permalink of the message you posted, "${ANSWERED}" when someone else already answered, or "${CHANGED}" when the thread moved on`) }, async (a) => {
    posted = a.url;
    return { content: [{ type: 'text' as const, text: 'noted' }] };
  });
  const prompt = [
    `Read the thread of ${url} with slack_read_thread. The channel id is the path segment after /archives/, and the thread_ts is the p-number with a dot before its last 6 digits. If a reply after that message, from someone other than its author, already answers it, do not post: call posted with "${ANSWERED}" and stop. If the author has since withdrawn the ask, answered it themselves, or changed it so the message below no longer fits, do not post: call posted with "${CHANGED}" and stop.`,
    `Otherwise post the message below as a reply in that thread with slack_send_message, exactly once, changing nothing in the text, then call posted with the permalink and stop.`,
    '',
    text,
  ].join('\n');
  await run(prompt, 'haiku', [done], 8, () => posted != null, [`${SLACK}slack_send_message`, `${SLACK}slack_read_thread`]);
  if (!posted) posted = await verifyPost(url, text);
  if (!posted) throw new Error('The reply was not posted');
  return posted as string;
}

// When the post run ended without calling posted, reads the thread once more: the message may have gone out anyway.
async function verifyPost(url: string, text: string) {
  let found: string | null = null;
  const done = tool('found', 'Call once with what you found.', { url: z.string().describe('Permalink of the posted message, or "none"') }, async (a) => {
    found = a.url === 'none' ? null : a.url;
    return { content: [{ type: 'text' as const, text: 'noted' }] };
  });
  const prompt = [
    `Read the thread of ${url} with slack_read_thread (channel id after /archives/, thread_ts is the p-number with a dot before its last 6 digits). If a reply there has exactly the text below, call found with its permalink; otherwise call found with "none". Do not post anything.`,
    '',
    text,
  ].join('\n');
  try {
    await run(prompt, 'haiku', [done], 4, () => found != null, [`${SLACK}slack_read_thread`]);
  } catch (err) {
    console.error('autopilot verify:', err);
  }
  return found as string | null;
}
