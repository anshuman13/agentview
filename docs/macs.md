# Phone and other Macs

## Phone

Open the phone icon in the status bar for a QR code. Works over NetBird.

The page listens on one event stream from the Mac and resumes it from the last event it saw after a drop, so a
tab that was in the background catches up without a reload. A link that stays silent for 50 s is reopened.

Files and text shared to the phone app are attached in the chat composer, once; reopening the app from recents does
not attach them again. The desktop window app opens mailto and vscode links in the Mac apps that handle them.

AgentView only accepts connections from this Mac and the peers `netbird status` lists, and refuses requests and
websockets from other websites, including other servers on localhost.

## Macs

The Mac's name in the status bar (on the phone: the chat header and the More sheet) lists the other Macs on NetBird
that run AgentView, with a dot for whether an agent is working there. Click one to switch to it; a banner names the
Mac you landed on. The phone app remembers the Mac you used last and offers the others when it can't reach it.
In the phone app the web UI is bundled and opens without a Mac; it calls the chosen Mac over NetBird (the server accepts
the origins `http://tauri.localhost` and `tauri://localhost` only from this Mac and NetBird peers) and shows an offline
state with Retry and the Mac list when that Mac cannot be reached. Switching Macs there changes the address the app calls
and reopens the event stream.
A Mac cannot reach its own NetBird address, so the Mac you are viewing from is marked "you are here" and opens on
localhost.

## Another Mac

To run AgentView on a second Mac, such as an always-on Mac mini, first do the parts that need you at the keyboard:

1. Install Homebrew (brew.sh) and Google Chrome, sign in to your Chrome profile and add Claude in Chrome
2. `brew install netbirdio/tap/netbird`, `sudo netbird service install && sudo netbird service start`, `netbird up`,
   then switch off Login expiration for this Mac in the NetBird dashboard
3. `brew install gh && gh auth login` with the GitHub account that owns this repo
4. `brew install --cask claude-code`, run `claude` and log in
5. On the first Mac, run `tar czf ~/Desktop/mini-config.tgz -C ~ .claude/CLAUDE.md .claude/settings.json .claude/skills .gitconfig .gitconfig-work .gitconfig-personal`
   and copy the file to `~/Downloads` on this Mac (AirDrop works)

Then paste this into `claude`:

> Clone anshuman13/agentview with gh into ~/workspace_personal/agentview and follow the "Another Mac" section of
> docs/macs.md, the steps for Claude.

Steps for Claude:

1. `brew install node git uv oven-sh/bun/bun`, then `npm install` in the repo
2. Unpack `~/Downloads/mini-config.tgz` into `~` without overwriting existing files, then delete it
3. Run `./start.sh`
4. Check that `curl -s http://localhost:7777/api/connect` lists a NetBird address
5. `brew install rustup && rustup default stable`, then `npm run build -w app` and copy
   `app/src-tauri/target/release/bundle/macos/AgentView.app` to `/Applications` (the desktop window app)
6. Tell me to turn on Open at login in the AgentView menu bar menu, grant Full Disk Access to `dist/AgentView.app`,
   click Allow in Chrome's remote debugging prompt, and add the MCP servers (`claude mcp add`, then `/mcp` to sign in)

The mini does not run local databases, so leave out the `*_local` MCP servers.
