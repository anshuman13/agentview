# Assistant step 1 status

## Works
- Workspace `assistant/` (Bun, bun:sqlite; tests run with `bun test` in assistant/, not in root vitest), database at ~/.agentview/assistant/assistant.db
- Schema: items, facts, people, links, embeddings, jobs, runs, each with profile, version, updated_at, deleted and per-field edit times
- Sync API on port 7790 (POST /sync, GET /changes?since=N, GET /health), localhost and NetBird peers only, each device known by its NetBird name
- Last edit wins per field, tested in src/sync.test.ts
- launchd plists and nightly VACUUM INTO backup script in assistant/deploy (written, not loaded)

## Left
- Not smoke tested against a real NetBird peer or from the phone
- Pull is paged (`hasMore`); the client must loop until it is false
- No FTS5 search, embeddings or scheduler yet (steps 3 and 4)
- Copying the nightly backup to the laptop is not set up
- The backup keeps about 15 days

## Load the launchd service
See assistant/deploy/README.md: create the data folder, copy both plists to ~/Library/LaunchAgents, then `launchctl bootstrap gui/$(id -u) <plist>` for each and check `curl localhost:7790/health`.
