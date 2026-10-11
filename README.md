# AgentView

A VS Code style view for working with Claude Code, built on the Agent SDK instead of the terminal.
The agent does the work; the view is for watching, steering and verifying.

- Brief (main view): what Claude is doing now, its next steps, important notes it flags for you, questions and
  permission prompts, its last reply and the files it changed. The box at the bottom steers Claude: while it works,
  sending stops the current step and Claude continues with your message
- Chat: the full conversation with tool calls collapsed, model and permission mode menus
- Explorer: file tree of the current folder; its header switches between worktrees and open chats
- Side panel: read-only file viewer that follows Claude's edits and shows the diff against HEAD (⌘P to open any file),
  and a browser preview opened from the globe in the activity bar
- Workspace: every repo in your workspace folders, their chats and Paseo worktrees, and the chats that are open right now
- Phone: same client with a tab bar, reachable over your local network or NetBird

Claude fills the Brief through a `set_status` tool AgentView adds to every session (current step, next steps,
important notes).

## Run

```bash
npm install
PROJECT_DIR=/path/to/project npm run serve   # server on :7777, vite on :5173
```

Open http://localhost:5173. The server runs the Claude Code CLI you have installed, with whatever login it has.
`PROJECT_DIR` is only the fallback folder for the first chat; after that AgentView reopens the last chat you viewed.

`npm run serve` does not restart the server when its code changes, so a running turn survives edits.
Use `npm run dev` when working on the server itself.

`npm run menubar` builds and starts a menu bar app that keeps the Mac awake while you are away.

To serve the built client from the server: `npm run build && node server/dist/server/src/index.js /path/to/project`.

## Workspace

AgentView lists the git repos in `~/workspace` and `~/workspace_personal`. Set `AGENTVIEW_ROOTS` to a
colon-separated list of folders to change that. Chats can only be started inside these folders or in Paseo worktrees.

- ⌘O, or clicking the project name in the status bar, picks a repo and starts a new chat in it
- Hover a repo for a new chat (+) or, for Paseo projects, a new worktree branched off the default branch
- Chats keep running when you switch to another one. Open chats show whether they are working or need you,
  and a badge and notification appear when a background chat needs approval
- A chat closes after 10 minutes with nothing running and no one viewing it; reopen it from its repo
- Chats untouched for 12 hours can be deleted, and Paseo worktrees idle for 12 hours can be removed (the branch is kept)

## Shortcuts

| Key | Action |
| --- | --- |
| ⌘O | Start a chat in a repo |
| ⌘P | Open a file |
| ⌘B | Toggle the sidebar |
