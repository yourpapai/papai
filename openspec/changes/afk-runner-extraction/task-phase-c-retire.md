<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner-extract-c-retire

Execute the papai retirement of the afk-runner extraction, capability name
`afk-runner-extract-c-retire`, per the umbrella change
`openspec/changes/afk-runner-extraction/` (tasks.md 4.2–4.3; design.md
D4/D7). **Launch precondition (task 4.1, operator-only):** the drain gate
is confirmed — no in-flight runs launched from master checkouts
(`afk-runner runs` from a master checkout shows none running), the
confirmation recorded in the umbrella change's notes.md. Worktree-pinned
runs are exempt by D4; this run itself is worktree-pinned.

## Scope

- Task 4.2 — the deletion commit: remove `afk-runner/`, `tests/afk-runner/`,
  root `package.json` workspace entry + `afk-runner:start`, `.gitignore`'s
  `.afk-runner` entry, `scripts/mutation/baseline.json` afk entries + README
  mention, `.claude/` + `.opencode/` `commands/sdd-auto.md`. Tombstones:
  docs-index pointer to `yourpapai/afk-runner` in `AGENTS.md`/`CLAUDE.md`
  and a one-line pointer where `docs/architecture/afk-runner.md` stood.
- Task 4.3 — final papai verification and docs pass: full suite, lint,
  typecheck; update `docs/architecture/` index references so no page points
  at removed files.

## Inherited as decided (do not re-litigate)

- `openspec/` stays untouched — R5 precedent left retired specs in place;
  `openspec/specs/afk-runner-*` and `sdd-*` remain as historical records.
- The deletion is drain-gated and rollback is `git revert` (R5 doctrine).
- `opencode-agent/src/pricing.ts`'s historical comment mention stays.
- The new repo is `yourpapai/afk-runner` (private) — tombstones point
  there.

## Non-goals

- Any change to the new repo — it is live and independently gated.
- Pruning papai's openspec specs or archive dirs.
- Rewiring `/sdd:auto` to invoke the external runner — the command gets a
  tombstone pointer, nothing more (proposal Non-goal).

## Walk grammar

One commit-shaped task (4.2) whose verification is the greppable-empty
check, then the closing verification pass (4.3). The tree is green after
each.

## Verify

`grep -rn "afk-runner" package.json .gitignore scripts/mutation/baseline.json`
returns nothing after 4.2; `bun test && bun run lint && bun run typecheck`
green after 4.3.
