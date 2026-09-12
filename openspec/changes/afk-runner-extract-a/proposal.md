<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: afk-runner-extract-a

## Why

afk-runner claims genericness but its agent plane is borrowed: the one
`runAgent` call reaches a 2,886-line transitive closure inside
`review-loop/src/` (18 files post-#432). The extraction's Phase A
(`openspec/changes/afk-runner-extraction/`, design D1/D5/D7) closes that
boundary inside papai, where every step still passes the full gate suite —
the split (Phase B) then becomes purely mechanical.

## What Changes

- A no-upward-imports guard test (`tests/afk-runner/no-upward-imports.test.ts`):
  nothing under `afk-runner/src` or `tests/afk-runner` imports outside the
  union of the runner's trees, `afk-runner/ ∪ tests/afk-runner/` (relative
  paths escaping that union forbidden; `node:`/bare allowed). Written
  red first — it fails against today's `review-loop`/`mutation-improve` imports.
- Verbatim copy of the 18-file agent-spawn closure into
  `afk-runner/src/agent-backend/`, plus `mutation-improve/src/diff-guard.ts`;
  the closure's tests port from `tests/review-loop/` with imports rewired.
  Review-loop originals are untouched — copy, never move.
- Rewire every upward import to the owned backend — measured on this branch:
  20 src files / 23 statements against `review-loop/src`/`mutation-improve/src`,
  plus the test tree's 7 `tests/utils/grouped-assertions.js` imports (the
  helper copies into `tests/afk-runner/`); the guard's scan, not any count,
  defines the set. Declare `p-limit` in `afk-runner/package.json`; the guard
  goes green.
- **BREAKING** prune to opencode-only (design D1, the run's last task per
  D7): delete `claude-argv`, `claude-stream`, `backend-select`, and the
  claude-API branches of `agent-command`/`line-handler`; `modelFor` maps
  roles to opencode model strings. Breaks only a config naming a claude-API
  model directly — none exists; default model is `opencode` everywhere
  (U13 audit). Golden fixtures (`tests/afk-runner/fixtures/real/`) stay green.
- The #432 MCP seam work (`opencodeEnv` threading, `mcp-servers.ts`,
  `agent-config.ts`) rides the copy verbatim — no redesign.
- Full papai gate pass (`check:full` leg set) over the changed files,
  mutation ratchet included.

## Capabilities

### New Capabilities

- `afk-runner-agent-backend`: the runner's owned agent-spawn backend —
  opencode-CLI as the sole backend, role→opencode-model resolution, and the
  in-tree boundary the guard pins. Without it the **BREAKING** prune lands
  with zero spec record: the `afk-runner-*` spec set (which travels with the
  split) would never state the agent plane is opencode-only, and
  `afk-runner-cli`'s model-ladder requirements would imply model strings are
  open-ended when claude-API names no longer resolve. No existing capability
  covers it: `afk-runner-execution` governs the spawn walk,
  `afk-runner-agent-mcp` governs what config the spawn carries; backend
  selection today is unspecced review-loop implementation.

### Modified Capabilities

(none — `afk-runner-execution`'s walk and `afk-runner-cli`'s
file-over-environment-over-defaults ladder keep their requirements; the
review-loop originals that keep the claude paths are untouched.)

## Impact

- Code: `afk-runner/src/` (+ new `agent-backend/`), `afk-runner/package.json`
  (`p-limit`) with `bun.lock` regenerated, `tests/afk-runner/`;
  `review-loop/src/` and `mutation-improve/` unchanged except being copy sources.
- Platform/task instances: none; no config-context scope impact — the `model`
  key and `AFK_RUNNER_MODEL` are per-invocation runner config outside papai's
  scope model; no DB, no migrations.
- Docs: `docs/architecture/afk-runner.md` (U-ledger Phase A record).

## Non-goals

- Phase B (filter-repo split) and Phase C (new-repo setup, papai retirement) —
  separate runs/operator steps per design D7.
- Any behavior change beyond the prune's documented opencode-only shape.
- Touching papai's `review-loop/src/` originals or their tests.
- npm packaging, license, CI — Phase C material.
- New abstraction over `runAgent` — the existing call shape is the seam (D1).
