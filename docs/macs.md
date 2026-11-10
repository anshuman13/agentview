# Phone and other Macs

## Phone

Open the phone icon in the status bar for a QR code. Works over NetBird.

The page listens on one event stream from the Mac and resumes it from the last event it saw after a drop, so a
tab that was in the background catches up without a reload. A link that stays silent for 50 s is reopened.

Files and text shared to the phone app are attached in the chat composer, once; reopening the app from recents does
not attach them again. The desktop window app opens mailto and vscode links in the Mac apps that handle them.

AgentView only accepts connections from this Mac and the peers `netbird status` lists, and refuses requests and
websockets from other websites, including other servers on localhost.

## Native Android app

`android/` holds the phone app, a native Kotlin and Jetpack Compose client, "AgentView" (package
`no.pradhan.agentview.native`). The Tauri WebView phone app was removed on 9 Nov 2026; `app/` now builds only the
desktop window app. The phone app talks to the same
server as the web app: the `/api/events` stream, `POST /api/cmd` and the `/api/assistant/*` hub proxy.

Colors, type and spacing come from `web/src/styles/tokens.css` and the icons from the codicons in `node_modules`:
`./gradlew generateTokens generateIcons` writes `Tokens.kt` and `Codicons.kt`, so a token change reaches the app on the
next generate and build. TokenGen applies native overrides, listed under Phone in `design-system.md`. Screens build from the shared components in `Components.kt`.

Each running chat has an ongoing, silent notification on the channel "Running chats": title, status, elapsed time and Stop,
or Allow and Deny while it waits on a permission request (any other request shows "Needs you" and opens the chat). It has
no actions in read-only mode and goes when the turn ends or notifications are off.

`npm run native` runs the unit tests and builds a minified release APK signed with the debug key;
`npm run native -- <adb serial>` also installs it. It needs JDK 17 and the Android SDK
(`/opt/homebrew/share/android-commandlinetools`). On the emulator, `adb reverse tcp:7777 tcp:7777` lets the app reach
the server at `http://localhost:7777`, and the launch extra `--ez readonly true` blocks every write for checks
against live data.

## Macs

The Mac's name in the status bar (on the phone: the chat header and the More sheet) lists the other Macs on NetBird
that run AgentView, with a dot for whether an agent is working there. Click one to switch to it; a banner names the
Mac you landed on. The phone app remembers the Mac you used last and offers the others when it can't reach it.
The desktop window app bundles the web UI and calls the chosen Mac (the server accepts the origins
`http://tauri.localhost` and `tauri://localhost` only from this Mac and NetBird peers); the web UI shows an offline state
with Retry and the Mac list when that Mac cannot be reached.
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

> Clone the agentview repo with gh into ~/workspace_personal/agentview and follow the "Another Mac" section of
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
