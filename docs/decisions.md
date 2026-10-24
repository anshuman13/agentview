# Decisions

**Bun for the server.** Same TypeScript, faster start, and a built-in PTY (`Bun.spawn` with `terminal`) instead of
node-pty, which needed native rebuilds. Vite and the web build stay on Node.

**Server-Sent Events, not WebSocket, for the client.** One resumable stream with event ids survives phones dropping
off the VPN better than a socket, and commands are plain POSTs that land or fail visibly. WebSocket remains only for
terminals and the Chrome relay.

**Agent host apart from the API server.** A restart used to end every running turn. Chats now live in a long-lived
host; the API server, which changes most often, restarts freely.

**Driver interface around the Claude SDK.** Everything Claude-specific sits behind `AgentDriver` in `agent/claude/`,
and each session reports its driver's capabilities, so another provider can be added without touching the session.

**Loops in AgentView, not the CLI.** `/loop` and `/goal` are scheduled by the session and saved across restarts, so they
do not depend on the CLI's own jobs.

**Chrome through a relay.** The relay keeps the DevTools connection while the server restarts, so Chrome's Allow
dialog does not come back.

**ntfy for phone pushes.** No app of our own to publish. Off until a topic is set, since a public ntfy server would get chat text without the user choosing it.
