// The first message of a chat started from a task: its title, then its notes and its link, each after a blank line.
// A saved task (not a note) ends with its id and how to close it.
export const taskChatPrompt = ({ id, status, title, text, sourceUrl }: { id?: string | null; status?: string | null; title?: string | null; text?: string | null; sourceUrl?: string | null }) =>
  [title, text, sourceUrl, id && status !== 'note' ? `AgentView task [${id}]. When the work is done, set its status to done with mcp__agentview__data_write.` : null].map((s) => s?.trim()).filter(Boolean).join('\n\n');
