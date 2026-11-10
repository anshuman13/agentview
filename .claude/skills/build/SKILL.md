---
name: build
description: Build one or more AgentView features through the pm -> spec-reviewer -> implementer -> tester loop (the `build` workflow), then merge what passed. Use for "/build <brief>", "build these features", or an unattended feature loop.
---

# /build

Runs `.claude/workflows/build.js`: for each feature brief, `pm` writes `.claude/specs/<slug>.md`, `spec-reviewer` approves or sends it back (3 rounds), `implementer` builds it in a worktree on `anshuman/build/<slug>`, `tester` checks every acceptance criterion and sends failures back (3 rounds). Features run through the pipeline in parallel.

## Before launching

1. `cd server && node ../.claude/usage.mjs --chat`. Each feature costs roughly 4 to 8 Sonnet agent runs. Batch size by the 5-hour window: under 50% up to 4 features, 50-80% up to 2, over 80% none; wait for the window to reset. Weekly over 85%: stop.
2. Turn the user's ask into briefs: one line each, user-visible outcome, a slug of 2-4 words. Do not pre-design; that is the pm's job.
3. Call Workflow with `{scriptPath: '<repo>/.claude/workflows/build.js', args: [{slug, brief}, ...]}` (the name registry does not see this file). Optional `specRounds` and `buildRounds` on an object form: `{features: [...], buildRounds: 2}`.

Build agents run by hand (pm, spec-reviewer, implementer, tester, code-reviewer) get `.claude/specs/<slug>.md` in their prompt, so the Builds view can file their reports under the feature.

## After it returns

For each result with `passed: true`:
1. Read the implementer's commit: `git -C <worktree> show --stat`. Grep the diff for work names before anything else.
2. `git cherry-pick <sha>` onto main. Rerun the checks for the touched packages on main (type checks, vitest, bun test, web build).
3. Hub restart when assistant/ or shared/ changed: `launchctl kickstart -k gui/$(id -u)/no.pradhan.assistant`. Server restart when server/ changed: `curl -XPOST http://127.0.0.1:7777/api/restart` (do this last in the turn, it restarts this chat).
4. `git pull -q --rebase origin main && git push -q`.
5. Remove the worktree: `git worktree remove --force <path>` and `git branch -D anshuman/build/<slug>`.

A spec the reviewer never approved still gets built, with the open issues passed to the implementer as notes. For `passed: false`: leave the worktree, put the slug and the tester's fixes in the summary for the user, and move on. Do not hand-fix inside the loop; either rerun with a sharper brief or do it yourself in a separate turn.

Finish with set_status: done lists what merged, important lists what did not pass and why.
