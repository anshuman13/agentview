---
name: build
description: Build one or more features of this repo through the pm -> spec-reviewer -> implementer -> tester loop (the `build` workflow), then merge what passed. Use for "/agentview:build <brief>", "build these features", or an unattended feature loop.
---

# /agentview:build

Runs the kit's `workflows/build.js`: for each feature brief, `agentview:pm` writes `.claude/specs/<slug>.md`, `agentview:spec-reviewer` approves or sends it back (3 rounds; in round 1 `agentview:spec-reader`, a cold reader with no repo, and `agentview:zoom-out`, a scope and reuse check, read it too), `agentview:designer` sketches the screens of a UI spec in `.claude/sketches/<slug>.html`, the `agentview:approval-gate` agent then waits until you approve every phase, the sketch included, in the Spec card (a note on the spec goes to `agentview:pm`, which rewrites it; a note on the sketch, or a spec change, goes to the designer), `agentview:implementer` builds it in a worktree on `<branch prefix><slug>`, `agentview:tester` checks every acceptance criterion and sends failures back (3 rounds). Features run through the pipeline in parallel.

The kit is two folders up from the "Base directory for this skill" line (that base is `<kit>/skills/build`). Call it `<kit>` below, as an absolute path.

## Before launching

1. `node <kit>/usage.mjs --chat`. Each feature costs roughly 4 to 8 Sonnet agent runs. Batch size by the 5-hour window: under 50% up to 4 features, 50-80% up to 2, over 80% none; wait for the window to reset. Weekly over 85%: stop.
2. Turn the user's ask into briefs: one line each, user-visible outcome, a slug of 2-4 words. Do not pre-design; that is the pm's job.
3. Read the repo's CLAUDE.md and `.claude/build.md` when it exists. When `.claude/build.md` has a `Branch prefix:` line, pass its value as `branchPrefix`.
4. Call Workflow with `{scriptPath: '<kit>/workflows/build.js', args: {features: [{slug, brief}, ...], kit: '<kit>', root: '<absolute repo root>', branchPrefix}}` (the name registry does not see this file). Leave out `branchPrefix` when there is no such line (the branch is then `build/<slug>`). Optional `specRounds` and `buildRounds` go next to `features`.

By default every feature waits for approval before it is implemented. `approval: false` next to `features` skips the gate for unattended loops or when the user asks to build without approving. `sketch` is `'auto'` by default (a sketch when the spec has a (UI) acceptance criterion); pass `sketch: true` when the user asks for a sketch and `sketch: false` when they ask for none. Without approval the sketch is still written and handed to the implementer. A held spec keeps the gate re-running its haiku agent every 9 minutes with no limit, which costs a run each time. A Kiro spec has no spec file, so its gate returns an error and the feature is not built while approval is on.

Build agents run by hand (`agentview:pm`, `agentview:spec-reviewer`, `agentview:implementer`, `agentview:tester`, `agentview:code-reviewer`) get `.claude/specs/<slug>.md` in their prompt, so the Builds view can file their reports under the feature.

## After it returns

For each result with `passed: true`:
1. Read the implementer's commit: `git -C <worktree> show --stat`. Apply the repo's rules for the diff (CLAUDE.md, `.claude/build.md`), such as names that must not appear in it.
2. `git cherry-pick <sha>` onto the main branch. Rerun the checks CLAUDE.md and `.claude/build.md` give for the touched packages, else run the repo's test command.
3. Do the restarts and publishing steps CLAUDE.md and `.claude/build.md` name for the touched packages (a restart that restarts this chat goes last in the turn).
4. Remove the worktree: `git worktree remove --force <path>` and `git branch -D <branch>`.

A spec the reviewer never approved still gets built, with the open issues passed to the implementer as notes. For `passed: false`: leave the worktree, put the slug and the tester's fixes in the summary for the user, and move on. Do not hand-fix inside the loop; either rerun with a sharper brief or do it yourself in a separate turn.

Finish with set_status: done lists what merged, important lists what did not pass and why.
