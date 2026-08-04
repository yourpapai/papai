<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Knip facade triage: replace ignoreIssues with import-structure fixes

Date: 2026-08-04
Status: approved

## Goal

Reverse 34 of the 39 facade `ignoreIssues` entries added or expanded in
`knip.config.ts` during the PR #216 dependency bump (32 entries removed, 2
expanded entries reverted to their pre-bump scope), fixing the underlying
import structure instead of suppressing knip findings. The 5 remaining
entries keep only bindings that knip genuinely cannot trace: the published
`papai/plugin-types` package surface, declared plugin-core-separation
compatibility boundaries, and bindings consumed by byte-frozen
0Q-qualification test files.

## Background and findings

### Why the ignores exist

knip 6.28 (webpro-nl/knip#1895) stopped treating re-exported bindings as
"used in file" when `ignoreExportsUsedInFile: true` is set. This repo runs
knip with a production-only project scope (`!` markers), so any facade
re-export binding that no **production** module imports **through the facade**
is now reported: 180 bindings across 40 files. The dep PR silenced them with
per-file `ignoreIssues` entries (37 added, 2 pre-existing entries expanded) —
in tension with the config's own guardrail ("keep the ignore surface
minimal… prefer code fixes over new ignore lines").

### Facade usage landscape (measured)

The facade/barrel pattern is deeply embedded and deliberately mixed:

- 297 production files import through the facades; 244 import from the
  concrete modules directly.
- 339 test files import through facades; 192 import from concrete modules.
- 4 barrel contract test files deliberately pin facade surfaces
  (`tests/mcp/index.test.ts`, `tests/mcp-server/index.test.ts`,
  `tests/message-cache/index.test.ts`, `tests/attachments/index.test.ts`)
  via namespace and dynamic `await import()` access.
- `src/providers/public-types.ts` is published as the `papai/plugin-types`
  package export; internal code imports the concrete modules (114 files).

### Per-symbol triage (all 180 flagged bindings classified)

| Class | Symbols | Consumer reality | Fix |
| --- | --- | --- | --- |
| A | 69 (~127 import sites) | Production imports the symbol, but from the concrete module | Repoint production imports to the facade |
| B | 71 (~121 test files) | Only tests consume the symbol (via facade or concrete) | Repoint test imports to the concrete module; prune the facade binding |
| C | 40 | Zero consumers anywhere | Prune the binding (dead code) |

### Frozen-file constraint (hard rule)

The 0Q refactor qualification freezes `tests/stories/**`,
`tests/utils/test-helpers.ts`, `tests/setup.ts`, `tests/mock-reset.ts`,
`scripts/story/**`, and `scripts/coverage/**` byte-for-byte. Exactly three
facades have flagged bindings consumed by frozen files; those bindings must
remain exported from the facade and keep an ignore entry:

- `src/debug/state-collector.ts` — `recentLlm`, `pendingTraces` ←
  `tests/utils/test-helpers.ts`
- `src/deferred-prompts/poller.ts` — `pollAlertsOnce` ←
  `tests/stories/harness/scenario.ts`
- `src/coding-sessions/store.ts` — `SessionRecord` ←
  `tests/stories/harness/scenario.ts`

All other bindings in those facades are triaged normally.

## Design

### Execution model

Per-facade, in dependency order (deepest facades first — e.g.
`coding-sessions/session-record.ts` before `store.ts`; concrete-heavy leaves
like `src/utils/scheduler.ts` early). For each facade: apply its A/B/C edits,
then gate on `bun run knip && bun run typecheck && bun run lint` plus the
targeted test slice for that area. Only proceed to the next facade when
green, so every intermediate state is shippable and failures stay isolated.

A disposable codemod script performs the mechanical edits (parse
import/export statements, move named bindings between specifier paths, prune
bindings, drop emptied statements). Every edit is reviewed via `git diff`
before the verification gate runs — the script proposes, we verify.

### Class A edit rules — repoint production imports to the facade

- Move the named binding from the concrete-module import statement to the
  facade import statement in the same file: merge with an existing facade
  import when present, otherwise add one in the repo's import-group position.
  Preserve aliases (`X as Y`) and `type` qualifiers verbatim.
- **Cycle-safety gate.** Before repointing to a *runtime* facade, check that
  the facade's transitive imports do not reach the importer. Type-only
  facades (`src/chat/types.ts`, `client/debug/dashboard-types.ts`,
  `src/plugins/types.ts`) skip this check — type imports are erased at
  compile time. If a runtime cycle is found, fall back to Class B treatment
  for that symbol (prune binding, repoint test imports) instead of forcing
  the facade path.
- Exemption: `src/providers/public-types.ts` is not repointed onto (moving
  114 internal files onto the published plugin-types surface is a separate
  policy decision, out of scope).

### Class B edit rules — repoint test imports, prune binding

- Handle all three test import forms: named imports, namespace imports
  (`import * as mc` → import the concrete module, adjust qualifiers), and
  dynamic `await import()` in contract tests.
- For local re-exports (`export { X }` without `from`, e.g. `src/bot.ts`,
  `src/tools/index.ts`), the test import target is the facade's own import
  source (e.g. `src/auth.js`).
- After test imports move, prune the binding from the facade's export
  statement, drop emptied statements, and clean up now-unused imports in the
  facade (lint verifies).

### Class C edit rules — prune dead bindings

Same pruning mechanics as Class B, with no import repointing. The largest
cluster is 20 types in `client/debug/dashboard-types.ts` whose consumers
import via `client/shared/api-types.ts` or `src/stats/types.ts` instead.

### Contract tests (per-facade decision)

- **Keep, trimmed:** `tests/mcp/index.test.ts`,
  `tests/mcp-server/index.test.ts`, `tests/message-cache/index.test.ts` —
  these facades have dynamic/plugin-loader consumers; the tests keep
  asserting the surviving surface, including the negative "retired exports
  absent" assertions.
- **Delete if empty:** `tests/attachments/index.test.ts` — its pinned
  bindings are mostly Class B; delete the file if no surviving assertions
  remain, otherwise trim. Final call per file during execution.

### knip.config.ts end state

Of the 39 entries added or expanded during the dep PR, 34 are removed or
reverted. Kept, with sharpened justifications naming the mechanism knip
cannot trace:

| Entry | Justification |
| --- | --- |
| `src/providers/public-types.ts` | Published as `papai/plugin-types` (package.json `exports`); consumed by external plugin authors |
| `src/coding-sessions/session-record.ts`, `src/coding-sessions/store.ts` | Declared stable compatibility boundaries for the in-flight plugin-core-separation refactor; `store.ts` also consumed by the frozen story harness |
| `src/debug/state-collector.ts` | `recentLlm`/`pendingTraces` consumed by frozen `tests/utils/test-helpers.ts` |
| `src/deferred-prompts/poller.ts` | `pollAlertsOnce` consumed by frozen `tests/stories/harness/scenario.ts` |

Two pre-existing entries revert to their pre-bump scope:
`src/tools/index.ts` back to `['exports']` (`listToolNames` only; `ToolMode`
is triaged) and `scripts/behavior-audit/consolidate-agent.ts` back to
`['exports']` (`parseConsolidationResult` only; `EntryPointHint` is Class C).

### Verification

- Per-facade gate: `bun run knip && bun run typecheck && bun run lint` +
  targeted test slice.
- Final gate: full `bun check:full`. Known pre-existing flake: the local
  `test` lane fails intermittently under `--parallel` CPU contention
  (git-worktree-heavy review-loop tests, ~6 s analytics PoC tests near the
  5 s timeout); it reproduces on clean master in this environment. CI runs
  the suite serially and is the final arbiter.

### Commit strategy (4 commits on `dependabot/bun/bun-dependencies-aec7b819e5`)

1. `refactor: prune dead facade re-exports` — all Class C bindings.
2. `test: import test-only symbols from concrete modules` — Class B test
   repointing, facade binding pruning, contract-test trims.
3. `refactor: import through module facades instead of concrete internals` —
   Class A production repointing (split by subsystem if unwieldy).
4. `chore(knip): drop facade ignoreIssues resolved by import triage` —
   config down to the 5 justified entries.

## Out of scope

- Repointing internal production code onto the `papai/plugin-types` surface
  (dogfooding decision for a separate change).
- Changing knip's production-only project scope.
- Decomposing or renaming the facades themselves.
