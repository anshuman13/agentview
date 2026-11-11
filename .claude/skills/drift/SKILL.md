---
name: drift
description: Weekly docs drift report for AgentView. Compares each doc under docs/ with the code, writes a dated report and turns findings into Codex tasks. Use for "/drift", "drift report" or the weekly docs check.
---

# /drift

Runs `.claude/workflows/drift.js`: one `drift-checker` per doc under `docs/`, each a fresh agent that reads one doc and the code it names, and returns only the claims the code no longer matches.

1. `bun server/build-kit/usage.mjs --chat` from the repo root. About 9 Sonnet agent runs; skip when the 5-hour window is over 80%.
2. Call Workflow with `{scriptPath: '<repo>/.claude/workflows/drift.js'}`, or `args: ['docs/features.md']` for some docs only.
3. Write `.claude/drift/<YYYY-MM-DD>.md` (git-excluded with the rest of `.claude/drift`): one section per doc, one bullet per finding (claim, what the code does, fix doc or code). A doc with `findings: null` failed; say so.
4. Findings with fix "doc": fix the doc in one commit, subject "Bring docs in line with the code".
5. Findings with fix "code": one Codex task each with `mcp__agentview__data_write` (table items, status suggested, title "Docs drift: <short claim>", text the claim, the code reference and the report path), so the user confirms them in Needs you. Skip one that an open task already covers (`data_find` on the title words).
6. set_status: done "<N> drift findings, <M> doc fixes, <K> tasks".
