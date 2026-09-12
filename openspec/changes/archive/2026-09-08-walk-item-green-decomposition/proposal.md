<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# walk-item-green-decomposition

## Why

C9's dominant operator load (finding F-P2, the U13 audit's first agenda item):
both cycles' decomposers — on different models, independently — followed the
repo's red-first TDD conventions and split test/impl into separate tasks.md
items. The execution walk's per-item check (`run-check.ts:15-19`) requires the
tree green after every item, so a legitimately-red pre-implementation test
records failure, burns the item's attempts, and its uncommitted red poisons
every later item's check. Run P lost 4 items; Run U lost the whole walk (0/24)
and the operator became the implementer. The U13 audit decided the shape
(`afk-runner-u13-audit` design D3): guidance, not check tolerance.

## What Changes

- `buildDecomposerPrompt` (`work/decompose.ts`) and `buildAtomicityPrompt`
  (`work/atomicity.ts`) gain the walk-granularity constraint: every task is one
  complete red→green cycle — the failing test and its implementation land in
  the same task; no task may leave the working tree red; a test and the
  implementation it verifies are never separate tasks at this granularity.
- Atomicity's merge clause and its "ends with its verification command" line
  are re-worded so they cannot be read as licensing test-only items (today's
  wording is what licensed the C9 splits).
- The per-task affected check, slice-commit policy, verify routing, and fix
  targets are untouched — the walk's green-per-item invariant is the design's
  fixed point, not the moved one.
- Prompt content is pinned by the existing prompt-builder suites.

## Capabilities

### Modified Capabilities

- `afk-runner-tail`: decompose/atomicity stage work gains the walk-safe
  granularity requirement for armed runs' task lists. Without it the tail's
  own spec says nothing about item granularity while the execution half's spec
  demands green per item — the two specs jointly license exactly the F-P2
  failure. The guidance lives in the runner's prompts (the one seam every
  decomposer/atomicity spawn crosses), not the openspec tasks template (which
  is human-facing and shared).

## Impact

- Code: `afk-runner/src/work/decompose.ts`, `afk-runner/src/work/atomicity.ts`
  (prompt builders only). Tests: `tests/afk-runner/work/decompose.test.ts`,
  `tests/afk-runner/work/atomicity.test.ts` (red-first pins). No event, fold,
  schema, memo, CLI, or spec-vocabulary change; unarmed runs are unaffected.
- Docs: `docs/architecture/afk-runner.md` (tail + execution sections, one
  sentence each).
- Declined (recorded in Non-goals): structural lint at decompose exit; check
  tolerance; poison containment.

## Non-goals

- **Check tolerance for declared-red pre-impl tests** — rejected by the U13
  audit on mechanism: exit codes cannot attribute red to a declared pre-impl
  test vs a real regression; red slice commits break the between-commits-green
  invariant verify routing and fix-target mapping rest on; tolerance does not
  contain the poison cascade.
- **A structural decompose-exit lint** (test-only item detection) — brittle
  text heuristics on top of a prompt fix; wake trigger recorded in design D4.
- **Red-work containment in the walk** (runner-side revert of a failed item's
  diff) — a real policy question but independent of granularity; a future
  change on live evidence.
- Any change to `TASK_FIX_ATTEMPTS`, escalation behavior, or the affected
  check command.
