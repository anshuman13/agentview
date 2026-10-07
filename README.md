# AgentView

A view for working with Claude Code built on the Agent SDK instead of the terminal.
The agent does the work; the view is for watching, steering and verifying.

- Now pane: one-line status Claude sets itself, questions and permission prompts as buttons, recent turn summaries
- Chat: the conversation stream with tool calls collapsed
- Code: read-only viewer that follows Claude's edits and shows the diff against HEAD (Cmd+P to open any file)
- Browser: iframe preview for now, Electron webview later
- Phone: same client, tab bar layout, meant to be served over Tailscale

## Run

```bash
npm install
PROJECT_DIR=/path/to/project npm run dev   # server on :7777, vite on :5180
```

Open http://localhost:5180. The server runs the Claude Code CLI you have installed, with whatever login it has.

Production-ish: `npm run build && node server/dist/server/src/index.js /path/to/project`, then
`tailscale serve 7777` to reach it from your phone.
