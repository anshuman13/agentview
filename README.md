# AgentView

A VS Code style view for working with Claude Code, built on the Agent SDK instead of the terminal.
The agent does the work; the view is for watching, steering and verifying.

- Task box (right column, top): where you tell Claude what to do, with the mode and model menus. While Claude works,
  sending steers it: the current step stops and Claude continues with your message. Under the input is the timeline:
  your instructions, the parts Claude finished, important notes, Claude's replies (the latest one open), what it is
  doing now and its next steps. Edit, remove
  or add a next step and Claude gets the new plan at its next tool call, without stopping. Approvals that need you
  (plans, Fable, permissions) show here too
- Terminal (bottom panel, ⌘J): a shell in the chat's folder, for when you want to run something yourself
- Explorer: file tree of the current folder; its header switches between worktrees and open chats
- Editor (center): two tabs, File and Browser, that you switch between with a click, ⌘E or the globe in the activity
  bar. File is a read-only viewer that follows Claude's edits and shows the diff against HEAD (⌘P to open any file);
  Browser is a preview of your local app. The layout stays fixed: editor in the middle, task box on the right
- Chats: the chats that are open right now (the ones that need you first) and the most recent chats from every repo
- Workspace: every repo in your workspace folders, their chats and Paseo worktrees
- Phone: same client with a tab bar, reachable over your local network or NetBird. The Chats tab switches between
  Chats and Repos. The timeline is on top with the input below
  it, and the terminal has its own tab

The meter next to the model menu shows how many tokens are in the context. Past 200k it turns red and the task box
asks you to compact, with a button that runs `/compact`.

Claude fills the timeline through a `set_status` tool AgentView adds to every session (current step, finished parts,
next steps, important notes).

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

`npm test` runs the unit tests (Vitest).

To serve the built client from the server: `npm run build && node server/dist/server/src/index.js /path/to/project`.

## Team mode

Pick **Team** in the model menu. Every new task starts in plan mode with Claude Opus 5.5 (Claude Code's `opusplan`).
When you approve the plan, Claude Sonnet 5.5 builds it and consults Opus through the server-side advisor tool (its
advice is encrypted, so the task box only counts the consults). For a really hard problem any chat can ask
Fable (Claude Fable 5.1) through a `big-bro` sub-agent; every call waits for your approval and Fable's answer shows as
a note in the task box. Each advisor consult re-reads the conversation, so long chats make consults more expensive.

## Workspace

AgentView lists the git repos in `~/workspace` and `~/workspace_personal`. Set `AGENTVIEW_ROOTS` to a
colon-separated list of folders to change that. Chats can only be started inside these folders or in Paseo worktrees.

- ⌘O, or clicking the project name in the status bar, picks a repo and starts a new chat in it
- Hover a repo for a new chat (+) or, for Paseo projects, a new worktree branched off the default branch
- Chats keep running when you switch to another one. Open chats show whether they are working or need you,
  and a badge and notification appear when a background chat needs approval
- Close a chat with the × on its row in Chats (the transcript is kept). A chat also closes by itself after 10 minutes
  with nothing running and no one viewing it; reopen it from Recent or its repo
- Chats untouched for 12 hours can be deleted, and Paseo worktrees idle for 12 hours can be removed (the branch is kept)

## Shortcuts

| Key | Action |
| --- | --- |
| ⌘O | Start a chat in a repo |
| ⌘P | Open a file |
| ⌘B | Toggle the sidebar |
| ⌘J | Toggle the terminal |
| ⌘E | Switch the editor between the file and the browser |
