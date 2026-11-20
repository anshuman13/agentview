// The first message of a chat started from a task: its title, then its notes and its link, each after a blank line.
// A saved task (not a note) ends with its id and how to close it, when the chat's folder is in the task's profile (the chat can only see that profile's rows).
export const taskChatPrompt = ({ id, status, title, text, sourceUrl, sameProfile = false }: { id?: string | null; status?: string | null; title?: string | null; text?: string | null; sourceUrl?: string | null; sameProfile?: boolean }) =>
  [title, text, sourceUrl, id && status !== 'note' && sameProfile ? `AgentView task [${id}]. When the work is done, set its status to done with mcp__agentview__data_write.` : null].map((s) => s?.trim()).filter(Boolean).join('\n\n');
