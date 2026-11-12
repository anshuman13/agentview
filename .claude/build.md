# Build notes for this repo

Read by the build agents (pm, spec-reviewer, spec-reader, zoom-out, implementer, tester, code-reviewer) and the build skill after CLAUDE.md.

Branch prefix: anshuman/build/

## Spec (pm, spec-reviewer, zoom-out)
- For anything with UI, read the Components and Patterns sections of docs/design-system.md and name under Behaviour which component and pattern each screen element uses (Report card, Row density, Status language). A spec that shows hub text as a text block, a bare URL, or more than two actions on a row is wrong.
- New hub columns go through the ensure-column path in assistant/src/core/db.ts; say so in Touches. Say which packages need their type check and tests run (web, server, assistant).
- Reuse the store, hub jobs, shared types, ensure-column migrations and design tokens.
- Nothing writes to the live hub or posts to Slack during tests.
- Public repo: no work names, people, channels or internal systems in the spec.

## Implement
- UI uses tokens from web/src/styles/tokens.css, the primitives in web/src/ui and the Patterns section of docs/design-system.md (Report card, Row density, Status language). No pre-wrapped hub text, no bare URLs, at most two actions on a row.
- Follow docs/architecture.md, section Code shape: no `fetch` in components (use the feature's API file), files by role (`Foo.tsx`, `useFoo.ts`, `fooLogic.ts`), logic web and Android both carry changed on both sides in the same commit.
- New hub columns go through the ensure-column path in assistant/src/core/db.ts.
- Keep docs in step when the feature changes what docs/features.md, docs/autopilot.md or docs/assistant.md describe.
- Public repo: no work names, people, channels or internal systems anywhere in the diff.
- Symlink `node_modules`, `server/node_modules` and `web/node_modules` from the main checkout.
- Checks, from the worktree root, for every package touched plus assistant whenever shared/ or server/src changed: `npx tsc --noEmit -p web`, `npx tsc --noEmit -p server`, `npx tsc --noEmit -p assistant`, `npm test` from the root, `cd assistant && bun test`, and `npm run build -w web` when web changed.

## Test
- Checks for the packages the diff touches: `npx tsc --noEmit -p web|server|assistant`, `npm test` from the root, `cd assistant && bun test`.
- (UI) criteria: start the web app on a spare port from the worktree (`cd web && npx vite --port 5199`, proxies to the running server on :7777), launch headless Chrome with `--user-data-dir=/tmp/avchk/profile --remote-debugging-port=9334 --headless=new` from `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, drive it over CDP, check at 390x844 and 1280x800, light and dark. Never port 9333. macOS has no `timeout`.
- Clean up: `pkill -f user-data-dir=/tmp/avchk; pkill -f "main.ts /tmp/avhub"; lsof -ti tcp:5199 -ti tcp:7788 -ti tcp:7799 | xargs kill; rm -rf /tmp/avhub`; delete temp scripts and screenshots.
- Read-only against the live hub (:7790, ~/.agentview). Never create, edit, delete or swipe real rows, never post to Slack, never press Send on a real ask. Anything that must write uses a scratch hub (`HOME=/tmp/avhub`, port 7799) or a unit test.

## Code review
- Design system: hard-coded colors, sizes or one-off components where tokens.css and web/src/ui primitives exist.
- Conventions in docs/architecture.md, section Code shape: a `fetch` in a component or hook outside an API file, a call reaching up a layer, logic that web and Android both carry changed on one side only (grep the other side for the same prompt, label or rule), a file or folder that groups by kind instead of feature.

## Merge
- Grep the diff for work names before anything else.
- Rerun the checks for the touched packages on main (type checks, `npm test`, hub `bun test`, web build).
- Hub restart when assistant/ or shared/ changed: `launchctl kickstart -k gui/$(id -u)/no.pradhan.assistant`. Server restart when server/ changed: `curl -XPOST http://127.0.0.1:7777/api/restart` (do this last in the turn, it restarts this chat).
- `git pull -q --rebase origin main && git push -q`.
