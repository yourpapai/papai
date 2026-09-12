<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# afk-runner-extract-a

Execute Phase A — boundary hardening inside papai — of the afk-runner
extraction, capability name `afk-runner-extract-a`, per the umbrella change
`openspec/changes/afk-runner-extraction/` (proposal.md, design.md D1/D6/D7,
tasks.md 1.1–1.5). Read those artifacts first; every figure in them is
load-bearing (the closure is 18 files / 2,886 lines post-#432).

## Scope

- Task 1.1 — the no-upward-imports guard test
  (`tests/afk-runner/no-upward-imports.test.ts`): nothing under
  `afk-runner/src` or `tests/afk-runner` imports outside `afk-runner/`
  (relative-up paths forbidden; `node:`/bare specifiers allowed). Written
  red first — it must fail against today's `review-loop`/`mutation-improve`
  imports.
- Task 1.2 — copy the 18-file agent-spawn closure verbatim
  (`agent-runner`, `spawn`, `progress-log`, `line-handler`,
  `backend-select`, `claude-stream`, `event-stream`, `cost`, `run-stats`,
  `config`, `worktree`, `todo-capture`, `live-format`, `trace-log`,
  `diff-stats`, `claude-argv`, `agent-command`, `claude-spawn-dir`) into
  `afk-runner/src/agent-backend/`; copy `mutation-improve/src/diff-guard.ts`
  alongside; port the closure's existing tests from `tests/review-loop/`
  with imports rewired. Review-loop originals untouched — copy, never move.
- Task 1.3 — rewire the 10 src files and 19 test imports from
  `review-loop/src` to `afk-runner/src/agent-backend`; declare `p-limit` in
  `afk-runner/package.json`; the guard test goes green.
- Task 1.4 — **the run's last task, prune-last per design D7**: delete
  `claude-argv`, `claude-stream`, `backend-select` and the claude-API
  branches of `agent-command`/`line-handler`; `modelFor` maps roles to
  opencode model strings; delete the ported claude-path tests; golden
  fixtures (`tests/afk-runner/fixtures/real/`) stay green.
- Task 1.5 — full papai gate pass over the changed files, mutation ratchet
  included.

## Inherited as decided (do not re-litigate)

- Copy-then-prune to an opencode-only owned backend (design D1) — no new
  abstraction over `runAgent`; the existing call shape is the seam.
- The prune is BREAKING for a config naming a claude-API model directly;
  none exists, the default model is `opencode` everywhere (U13 audit).
- Prune-last ordering and run completion before any resume (design D7):
  the in-process module graph of the live run is frozen; a resume across
  half-migrated backend code is the one excluded hazard.
- The MCP seam work from PR #432 (`opencodeEnv` threading,
  `mcp-servers.ts`, `agent-config.ts`) is landed and rides this copy — do
  not redesign it; carry it through verbatim.

## Non-goals

- Phase B (filter-repo split) and Phase C (new-repo setup, papai
  retirement) — separate runs and operator steps per design D7.
- Any behavior change beyond the prune's documented opencode-only shape.
- Touching papai's `review-loop/src/` originals or their tests.
- npm packaging, license work, CI — Phase C material.

## Walk grammar

Every task is one complete red→green cycle — the reproducing test and its
implementation land in the same task, never a test alone. TDD discipline is
baked into each task's verification commands (runner spawns carry no papai
write-hook pipeline); the tree is green after every task.

## Verify

`bun test tests/afk-runner tests/review-loop` after the copy;
`bun test tests/afk-runner && bun run typecheck` after the rewire;
`bun test tests/afk-runner` after the prune (golden fixtures green);
`bun test && bun run lint && bun run typecheck && bun run test:mutate:changed`
as the closing gate pass.
