# AgentView

Read the doc for the area before searching the code: `docs/architecture.md` (overview), `docs/features.md`,
`docs/design-system.md`, `docs/assistant.md` (Codex hub), `docs/macs.md` (phone, native app, other Macs).
Every change follows the code conventions in `docs/architecture.md`, section Code shape: layers call downward, server
calls go in the feature's API file, logic web and Android share changes on both sides, sizes are hints. A change that
varies by provider follows the Providers section of the same file.

## Map
- `server/src`: Bun/TS server on :7777. HTTP routes in `http/routes.ts`, chat host in `host/`, sessions in `session/`, agent tools in `agent/`.
- `web/src`: React web app (Vite). `app/` shell and store, `chat/`, `sessions/`, `codex/` (tasks, meetings, wiki), `workspace/` (files, git), `ops/`, `ui/` shared components, `styles/tokens.css` design tokens.
- `assistant/src`: Codex hub on :7790 (tasks, meetings, calendar import, jobs). Folders: `core` (db, sync, claude), `slack`, `calendar`, `meetings`, `wiki`, `jobs`, `routes`; `server.ts` is the entry. Tests use `bun test`.
- `shared/`: code used by all three. `protocol.ts` is the wire protocol, `tables.ts` the hub columns (a new column there must also go in `SYNCED_FIELDS` in the Android `CodexRows.kt`).
- `android/`: native Kotlin/Compose app. Code is in `android/app/src/main/kotlin/no/pradhan/agentview/nativeapp/`, in feature subpackages (`app`, `chat`, `sessions`, `codex` with `meetings`, `wiki`, `jobs`, `autopilot`, `workspace`, `ops`, `net`, `ui`; folder path matches the package). Only `MainActivity` and the manifest receivers stay in the root. Tests mirror the packages under `android/app/src/test/kotlin/...`. `ui/Tokens.kt` and `ui/Codicons.kt` are generated.
- `app/`: the Tauri desktop window app (macOS only). The phone app is `android/`.

## Checks
- Server, web, shared: `bun run test` from the root (`bun test --parallel`, about 3 s), and `bunx --bun tsc --noEmit -p .` in `server/`, `web/`, `assistant/`. The type checks skip test files.
- Tests use `bun:test`. Helpers for what its `vi` lacks (`setSystemTime`, `stubGlobal`, `stubEnv`, `waitFor`, `advanceTimersByTimeAsync`) are in `testing.ts`. `vi.mock` is not hoisted: mock first, then `await import` the module under test. A mock must export every name its importers use. Never create `expect(p).rejects` before the code that settles `p`: Bun blocks on it.
- Hub: `cd assistant && bun test`.
- Android: `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools android/build.sh` runs the unit tests and builds the minified release APK. Test the release build: R8 can strip classes the debug build keeps. `build.sh --fast` builds the debug APK in seconds for iterating; R8 is about 30 s of the release build. With a device serial, `build.sh <serial>` also installs and compiles it with speed-profile.

## Restarts
- Server: `curl -XPOST http://127.0.0.1:7777/api/restart`. It restarts the running chats too, so do it last.
- Hub, after `assistant/` or `shared/` changes: `launchctl kickstart -k gui/$(id -u)/no.pradhan.assistant`.
- Web: Vite reloads on its own.

## Shell (zsh)
- Quote glob options: `grep -rn foo --include='*.ts'`. Unquoted, zsh fails with `no matches found` and the search looks empty.
- Call adb through a function, not a string variable:
  `a(){ /opt/homebrew/share/android-commandlinetools/platform-tools/adb -s emulator-5554 "$@"; }`.
- macOS `sed -i ''` has no GNU `a`/`i` one-liners; use the Edit tool or a python heredoc.

## Emulator checks
`a reverse tcp:7777 tcp:7777`, then launch with
`a shell am start -n no.pradhan.agentview.native/no.pradhan.agentview.nativeapp.MainActivity --ez readonly true --es origin http://localhost:7777`.
`readonly` blocks every write to the live server. Screenshots: `a exec-out screencap -p > /tmp/x.png`, and check the file is not empty before reading it.
Reset any `wm size` or `wm density` change when done.
